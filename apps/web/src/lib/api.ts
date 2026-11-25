import type { UserRole } from '@interstate/shared';
import { recordNetworkEvent } from './telemetry';

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildApiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const apiPath =
    normalized.startsWith('/api/') || normalized === '/api' ? normalized : `/api${normalized}`;

  // Server-side callers (if any) hit the internal API directly; browser callers always
  // use same-origin /api/* routed through Next.js runtime proxy (zero CORS, single image).
  if (typeof window === 'undefined') {
    const origin = (
      process.env.API_INTERNAL_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      'http://localhost:4000'
    ).replace(/\/+$/, '');
    return `${origin}${apiPath}`;
  }

  return apiPath;
}

function formatFieldLabel(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

function formatValidationDetails(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null;
  const d = details as {
    fieldErrors?: Record<string, string[] | undefined>;
    formErrors?: string[];
  };
  const parts: string[] = [];

  if (Array.isArray(d.formErrors)) {
    for (const msg of d.formErrors) {
      if (typeof msg === 'string' && msg.trim()) {
        parts.push(msg.trim());
      }
    }
  }

  if (d.fieldErrors && typeof d.fieldErrors === 'object') {
    for (const [field, errs] of Object.entries(d.fieldErrors)) {
      if (Array.isArray(errs) && errs.length > 0) {
        const cleaned = errs.filter((e): e is string => typeof e === 'string' && e.trim().length > 0);
        if (cleaned.length > 0) {
          parts.push(`${formatFieldLabel(field)}: ${cleaned.join(', ')}`);
        }
      }
    }
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

export interface ApiError extends Error {
  status: number;
  data?: Record<string, unknown>;
}

export function isReauthRequiredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const apiErr = err as Partial<ApiError>;
  return apiErr.status === 401 && apiErr.data?.error === 'ReauthRequired';
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { role?: UserRole; subCompanyId?: string } = {}
): Promise<T> {
  const { role = 'estimator_approver', subCompanyId = 'sub-red-cliffs', headers, ...rest } = options;

  const requestHeaders = new Headers(headers);
  if (rest.body !== undefined && !(rest.body instanceof FormData) && !requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json');
  }
  if (!requestHeaders.has('x-demo-role')) {
    requestHeaders.set('x-demo-role', role);
  }
  if (!requestHeaders.has('x-demo-sub-id')) {
    requestHeaders.set('x-demo-sub-id', subCompanyId);
  }

  const isBrowser = typeof window !== 'undefined';
  const requestId =
    requestHeaders.get('x-request-id') || (isBrowser ? generateRequestId() : '');
  if (requestId && !requestHeaders.has('x-request-id')) {
    requestHeaders.set('x-request-id', requestId);
  }

  const startMs = isBrowser ? performance.now() : 0;
  const method = (rest.method ?? 'GET').toUpperCase();
  const targetUrl = buildApiUrl(path);

  let res: Response;
  try {
    res = await fetch(targetUrl, {
      ...rest,
      credentials: 'include',
      headers: requestHeaders,
      cache: 'no-store',
    });
  } catch (err) {
    if (isBrowser) {
      recordNetworkEvent({
        timestamp: new Date().toISOString(),
        requestId: requestId || 'network-error',
        method,
        path,
        status: 0,
        durationMs: Math.round(performance.now() - startMs),
        ok: false,
        errorMessage: err instanceof Error ? err.message : 'Network failure',
      });
    }
    throw err;
  }

  const durationMs = isBrowser ? Math.round(performance.now() - startMs) : 0;
  const echoedRequestId = res.headers.get('x-request-id') || requestId || 'unknown';

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({ message: res.statusText }))) as Record<
      string,
      unknown
    >;
    const errCode = typeof errBody.error === 'string' ? errBody.error : '';
    const rawMessage = typeof errBody.message === 'string' ? errBody.message.trim() : '';
    const validationSummary = formatValidationDetails(errBody.details);

    let message: string;
    if (rawMessage && validationSummary) {
      message = `${rawMessage} (${validationSummary})`;
    } else if (validationSummary) {
      message = validationSummary;
    } else if (rawMessage) {
      message = rawMessage;
    } else if (errCode) {
      message = errCode;
    } else {
      message = 'API request failed';
    }

    if (isBrowser) {
      recordNetworkEvent({
        timestamp: new Date().toISOString(),
        requestId: echoedRequestId,
        method,
        path,
        status: res.status,
        durationMs,
        ok: false,
        errorMessage: message,
      });

      if (res.status === 401 && (errCode === 'SessionExpired' || errCode === 'SessionTimeout')) {
        window.dispatchEvent(new Event('interstate:session-expired'));
      }
    }

    throw Object.assign(new Error(message), {
      status: res.status,
      data: errBody,
    }) as ApiError;
  }

  if (isBrowser) {
    recordNetworkEvent({
      timestamp: new Date().toISOString(),
      requestId: echoedRequestId,
      method,
      path,
      status: res.status,
      durationMs,
      ok: true,
    });
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export function formatCurrency(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatCurrencyExact(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
