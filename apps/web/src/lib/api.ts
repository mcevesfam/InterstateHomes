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
    const errBody = await res.json().catch(() => ({ message: res.statusText }));
    const message = errBody.message ?? errBody.error ?? 'API request failed';
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
    }
    throw Object.assign(new Error(message), {
      status: res.status,
      data: errBody,
    });
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
