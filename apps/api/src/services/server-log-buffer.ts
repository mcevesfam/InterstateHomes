import { redactString, type ServerLogEntry } from '@interstate/shared';

interface StoredServerLog extends ServerLogEntry {
  actorUserId: string | null;
  recordedAtMs: number;
}

const MAX_ENTRIES = 500;
const buffer: StoredServerLog[] = [];

function trimStackPreview(stack?: string): string | undefined {
  if (!stack) return undefined;
  const lines = stack
    .split(/\r?\n/)
    .slice(0, 5)
    .map((l) => l.trimEnd())
    .join('\n');
  return redactString(lines, 1000);
}

/**
 * Records a sanitized Fastify request/error log entry into a bounded ring buffer.
 */
export function recordServerLog(input: {
  requestId: string;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  actorUserId?: string | null;
  errorCode?: string;
  errorMessage?: string;
  stack?: string;
}): void {
  const entry: StoredServerLog = {
    timestamp: new Date().toISOString(),
    requestId: redactString(input.requestId, 80),
    method: redactString(input.method, 16),
    route: redactString(input.route, 250),
    statusCode: input.statusCode,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    ...(input.errorCode ? { errorCode: redactString(input.errorCode, 80) } : {}),
    ...(input.errorMessage ? { errorMessage: redactString(input.errorMessage, 1000) } : {}),
    ...(input.stack ? { stackPreview: trimStackPreview(input.stack) } : {}),
    actorUserId: input.actorUserId ?? null,
    recordedAtMs: Date.now(),
  };

  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }
}

/**
 * Joins server-side request logs matching client x-request-id values or recent actor errors.
 */
export function getCorrelatedServerLogs(
  requestIds: string[],
  actorUserId?: string | null,
  windowMs = 600_000
): ServerLogEntry[] {
  const idSet = new Set(requestIds.filter(Boolean));
  const cutoff = Date.now() - windowMs;

  const matched = buffer.filter((entry) => {
    if (entry.requestId && idSet.has(entry.requestId)) return true;
    if (
      actorUserId &&
      entry.actorUserId === actorUserId &&
      entry.recordedAtMs >= cutoff &&
      entry.statusCode >= 400
    ) {
      return true;
    }
    return false;
  });

  return matched
    .slice(-20)
    .reverse()
    .map(({ actorUserId: _actor, recordedAtMs: _ts, ...publicEntry }) => publicEntry);
}

export function clearServerLogBuffer(): void {
  buffer.length = 0;
}
