'use client';

import {
  redactString,
  sanitizeDiagnosticSnapshot,
  type BreadcrumbEntry,
  type ClientLogEntry,
  type DiagnosticSnapshot,
  type NetworkEventEntry,
} from '@interstate/shared';

const MAX_LOGS = 40;
const MAX_NET = 30;
const MAX_BREADCRUMBS = 30;

const clientLogs: ClientLogEntry[] = [];
const networkEvents: NetworkEventEntry[] = [];
const breadcrumbs: BreadcrumbEntry[] = [];
const listeners = new Set<() => void>();

let initialized = false;
let lastRoute = '';

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  }
}

function pushBounded<T>(arr: T[], item: T, max: number) {
  arr.push(item);
  if (arr.length > max) {
    arr.splice(0, arr.length - max);
  }
}

function serializeArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}`;
      }
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

export function initClientTelemetry(): void {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;

  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    const firstErr = args.find((a): a is Error => a instanceof Error);
    pushBounded(
      clientLogs,
      {
        timestamp: new Date().toISOString(),
        level: 'error',
        message: redactString(serializeArgs(args), 800),
        ...(firstErr?.stack ? { stack: redactString(firstErr.stack, 800) } : {}),
      },
      MAX_LOGS
    );
    notify();
    origError(...args);
  };

  console.warn = (...args: unknown[]) => {
    pushBounded(
      clientLogs,
      {
        timestamp: new Date().toISOString(),
        level: 'warn',
        message: redactString(serializeArgs(args), 800),
      },
      MAX_LOGS
    );
    notify();
    origWarn(...args);
  };

  window.addEventListener('error', (event) => {
    pushBounded(
      clientLogs,
      {
        timestamp: new Date().toISOString(),
        level: 'window_error',
        message: redactString(event.message || 'Uncaught window error', 800),
        ...(event.error instanceof Error && event.error.stack
          ? { stack: redactString(event.error.stack, 800) }
          : {}),
      },
      MAX_LOGS
    );
    notify();
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg =
      reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason ?? 'Unhandled rejection');
    pushBounded(
      clientLogs,
      {
        timestamp: new Date().toISOString(),
        level: 'unhandled_rejection',
        message: redactString(msg, 800),
        ...(reason instanceof Error && reason.stack
          ? { stack: redactString(reason.stack, 800) }
          : {}),
      },
      MAX_LOGS
    );
    notify();
  });

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-feedback-widget="true"]')) return;
      if (target.closest('[data-feedback-redact="true"]')) return;
      const interactive = target.closest('button, a, [role="button"], select');
      if (!interactive) return;
      const rawLabel =
        interactive.getAttribute('aria-label') ||
        interactive.getAttribute('title') ||
        interactive.textContent ||
        interactive.tagName;
      const label = redactString(rawLabel.replace(/\s+/g, ' ').trim(), 60);
      if (!label) return;
      pushBounded(
        breadcrumbs,
        {
          timestamp: new Date().toISOString(),
          type: 'click',
          label,
          path: window.location.pathname,
        },
        MAX_BREADCRUMBS
      );
      notify();
    },
    { capture: true, passive: true }
  );
}

export function recordRouteChange(pathname: string): void {
  if (!pathname || pathname === lastRoute) return;
  lastRoute = pathname;
  pushBounded(
    breadcrumbs,
    {
      timestamp: new Date().toISOString(),
      type: 'navigation',
      label: `Navigated to ${pathname}`,
      path: pathname,
    },
    MAX_BREADCRUMBS
  );
  notify();
}

export function recordNetworkEvent(entry: NetworkEventEntry): void {
  // Skip noisy clean summary polling so useful user calls stay in buffer
  if (entry.ok && entry.path.startsWith('/api/feedback/summary')) return;
  pushBounded(
    networkEvents,
    {
      ...entry,
      path: redactString(entry.path, 250),
      ...(entry.errorMessage ? { errorMessage: redactString(entry.errorMessage, 500) } : {}),
    },
    MAX_NET
  );
  notify();
}

export function recordReactError(error: Error, componentStack?: string | null): void {
  pushBounded(
    clientLogs,
    {
      timestamp: new Date().toISOString(),
      level: 'react_error',
      message: redactString(`${error.name}: ${error.message}`, 800),
      ...(componentStack || error.stack
        ? { stack: redactString(`${error.stack ?? ''}\n${componentStack ?? ''}`.trim(), 1000) }
        : {}),
    },
    MAX_LOGS
  );
  notify();
}

export function getTelemetryCounts(): {
  errorCount: number;
  failedRequestCount: number;
  networkCount: number;
  breadcrumbCount: number;
} {
  const errorCount = clientLogs.filter((l) => l.level !== 'warn').length;
  const failedRequestCount = networkEvents.filter((n) => !n.ok).length;
  return {
    errorCount,
    failedRequestCount,
    networkCount: networkEvents.length,
    breadcrumbCount: breadcrumbs.length,
  };
}

export function getDiagnosticSnapshot(): DiagnosticSnapshot {
  const requestIds = networkEvents.map((n) => n.requestId).filter(Boolean);
  return sanitizeDiagnosticSnapshot({
    clientLogs: [...clientLogs],
    networkEvents: [...networkEvents],
    breadcrumbs: [...breadcrumbs],
    requestIds,
    serverLogs: [],
    capturedAt: new Date().toISOString(),
  });
}

export function getRecentErrorsSummary(): string {
  const lines: string[] = [];
  for (const log of clientLogs.slice(-5)) {
    lines.push(`[${log.level}] ${log.message}`);
  }
  for (const net of networkEvents.filter((n) => !n.ok).slice(-5)) {
    lines.push(`[HTTP ${net.status}] ${net.method} ${net.path}: ${net.errorMessage ?? 'failed'}`);
  }
  return redactString(lines.join('\n'), 1500);
}

export function subscribeTelemetry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
