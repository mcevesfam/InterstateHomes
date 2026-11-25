import type {
  BreadcrumbEntry,
  ClientLogEntry,
  DiagnosticSnapshot,
  NetworkEventEntry,
  ServerLogEntry,
} from './feedback.js';

const SENSITIVE_KEY_PATTERN =
  /password|passwd|secret|token|cookie|authorization|tin|ssn|mfa|encryption|apikey|api_key|privatekey|margin|profit|soldamount/i;

const MAX_CLIENT_LOGS = 40;
const MAX_NETWORK_EVENTS = 30;
const MAX_BREADCRUMBS = 30;
const MAX_SERVER_LOGS = 20;
const MAX_REQUEST_IDS = 30;
const MAX_DEPTH = 6;

/**
 * Scrubs bearer tokens, JWTs, session cookies, SSN/EIN/TIN patterns, and long hex secrets from text.
 */
export function redactString(input: string, maxLength = 1000): string {
  if (!input) return '';
  let text = String(input);

  // Bearer & Authorization header values
  text = text.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
  text = text.replace(/(authorization\s*[:=]\s*)(?:Bearer|Basic|Token)?\s*([^\r\n;,\s]+)/gi, '$1[REDACTED]');

  // JWTs (three base64url segments)
  text = text.replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, '[JWT_REDACTED]');

  // Session cookie values
  text = text.replace(/(ih_session\s*=\s*)([^;\s]+)/gi, '$1[REDACTED]');

  // Query string or inline secret/token params
  text = text.replace(/([?&](?:token|secret|password|apikey|api_key|key)=)([^&\s]+)/gi, '$1[REDACTED]');

  // SSN / EIN / W-9 TIN patterns (12-3456789 or 123-45-6789)
  text = text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '***-**-****');
  text = text.replace(/\b\d{2}-\d{7}\b/g, '**-*******');

  // Long hex secrets (32+ hex chars, excluding hyphenated UUIDs)
  text = text.replace(/\b[0-9a-f]{32,}\b/gi, '[HEX_SECRET_REDACTED]');

  if (text.length > maxLength) {
    return `${text.slice(0, maxLength)}...[truncated]`;
  }
  return text;
}

/**
 * Recursively redacts sensitive object keys and strings up to a bounded depth.
 */
export function redactValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return '[MAX_DEPTH]';

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redactValue(val, depth + 1);
      }
    }
    return out;
  }

  return String(value);
}

function asString(val: unknown, maxLen = 1000): string {
  if (typeof val !== 'string') return redactString(String(val ?? ''), maxLen);
  return redactString(val, maxLen);
}

function clampNumber(val: unknown, fallback = 0): number {
  const num = Number(val);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * Enforces strict size caps and redaction across client/server diagnostic snapshots.
 */
export function sanitizeDiagnosticSnapshot(raw: unknown): DiagnosticSnapshot {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const rawClientLogs = Array.isArray(obj.clientLogs) ? obj.clientLogs : [];
  const clientLogs: ClientLogEntry[] = rawClientLogs
    .slice(-MAX_CLIENT_LOGS)
    .map((entry): ClientLogEntry => {
      const e = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      const validLevels = new Set(['warn', 'error', 'react_error', 'window_error', 'unhandled_rejection']);
      const level = validLevels.has(String(e.level))
        ? (e.level as ClientLogEntry['level'])
        : 'error';
      return {
        timestamp: asString(e.timestamp || new Date().toISOString(), 64),
        level,
        message: asString(e.message ?? '', 1000),
        ...(e.stack ? { stack: asString(e.stack, 1000) } : {}),
      };
    });

  const rawNetwork = Array.isArray(obj.networkEvents) ? obj.networkEvents : [];
  const networkEvents: NetworkEventEntry[] = rawNetwork
    .slice(-MAX_NETWORK_EVENTS)
    .map((entry): NetworkEventEntry => {
      const e = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      return {
        timestamp: asString(e.timestamp || new Date().toISOString(), 64),
        requestId: asString(e.requestId ?? '', 80),
        method: asString(e.method ?? 'GET', 16),
        path: asString(e.path ?? '', 250),
        status: clampNumber(e.status, 0),
        durationMs: Math.max(0, Math.round(clampNumber(e.durationMs, 0))),
        ok: Boolean(e.ok),
        ...(e.errorMessage ? { errorMessage: asString(e.errorMessage, 500) } : {}),
      };
    });

  const rawBreadcrumbs = Array.isArray(obj.breadcrumbs) ? obj.breadcrumbs : [];
  const breadcrumbs: BreadcrumbEntry[] = rawBreadcrumbs
    .slice(-MAX_BREADCRUMBS)
    .map((entry): BreadcrumbEntry => {
      const e = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      const validTypes = new Set(['navigation', 'click', 'action']);
      const type = validTypes.has(String(e.type)) ? (e.type as BreadcrumbEntry['type']) : 'action';
      return {
        timestamp: asString(e.timestamp || new Date().toISOString(), 64),
        type,
        label: asString(e.label ?? '', 120),
        ...(e.path ? { path: asString(e.path, 200) } : {}),
      };
    });

  const rawServerLogs = Array.isArray(obj.serverLogs) ? obj.serverLogs : [];
  const serverLogs: ServerLogEntry[] = rawServerLogs
    .slice(-MAX_SERVER_LOGS)
    .map((entry): ServerLogEntry => {
      const e = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      return {
        timestamp: asString(e.timestamp || new Date().toISOString(), 64),
        requestId: asString(e.requestId ?? '', 80),
        method: asString(e.method ?? 'GET', 16),
        route: asString(e.route ?? '', 250),
        statusCode: clampNumber(e.statusCode, 500),
        durationMs: Math.max(0, Math.round(clampNumber(e.durationMs, 0))),
        ...(e.errorCode ? { errorCode: asString(e.errorCode, 80) } : {}),
        ...(e.errorMessage ? { errorMessage: asString(e.errorMessage, 1000) } : {}),
        ...(e.stackPreview ? { stackPreview: asString(e.stackPreview, 1000) } : {}),
      };
    });

  const rawRequestIds = Array.isArray(obj.requestIds) ? obj.requestIds : [];
  const requestIds = Array.from(
    new Set(
      rawRequestIds
        .map((id) => asString(id, 80))
        .filter((id) => id.length > 0)
    )
  ).slice(-MAX_REQUEST_IDS);

  return {
    clientLogs,
    networkEvents,
    breadcrumbs,
    requestIds,
    serverLogs,
    capturedAt: asString(obj.capturedAt || new Date().toISOString(), 64),
  };
}
