import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  decryptSensitive,
  encryptSensitive,
  generateTotpCode,
  generateTotpSecret,
  hashPassword,
  maskTin,
  verifyPassword,
  verifyTotpToken,
} from '../security/crypto.js';
import {
  SESSION_COOKIE_NAME,
  getDemoSessionByToken,
  resetDemoAuthState,
} from '../security/auth-plugin.js';
import { demoStore } from '../data/demo-store.js';
import { buildApp } from '../app.js';

function extractCookieValue(setCookieHeader: string | string[] | undefined, name: string): string {
  const list = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
  for (const header of list) {
    const firstPart = header.split(';')[0] ?? '';
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx === -1) continue;
    const key = firstPart.slice(0, eqIdx).trim();
    const val = firstPart.slice(eqIdx + 1).trim();
    if (key === name) return val;
  }
  return '';
}

describe('API Security Primitives', () => {
  it('hashes and verifies passwords with scrypt', async () => {
    const hash = await hashPassword('InterstateHomes2026!');
    expect(await verifyPassword('InterstateHomes2026!', hash)).toBe(true);
    expect(await verifyPassword('WrongPassword!', hash)).toBe(false);
  });

  it('encrypts/decrypts sensitive W-9 TINs and masks them everywhere', () => {
    const raw = '87-1234821';
    const encrypted = encryptSensitive(raw);
    expect(encrypted).not.toContain('4821');
    expect(decryptSensitive(encrypted)).toBe(raw);

    const masked = maskTin(raw);
    expect(masked.last4).toBe('4821');
    expect(masked.masked).toBe('***-**-4821');
  });

  it('generates and verifies RFC 6238 TOTP MFA codes', () => {
    const secret = generateTotpSecret();
    const now = 1700000000000;
    const code = generateTotpCode(secret, now);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotpToken(secret, code, now)).toBe(true);
    expect(verifyTotpToken(secret, '000000', now)).toBe(false);
  });
});

describe('API Integration & RBAC Smoke', () => {
  const origDemoMode = process.env.DEMO_MODE;
  const origDbUrl = process.env.DATABASE_URL;

  const initialPos = structuredClone(demoStore.purchaseOrders);
  const initialQuotes = structuredClone(demoStore.quotes);
  const initialSubs = structuredClone(demoStore.subcontractors);
  const initialUsers = structuredClone(demoStore.users);
  const initialClarifications = structuredClone(demoStore.clarifications);

  beforeEach(() => {
    process.env.DEMO_MODE = 'true';
    delete process.env.DATABASE_URL;
    resetDemoAuthState();
    demoStore.purchaseOrders.splice(0, demoStore.purchaseOrders.length, ...structuredClone(initialPos));
    demoStore.quotes.splice(0, demoStore.quotes.length, ...structuredClone(initialQuotes));
    demoStore.subcontractors.splice(0, demoStore.subcontractors.length, ...structuredClone(initialSubs));
    demoStore.users.splice(0, demoStore.users.length, ...structuredClone(initialUsers));
    demoStore.clarifications.splice(
      0,
      demoStore.clarifications.length,
      ...structuredClone(initialClarifications)
    );
  });

  afterEach(() => {
    process.env.DEMO_MODE = origDemoMode;
    if (origDbUrl !== undefined) {
      process.env.DATABASE_URL = origDbUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
    resetDemoAuthState();
  });

  it('serves 81 cost codes and enforces PM financial redaction + COI PO blocking', async () => {
    const app = await buildApp();

    const codesRes = await app.inject({ method: 'GET', url: '/api/cost-codes' });
    expect(codesRes.statusCode).toBe(200);
    expect(codesRes.json().costCodeCount).toBe(81);

    // PM cannot see internal cost codes (00L, 88, 92, 93) or soldAmountCents
    const pmEstRes = await app.inject({
      method: 'GET',
      url: '/api/homes/home-ch-14/estimate',
      headers: { 'x-demo-role': 'project_manager' },
    });
    expect(pmEstRes.statusCode).toBe(200);
    const pmJson = pmEstRes.json();
    expect(pmJson.home.soldAmountCents).toBeNull();
    expect(
      pmJson.estimate.lines.some((l: { costCode: string }) => l.costCode === '93')
    ).toBe(false);

    // Attempting to issue a PO to Hurricane Plumbing (expired COI) is blocked (422) and names coi_gl
    const poRes = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders',
      headers: { 'x-demo-role': 'estimator_approver' },
      payload: {
        homeId: 'home-ch-14',
        costCode: '19',
        subId: 'sub-hurricane-plumbing',
        poType: 'subcontractor',
        scopeSummary: 'Plumbing rough-in & finish',
        totalCents: 2150000,
      },
    });
    expect(poRes.statusCode).toBe(422);
    expect(poRes.json().error).toBe('ComplianceBlocked');
    expect(poRes.json().blockingReasons[0].docType).toBe('coi_gl');

    // Warehouse refresh is admin-only
    const pmRefresh = await app.inject({
      method: 'POST',
      url: '/api/admin/warehouse/refresh',
      headers: { 'x-demo-role': 'project_manager' },
    });
    expect(pmRefresh.statusCode).toBe(403);

    const adminRefresh = await app.inject({
      method: 'POST',
      url: '/api/admin/warehouse/refresh',
      headers: { 'x-demo-role': 'admin' },
    });
    expect(adminRefresh.statusCode).toBe(200);
    expect(adminRefresh.json().ok).toBe(true);
    expect(adminRefresh.json().rowsWritten).toBeGreaterThan(0);

    await app.close();
  });

  it('blocks feedback screenshot bucket IDOR on chat and ticket creation', async () => {
    const app = await buildApp();

    // Arbitrary bucket key (e.g. another sub's W-9) must be rejected with 403
    const chatIdor = await app.inject({
      method: 'POST',
      url: '/api/feedback/chat',
      headers: { 'x-demo-role': 'subcontractor', 'x-demo-sub-id': 'sub-red-cliffs' },
      payload: {
        messages: [{ senderType: 'user', body: 'Look at this screenshot' }],
        pageContext: { pathname: '/portal', section: 'Portal' },
        screenshotStorageKey: 'compliance/sub-hurricane-plumbing/w9.pdf',
      },
    });
    expect(chatIdor.statusCode).toBe(403);
    expect(chatIdor.json().error).toBe('ForbiddenScreenshotKey');

    const createIdor = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { 'x-demo-role': 'subcontractor', 'x-demo-sub-id': 'sub-red-cliffs' },
      payload: {
        category: 'bug',
        severity: 'low',
        title: 'Attempted arbitrary key attach',
        description: 'Trying to read another vendor compliance PDF via screenshot key.',
        pageContext: { pathname: '/portal', section: 'Portal' },
        screenshotStorageKey: 'feedback-screenshots/usr-chase/1700000000000-abcdef123456.png',
      },
    });
    expect(createIdor.statusCode).toBe(403);
    expect(createIdor.json().error).toBe('ForbiddenScreenshotKey');

    await app.close();
  });

  it('blocks PO compliance bypass via spoofed poType, internal/00 cost codes, and split-scope without override', async () => {
    const app = await buildApp();

    // Passing poType: "supplier" for a subcontractor with expired COI must be rejected (422 InvalidPoType)
    const bypassRes = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders',
      headers: { 'x-demo-role': 'estimator_approver' },
      payload: {
        homeId: 'home-ch-14',
        costCode: '19',
        subId: 'sub-hurricane-plumbing',
        poType: 'supplier',
        scopeSummary: 'Attempting compliance bypass via supplier poType',
        totalCents: 2150000,
      },
    });
    expect(bypassRes.statusCode).toBe(422);
    expect(bypassRes.json().error).toBe('InvalidPoType');

    // Internal-only cost code (93 Profit) & non-estimateable "00" must be blocked on POs and Quotes
    const internalPo = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders',
      headers: { 'x-demo-role': 'admin' },
      payload: {
        homeId: 'home-ch-14',
        costCode: '93',
        subId: 'sub-red-cliffs',
        poType: 'subcontractor',
        scopeSummary: 'Invalid profit PO',
        totalCents: 100000,
      },
    });
    expect(internalPo.statusCode).toBe(400);
    expect(internalPo.json().error).toBe('InvalidCostCode');

    const zeroCodeQuote = await app.inject({
      method: 'POST',
      url: '/api/quotes',
      headers: { 'x-demo-role': 'estimator_approver' },
      payload: {
        homeId: 'home-ch-14',
        subCompanyId: 'sub-red-cliffs',
        costCode: '00',
        responseDeadline: '2026-12-31',
        quotedTotalCents: 100000,
      },
    });
    expect(zeroCodeQuote.statusCode).toBe(400);
    expect(zeroCodeQuote.json().error).toBe('InvalidCostCode');

    // Issuing a second PO of same poType on same (homeId, costCode) requires splitScopeOverrideReason
    const duplicatePo = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders',
      headers: { 'x-demo-role': 'estimator_approver' },
      payload: {
        homeId: 'home-ch-14',
        costCode: '22',
        subId: 'sub-red-rock-framing',
        poType: 'subcontractor',
        scopeSummary: 'Second framing PO without split-scope reason',
        totalCents: 500000,
      },
    });
    expect(duplicatePo.statusCode).toBe(422);
    expect(duplicatePo.json().error).toBe('SplitScopeOverrideRequired');

    await app.close();
  });

  it('enforces dual-signature PO flow and blocks PM/estimator forgery or re-signing', async () => {
    const app = await buildApp();

    // po-ch14-20-01 is pending_sub_signature for sub-zion-electric
    // PM, estimator, and wrong subcontractor MUST be blocked (403)
    const pmForge = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders/po-ch14-20-01/sign',
      headers: { 'x-demo-role': 'project_manager' },
    });
    expect(pmForge.statusCode).toBe(403);

    const estForge = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders/po-ch14-20-01/sign',
      headers: { 'x-demo-role': 'estimator_approver' },
    });
    expect(estForge.statusCode).toBe(403);

    const wrongSubForge = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders/po-ch14-20-01/sign',
      headers: { 'x-demo-role': 'subcontractor', 'x-demo-sub-id': 'sub-red-cliffs' },
    });
    expect(wrongSubForge.statusCode).toBe(403);

    // Assigned subcontractor (sub-zion-electric) CAN sign pending_sub_signature -> pending_approver_signature
    const subSign = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders/po-ch14-20-01/sign',
      headers: { 'x-demo-role': 'subcontractor', 'x-demo-sub-id': 'sub-zion-electric' },
    });
    expect(subSign.statusCode).toBe(200);
    expect(subSign.json().purchaseOrder.status).toBe('pending_approver_signature');

    // Subcontractor CANNOT counter-sign as approver
    const subDoubleSign = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders/po-ch14-20-01/sign',
      headers: { 'x-demo-role': 'subcontractor', 'x-demo-sub-id': 'sub-zion-electric' },
    });
    expect(subDoubleSign.statusCode).toBe(403);

    // Approver CAN sign pending_approver_signature -> fully_signed
    const approverSign = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders/po-ch14-20-01/sign',
      headers: { 'x-demo-role': 'estimator_approver' },
    });
    expect(approverSign.statusCode).toBe(200);
    expect(approverSign.json().purchaseOrder.status).toBe('fully_signed');

    // Re-signing a fully_signed PO returns 409 InvalidPoState
    const resign = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders/po-ch14-20-01/sign',
      headers: { 'x-demo-role': 'admin' },
    });
    expect(resign.statusCode).toBe(409);
    expect(resign.json().error).toBe('InvalidPoState');

    await app.close();
  });

  it('enforces subcontractor read/write isolation and quote state machine', async () => {
    const app = await buildApp();

    // Subcontractor blocked from internal estimates, budgets, competitor compliance, and admin settings
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/homes/home-ch-14/estimate',
          headers: { 'x-demo-role': 'subcontractor', 'x-demo-sub-id': 'sub-red-cliffs' },
        })
      ).statusCode
    ).toBe(403);

    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/budgets',
          headers: { 'x-demo-role': 'subcontractor', 'x-demo-sub-id': 'sub-red-cliffs' },
        })
      ).statusCode
    ).toBe(403);

    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/subcontractors/sub-hurricane-plumbing/compliance-check?costCode=19',
          headers: { 'x-demo-role': 'subcontractor', 'x-demo-sub-id': 'sub-red-cliffs' },
        })
      ).statusCode
    ).toBe(403);

    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/admin/settings',
          headers: { 'x-demo-role': 'subcontractor', 'x-demo-sub-id': 'sub-red-cliffs' },
        })
      ).statusCode
    ).toBe(403);

    // Invalid numeric costCode "3" rejected on compliance-check
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/subcontractors/sub-red-cliffs/compliance-check?costCode=3',
          headers: { 'x-demo-role': 'admin' },
        })
      ).statusCode
    ).toBe(400);

    // Subcontractor with empty subCompanyId NEVER falls through to internal dashboard
    const emptySubDash = await app.inject({
      method: 'GET',
      url: '/api/dashboard/summary',
      headers: { 'x-demo-role': 'subcontractor', 'x-demo-sub-id': '' },
    });
    expect(emptySubDash.statusCode).toBe(200);
    expect(emptySubDash.json().kpis.activeHomes).toBe(0);
    expect(emptySubDash.json().activeHomes).toHaveLength(0);

    // Subcontractor & PM cannot create subcontractor companies
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/subcontractors',
          headers: { 'x-demo-role': 'project_manager' },
          payload: {
            legalName: 'Rogue Sub LLC',
            companyType: 'subcontractor',
            costCodesServed: ['31'],
          },
        })
      ).statusCode
    ).toBe(403);

    // Quote counter RBAC & state machine: PM cannot forge counter; finalized quote cannot be re-countered or re-decided
    const pmCounter = await app.inject({
      method: 'POST',
      url: '/api/quotes/q-lk22-20/counter',
      headers: { 'x-demo-role': 'project_manager' },
      payload: { proposedTotalCents: 1_500_000, comment: 'Forged counter' },
    });
    expect(pmCounter.statusCode).toBe(403);

    // Assigned sub (sub-zion-electric) accepts q-lk22-20 directly
    const subAccept = await app.inject({
      method: 'POST',
      url: '/api/quotes/q-lk22-20/accept',
      headers: { 'x-demo-role': 'subcontractor', 'x-demo-sub-id': 'sub-zion-electric' },
    });
    expect(subAccept.statusCode).toBe(200);
    expect(subAccept.json().quote.status).toBe('accepted');

    // Trying to decide or counter an already-accepted quote returns 409
    const redecide = await app.inject({
      method: 'POST',
      url: '/api/quotes/q-lk22-20/decision',
      headers: { 'x-demo-role': 'estimator_approver' },
      payload: { decision: 'reject' },
    });
    expect(redecide.statusCode).toBe(409);

    await app.close();
  });

  it('supports compliance upload/review, admin user creation/unlock, and self-service password change', async () => {
    const app = await buildApp();
    const defaultPassword = process.env.INITIAL_ADMIN_PASSWORD ?? 'ChangeMe-Interstate2026!';

    // 1. Subcontractor uploads a new W-9 compliance doc -> pending, TIN masked
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/subcontractors/sub-red-cliffs/compliance-docs',
      headers: { 'x-demo-role': 'subcontractor', 'x-demo-sub-id': 'sub-red-cliffs' },
      payload: {
        docType: 'w9',
        fileName: 'RedCliffs-W9-2026.pdf',
        w9Tin: '87-9991234',
      },
    });
    expect(uploadRes.statusCode).toBe(201);
    const docId = uploadRes.json().document.id as string;
    expect(uploadRes.json().document.reviewStatus).toBe('pending');
    expect(uploadRes.json().document.w9TinMasked).toBe('***-**-1234');

    // 2. Admin approves the uploaded doc
    const reviewRes = await app.inject({
      method: 'PATCH',
      url: `/api/subcontractors/sub-red-cliffs/compliance-docs/${docId}/review`,
      headers: { 'x-demo-role': 'admin' },
      payload: { reviewStatus: 'approved' },
    });
    expect(reviewRes.statusCode).toBe(200);
    expect(reviewRes.json().document.reviewStatus).toBe('approved');

    // 3. Admin creates a new user & unlocks a locked user
    const createUserRes = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { 'x-demo-role': 'admin' },
      payload: {
        email: 'new.estimator@interstatehomes.com',
        fullName: 'New Estimator',
        role: 'estimator_approver',
        password: 'StrongPassword2026!',
        approvalLimitCents: 10_000_000,
      },
    });
    expect(createUserRes.statusCode).toBe(201);
    const createdUserId = createUserRes.json().user.id as string;

    const lockRes = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${createdUserId}`,
      headers: { 'x-demo-role': 'admin' },
      payload: { status: 'locked' },
    });
    expect(lockRes.statusCode).toBe(200);
    expect(lockRes.json().user.status).toBe('locked');

    const unlockRes = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${createdUserId}`,
      headers: { 'x-demo-role': 'admin' },
      payload: { unlock: true },
    });
    expect(unlockRes.statusCode).toBe(200);
    expect(unlockRes.json().user.status).toBe('active');
    expect(unlockRes.json().user.failedLoginAttempts).toBe(0);

    // 4. Self-service password change via cookie session
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'chase@interstatehomes.com', password: defaultPassword },
    });
    const token = extractCookieValue(loginRes.headers['set-cookie'], SESSION_COOKIE_NAME);

    const weakPwd = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { currentPassword: defaultPassword, newPassword: 'short' },
    });
    expect(weakPwd.statusCode).toBe(400);

    const changeOk = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { currentPassword: defaultPassword, newPassword: 'RotatedSecurePassword2026!' },
    });
    expect(changeOk.statusCode).toBe(200);

    // Old password now fails; new password logs in cleanly
    const oldFail = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'chase@interstatehomes.com', password: defaultPassword },
    });
    expect(oldFail.statusCode).toBe(401);

    const newOk = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'chase@interstatehomes.com', password: 'RotatedSecurePassword2026!' },
    });
    expect(newOk.statusCode).toBe(200);

    await app.close();
  });

  it('supports httpOnly cookie login, MFA setup/verify, reauth, inactivity timeout, and logout', async () => {
    const app = await buildApp();
    const defaultPassword = process.env.INITIAL_ADMIN_PASSWORD ?? 'ChangeMe-Interstate2026!';

    // 1. Login with valid password -> sets httpOnly ih_session cookie
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'chase@interstatehomes.com',
        password: defaultPassword,
      },
    });
    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json().mfaRequired).toBe(false);
    const setCookieHeader = loginRes.headers['set-cookie'];
    expect(String(setCookieHeader)).toContain('HttpOnly');
    const sessionToken = extractCookieValue(setCookieHeader, SESSION_COOKIE_NAME);
    expect(sessionToken.length).toBeGreaterThan(20);

    // 2. GET /api/auth/me returns actor, mode, and sessionTimeoutMinutes
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().mode).toBe('demo');
    expect(meRes.json().sessionTimeoutMinutes).toBe(30);
    expect(meRes.json().user.email).toBe('chase@interstatehomes.com');
    expect(meRes.json().user.role).toBe('admin');

    // 3. Setup MFA and activate via TOTP verify
    const setupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/setup',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
    });
    expect(setupRes.statusCode).toBe(200);
    const { secret, otpauthUri } = setupRes.json() as { secret: string; otpauthUri: string };
    expect(secret.length).toBeGreaterThan(10);
    expect(otpauthUri).toContain('otpauth://totp/');

    const badMfaRes = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/verify',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
      payload: { code: '000000' },
    });
    expect(badMfaRes.statusCode).toBe(401);

    const validCode = generateTotpCode(secret);
    const enableMfaRes = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/verify',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
      payload: { code: validCode },
    });
    expect(enableMfaRes.statusCode).toBe(200);
    expect(enableMfaRes.json().mfaVerified).toBe(true);

    // 4. Re-login now requires MFA and blocks protected endpoints until verified
    const mfaLoginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'chase@interstatehomes.com',
        password: defaultPassword,
      },
    });
    expect(mfaLoginRes.statusCode).toBe(200);
    expect(mfaLoginRes.json().mfaRequired).toBe(true);
    const pendingToken = extractCookieValue(mfaLoginRes.headers['set-cookie'], SESSION_COOKIE_NAME);
    expect(pendingToken.length).toBeGreaterThan(20);

    const blockedMe = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${pendingToken}` },
    });
    expect(blockedMe.statusCode).toBe(401);
    expect(blockedMe.json().error).toBe('MfaRequired');

    const verifyLoginMfa = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/verify',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${pendingToken}` },
      payload: { code: generateTotpCode(secret) },
    });
    expect(verifyLoginMfa.statusCode).toBe(200);

    const unlockedMe = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${pendingToken}` },
    });
    expect(unlockedMe.statusCode).toBe(200);
    expect(unlockedMe.json().user.mfaEnabled).toBe(true);

    // 5. Reauth enforcement before PO signing (po-ch14-22-01 is pending_approver_signature)
    const memSess = getDemoSessionByToken(pendingToken)!;
    memSess.lastReauthAt = Date.now() - 20 * 60_000; // stale (> 15 min)

    const staleSignRes = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders/po-ch14-22-01/sign',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${pendingToken}` },
    });
    expect(staleSignRes.statusCode).toBe(401);
    expect(staleSignRes.json().error).toBe('ReauthRequired');

    const badReauth = await app.inject({
      method: 'POST',
      url: '/api/auth/reauth',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${pendingToken}` },
      payload: { password: 'WrongPassword!' },
    });
    expect(badReauth.statusCode).toBe(401);

    const okReauth = await app.inject({
      method: 'POST',
      url: '/api/auth/reauth',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${pendingToken}` },
      payload: { password: defaultPassword },
    });
    expect(okReauth.statusCode).toBe(200);
    expect(okReauth.json().ok).toBe(true);

    const freshSignRes = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders/po-ch14-22-01/sign',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${pendingToken}` },
    });
    expect(freshSignRes.statusCode).toBe(200);

    // 6. Logout revokes session & clears cookie
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${pendingToken}` },
    });
    expect(logoutRes.statusCode).toBe(200);

    const afterLogoutMe = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${pendingToken}` },
    });
    expect(afterLogoutMe.statusCode).toBe(401);

    // 7. Inactivity timeout (> 30 min) expires session
    const firstSess = getDemoSessionByToken(sessionToken)!;
    firstSess.lastActivityAt = Date.now() - 31 * 60_000;
    const timedOutMe = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
    });
    expect(timedOutMe.statusCode).toBe(401);
    expect(timedOutMe.json().error).toBe('SessionTimeout');

    await app.close();
  });

  it('enforces 5-attempt lockout on failed logins', async () => {
    const app = await buildApp();
    const defaultPassword = process.env.INITIAL_ADMIN_PASSWORD ?? 'ChangeMe-Interstate2026!';

    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'amanda@interstatehomes.com', password: 'WrongPassword!' },
      });
      expect(res.statusCode).toBe(401);
    }

    // 5th failed attempt locks the account
    const fifth = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'amanda@interstatehomes.com', password: 'WrongPassword!' },
    });
    expect(fifth.statusCode).toBe(423);
    expect(fifth.json().error).toBe('AccountLocked');

    // Subsequent login with the CORRECT password is still blocked while locked
    const sixth = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'amanda@interstatehomes.com', password: defaultPassword },
    });
    expect(sixth.statusCode).toBe(423);
    expect(sixth.json().error).toBe('AccountLocked');

    await app.close();
  });

  it('never falls back to x-demo-role headers in Postgres mode (DEMO_MODE=false)', async () => {
    process.env.DEMO_MODE = 'false';
    const app = await buildApp();

    // Public health check still works
    const healthRes = await app.inject({ method: 'GET', url: '/api/health' });
    expect(healthRes.statusCode).toBe(200);

    // Protected endpoints reject unauthenticated requests even if x-demo-role header is spoofed
    const homesRes = await app.inject({
      method: 'GET',
      url: '/api/homes',
      headers: { 'x-demo-role': 'admin' },
    });
    expect(homesRes.statusCode).toBe(401);
    expect(homesRes.json().error).toBe('Unauthorized');

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { 'x-demo-role': 'admin' },
    });
    expect(meRes.statusCode).toBe(401);
    expect(meRes.json().mode).toBe('postgres');

    await app.close();
  });
});
