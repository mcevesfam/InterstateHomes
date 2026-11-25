import { describe, expect, it } from 'vitest';
import { canAccess } from '../roles.js';
import { redactString, redactValue, sanitizeDiagnosticSnapshot } from '../redaction.js';

describe('Feedback RBAC Permissions', () => {
  it('grants feedback:create and feedback:view_own to active roles, and feedback:manage only to admin', () => {
    expect(canAccess('admin', 'feedback:create')).toBe(true);
    expect(canAccess('admin', 'feedback:view_own')).toBe(true);
    expect(canAccess('admin', 'feedback:manage')).toBe(true);

    for (const role of ['estimator_approver', 'project_manager', 'subcontractor'] as const) {
      expect(canAccess(role, 'feedback:create')).toBe(true);
      expect(canAccess(role, 'feedback:view_own')).toBe(true);
      expect(canAccess(role, 'feedback:manage')).toBe(false);
    }

    expect(canAccess('homeowner', 'feedback:create')).toBe(false);
    expect(canAccess('homeowner', 'feedback:manage')).toBe(false);
  });
});

describe('Diagnostic Redaction & Caps', () => {
  it('masks tokens, cookies, SSN/EIN/TINs, and long hex secrets in strings', () => {
    const raw =
      'Authorization: Bearer secret-abc-123 cookie ih_session=xyz999 tin 87-1234821 ssn 123-45-6789 key=0123456789abcdef0123456789abcdef';
    const scrubbed = redactString(raw);
    expect(scrubbed).not.toContain('secret-abc-123');
    expect(scrubbed).not.toContain('xyz999');
    expect(scrubbed).not.toContain('4821');
    expect(scrubbed).not.toContain('6789');
    expect(scrubbed).not.toContain('0123456789abcdef0123456789abcdef');
    expect(scrubbed).toContain('[REDACTED]');
    expect(scrubbed).toContain('**-*******');
    expect(scrubbed).toContain('***-**-****');
  });

  it('redacts sensitive object keys including internal margin/profit/soldAmount fields', () => {
    const scrubbed = redactValue({
      homeCode: 'CH 14',
      password: 'Password123!',
      w9TinEncrypted: 'cipher',
      soldAmountCents: 68_500_000,
      nested: { profitMargin: 0.18, safeLabel: 'OK' },
    }) as Record<string, unknown>;

    expect(scrubbed.homeCode).toBe('CH 14');
    expect(scrubbed.password).toBe('[REDACTED]');
    expect(scrubbed.w9TinEncrypted).toBe('[REDACTED]');
    expect(scrubbed.soldAmountCents).toBe('[REDACTED]');
    expect((scrubbed.nested as Record<string, unknown>).profitMargin).toBe('[REDACTED]');
    expect((scrubbed.nested as Record<string, unknown>).safeLabel).toBe('OK');
  });

  it('enforces bounded caps on clientLogs, networkEvents, breadcrumbs, and serverLogs', () => {
    const snapshot = sanitizeDiagnosticSnapshot({
      clientLogs: Array.from({ length: 65 }, (_, i) => ({
        timestamp: '2026-11-24T12:00:00Z',
        level: 'error',
        message: `err-${i} Bearer tok${i}`,
      })),
      networkEvents: Array.from({ length: 50 }, (_, i) => ({
        timestamp: '2026-11-24T12:00:00Z',
        requestId: `req-${i}`,
        method: 'GET',
        path: `/api/test/${i}`,
        status: 500,
        durationMs: 12,
        ok: false,
      })),
      breadcrumbs: Array.from({ length: 45 }, (_, i) => ({
        timestamp: '2026-11-24T12:00:00Z',
        type: 'click',
        label: `Button ${i}`,
      })),
      serverLogs: Array.from({ length: 30 }, (_, i) => ({
        timestamp: '2026-11-24T12:00:00Z',
        requestId: `req-${i}`,
        method: 'POST',
        route: '/api/quotes',
        statusCode: 500,
        durationMs: 22,
      })),
    });

    expect(snapshot.clientLogs).toHaveLength(40);
    expect(snapshot.clientLogs[0]?.message).toContain('err-25');
    expect(snapshot.clientLogs[0]?.message).not.toContain('tok25');
    expect(snapshot.networkEvents).toHaveLength(30);
    expect(snapshot.breadcrumbs).toHaveLength(30);
    expect(snapshot.serverLogs).toHaveLength(20);
  });
});
