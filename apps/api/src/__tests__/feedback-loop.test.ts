import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { demoStore } from '../data/demo-store.js';
import { resetDemoAuthState } from '../security/auth-plugin.js';
import { resetFeedbackRateLimits } from '../routes/feedback.js';
import { clearServerLogBuffer } from '../services/server-log-buffer.js';

const VALID_1X1_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('Closed-Loop Feedback, Log Correlation & Fix-Plan Approval', () => {
  const origDemoMode = process.env.DEMO_MODE;
  const origDbUrl = process.env.DATABASE_URL;
  const origGithubToken = process.env.GITHUB_TOKEN;
  const origFetch = globalThis.fetch;

  const initialItems = structuredClone(demoStore.feedbackItems);
  const initialMessages = structuredClone(demoStore.feedbackMessages);
  const initialPlans = structuredClone(demoStore.feedbackFixPlans);
  const initialSeq = demoStore.nextFeedbackSeq;
  const initialAuditCount = demoStore.auditLogs.length;

  beforeEach(() => {
    process.env.DEMO_MODE = 'true';
    delete process.env.DATABASE_URL;
    delete process.env.GITHUB_TOKEN;
    resetDemoAuthState();
    resetFeedbackRateLimits();
    clearServerLogBuffer();
    demoStore.feedbackItems.splice(0, demoStore.feedbackItems.length, ...structuredClone(initialItems));
    demoStore.feedbackMessages.splice(0, demoStore.feedbackMessages.length, ...structuredClone(initialMessages));
    demoStore.feedbackFixPlans.splice(0, demoStore.feedbackFixPlans.length, ...structuredClone(initialPlans));
    demoStore.feedbackScreenshots.clear();
    demoStore.nextFeedbackSeq = initialSeq;
    demoStore.auditLogs.splice(0, demoStore.auditLogs.length - initialAuditCount);
  });

  afterEach(() => {
    process.env.DEMO_MODE = origDemoMode;
    if (origDbUrl !== undefined) process.env.DATABASE_URL = origDbUrl;
    else delete process.env.DATABASE_URL;
    if (origGithubToken !== undefined) process.env.GITHUB_TOKEN = origGithubToken;
    else delete process.env.GITHUB_TOKEN;
    globalThis.fetch = origFetch;
    resetDemoAuthState();
    clearServerLogBuffer();
  });

  it('validates screenshot magic bytes and size', async () => {
    const app = await buildApp();

    const goodRes = await app.inject({
      method: 'POST',
      url: '/api/feedback/screenshot',
      headers: { 'x-demo-role': 'estimator_approver' },
      payload: { dataUrl: `data:image/png;base64,${VALID_1X1_PNG_BASE64}` },
    });
    expect(goodRes.statusCode).toBe(201);
    expect(goodRes.json().storageKey).toContain('feedback-screenshots/');

    const badMimeRes = await app.inject({
      method: 'POST',
      url: '/api/feedback/screenshot',
      headers: { 'x-demo-role': 'estimator_approver' },
      payload: { dataUrl: 'data:text/plain;base64,SGVsbG8=' },
    });
    expect(badMimeRes.statusCode).toBe(400);

    const spoofedPngRes = await app.inject({
      method: 'POST',
      url: '/api/feedback/screenshot',
      headers: { 'x-demo-role': 'estimator_approver' },
      payload: { dataUrl: 'data:image/png;base64,SGVsbG8gd29ybGQ=' },
    });
    expect(spoofedPngRes.statusCode).toBe(400);
  });

  it('runs full closed loop: chat -> correlated server logs -> AI plan -> revise -> approve (GitHub & fallback) -> deployed', async () => {
    const app = await buildApp();

    // 1. Trigger a real 422 compliance error with correlated x-request-id
    const corrId = 'test-corr-po-422';
    const failPoRes = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders',
      headers: {
        'x-demo-role': 'estimator_approver',
        'x-request-id': corrId,
      },
      payload: {
        homeId: 'home-ch-14',
        costCode: '19',
        subId: 'sub-hurricane-plumbing',
        poType: 'subcontractor',
        scopeSummary: 'Plumbing package',
        totalCents: 2_150_000,
      },
    });
    expect(failPoRes.statusCode).toBe(422);
    expect(failPoRes.headers['x-request-id']).toBe(corrId);

    // 2. Chat triage turn
    const chatRes = await app.inject({
      method: 'POST',
      url: '/api/feedback/chat',
      headers: { 'x-demo-role': 'estimator_approver' },
      payload: {
        messages: [
          {
            senderType: 'user',
            body: 'Issuing a PO on /purchase-orders returned 422 and needs a direct link to upload COI.',
          },
        ],
        pageContext: {
          pathname: '/purchase-orders',
          section: 'Purchase Orders',
          entityLabel: 'CH 14',
        },
        recentErrorsSummary: '[HTTP 422] POST /api/purchase-orders',
      },
    });
    expect(chatRes.statusCode).toBe(200);
    expect(chatRes.json().readyToSubmit).toBe(true);

    // 3. Upload screenshot and submit feedback ticket
    const shotRes = await app.inject({
      method: 'POST',
      url: '/api/feedback/screenshot',
      headers: { 'x-demo-role': 'estimator_approver' },
      payload: { dataUrl: `data:image/png;base64,${VALID_1X1_PNG_BASE64}` },
    });
    const storageKey = shotRes.json().storageKey as string;

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { 'x-demo-role': 'estimator_approver' },
      payload: {
        category: 'bug',
        severity: 'high',
        title: 'PO compliance error needs direct compliance link',
        description: '422 ComplianceBlocked lacks a direct button to /compliance for that vendor.',
        pageContext: {
          pathname: '/purchase-orders',
          section: 'Purchase Orders',
          entityType: 'home',
          entityId: 'home-ch-14',
          entityLabel: 'CH 14',
        },
        diagnosticSnapshot: {
          clientLogs: [
            {
              timestamp: new Date().toISOString(),
              level: 'error',
              message: 'Bearer should-be-masked failed PO call',
            },
          ],
          networkEvents: [
            {
              timestamp: new Date().toISOString(),
              requestId: corrId,
              method: 'POST',
              path: '/api/purchase-orders',
              status: 422,
              durationMs: 12,
              ok: false,
              errorMessage: 'COI expired',
            },
          ],
          breadcrumbs: [
            {
              timestamp: new Date().toISOString(),
              type: 'click',
              label: 'Test Compliance Gate',
            },
          ],
          requestIds: [corrId],
          serverLogs: [],
          capturedAt: new Date().toISOString(),
        },
        screenshotStorageKey: storageKey,
        transcript: [
          { senderType: 'user', body: 'PO blocked with 422' },
          { senderType: 'assistant', body: 'Ready to submit.' },
        ],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const createdReporterView = createRes.json().item;
    expect(createdReporterView.ticketKey).toBe('FB-103');
    expect(createdReporterView.status).toBe('plan_ready');
    // Reporter response must NEVER leak fixPlans or diagnosticSnapshot
    expect(createdReporterView.fixPlans).toBeUndefined();
    expect(createdReporterView.diagnosticSnapshot).toBeUndefined();

    // 4. Admin inspects detail: sees correlated server log, redacted client log, screenshot URL & v1 plan
    const adminDetailRes = await app.inject({
      method: 'GET',
      url: `/api/feedback/${createdReporterView.id}`,
      headers: { 'x-demo-role': 'admin' },
    });
    expect(adminDetailRes.statusCode).toBe(200);
    const adminItem = adminDetailRes.json().item;
    expect(adminItem.fixPlans).toHaveLength(1);
    expect(adminItem.fixPlans[0].version).toBe(1);
    expect(adminItem.diagnosticSnapshot.serverLogs.some((l: { requestId: string }) => l.requestId === corrId)).toBe(
      true
    );
    expect(adminItem.diagnosticSnapshot.clientLogs[0].message).not.toContain('should-be-masked');
    expect(adminItem.screenshotUrl).toBe(`/api/feedback/${createdReporterView.id}/screenshot`);

    // Screenshot endpoint serves PNG bytes to Admin
    const pngRes = await app.inject({
      method: 'GET',
      url: adminItem.screenshotUrl,
      headers: { 'x-demo-role': 'admin' },
    });
    expect(pngRes.statusCode).toBe(200);
    expect(pngRes.headers['content-type']).toBe('image/png');

    // 5. Admin requests AI revision -> v2 created, v1 superseded
    const reviseRes = await app.inject({
      method: 'POST',
      url: `/api/feedback/${createdReporterView.id}/revise-plan`,
      headers: { 'x-demo-role': 'admin' },
      payload: { feedback: 'Use query param ?subId on /compliance instead of a modal.' },
    });
    expect(reviseRes.statusCode).toBe(200);
    const revisedPlans = reviseRes.json().item.fixPlans;
    expect(revisedPlans).toHaveLength(2);
    expect(revisedPlans[0].version).toBe(2);
    expect(revisedPlans[0].status).toBe('pending_approval');
    expect(revisedPlans[1].version).toBe(1);
    expect(revisedPlans[1].status).toBe('superseded');

    // 6a. Approve without GITHUB_TOKEN -> succeeds with not_configured
    const approveNoGhRes = await app.inject({
      method: 'POST',
      url: `/api/feedback/${createdReporterView.id}/approve`,
      headers: { 'x-demo-role': 'admin' },
      payload: { createGithubIssue: true },
    });
    expect(approveNoGhRes.statusCode).toBe(200);
    expect(approveNoGhRes.json().item.status).toBe('approved');
    expect(approveNoGhRes.json().item.githubDispatchStatus).toBe('not_configured');

    // 6b. Retry GitHub Issue with mocked GITHUB_TOKEN -> created #42
    process.env.GITHUB_TOKEN = 'ghp_test_token_123';
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          number: 42,
          html_url: 'https://github.com/mcevesfam/InterstateHomes/issues/42',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      )
    ) as unknown as typeof fetch;

    const retryGhRes = await app.inject({
      method: 'POST',
      url: `/api/feedback/${createdReporterView.id}/retry-github`,
      headers: { 'x-demo-role': 'admin' },
      payload: {},
    });
    expect(retryGhRes.statusCode).toBe(200);
    expect(retryGhRes.json().item.githubDispatchStatus).toBe('created');
    expect(retryGhRes.json().item.githubIssueNumber).toBe(42);
    expect(retryGhRes.json().item.githubIssueUrl).toContain('/issues/42');

    // 7. Admin closes loop -> deployed with resolutionNote
    const deployRes = await app.inject({
      method: 'PATCH',
      url: `/api/feedback/${createdReporterView.id}/status`,
      headers: { 'x-demo-role': 'admin' },
      payload: {
        status: 'deployed',
        resolutionNote: 'Added direct Compliance link on 422 PO banner in staging.',
      },
    });
    expect(deployRes.statusCode).toBe(200);
    expect(deployRes.json().item.status).toBe('deployed');

    // 8. Reporter sees closed-loop resolutionNote without internal logs/plans
    const reporterCheckRes = await app.inject({
      method: 'GET',
      url: `/api/feedback/${createdReporterView.id}`,
      headers: { 'x-demo-role': 'estimator_approver' },
    });
    expect(reporterCheckRes.statusCode).toBe(200);
    const reporterCheck = reporterCheckRes.json().item;
    expect(reporterCheck.status).toBe('deployed');
    expect(reporterCheck.resolutionNote).toContain('Compliance link');
    expect(reporterCheck.fixPlans).toBeUndefined();
    expect(reporterCheck.diagnosticSnapshot).toBeUndefined();
    expect(reporterCheck.githubIssueUrl).toBeUndefined();

    // 9. Verify audit trail recorded all feedback lifecycle actions
    const actions = demoStore.auditLogs.map((a) => a.action);
    expect(actions).toContain('FEEDBACK_SUBMITTED');
    expect(actions).toContain('FEEDBACK_PLAN_REVISED');
    expect(actions).toContain('FEEDBACK_PLAN_APPROVED');
    expect(actions).toContain('FEEDBACK_STATUS_UPDATED');
  });

  it('enforces strict RBAC isolation on management endpoints and cross-user ticket access', async () => {
    const app = await buildApp();

    // Subcontractor cannot approve, revise, reject, or read Estimator's FB-101
    for (const role of ['subcontractor', 'project_manager', 'estimator_approver'] as const) {
      const approveAttempt = await app.inject({
        method: 'POST',
        url: '/api/feedback/fb-demo-101/approve',
        headers: { 'x-demo-role': role },
        payload: {},
      });
      expect(approveAttempt.statusCode).toBe(403);

      const reviseAttempt = await app.inject({
        method: 'POST',
        url: '/api/feedback/fb-demo-101/revise-plan',
        headers: { 'x-demo-role': role },
        payload: { feedback: 'bypass' },
      });
      expect(reviseAttempt.statusCode).toBe(403);
    }

    // Subcontractor cannot view Estimator's fb-demo-101
    const subReadOther = await app.inject({
      method: 'GET',
      url: '/api/feedback/fb-demo-101',
      headers: { 'x-demo-role': 'subcontractor' },
    });
    expect(subReadOther.statusCode).toBe(403);

    // Subcontractor list only contains own tickets (0 initially)
    const subList = await app.inject({
      method: 'GET',
      url: '/api/feedback',
      headers: { 'x-demo-role': 'subcontractor' },
    });
    expect(subList.statusCode).toBe(200);
    expect(subList.json().items).toHaveLength(0);
  });
});
