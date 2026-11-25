import type { FastifyRequest, FastifyReply } from 'fastify';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  DEFAULT_SYSTEM_SETTINGS,
  canAccess,
  type Permission,
  type UserRole,
} from '@interstate/shared';
import { demoStore } from '../data/demo-store.js';
import { getDb, isDatabaseConfigured, isDemoMode } from '../db/client.js';
import { sessions, systemSettings, users } from '../db/schema/index.js';
import { generateSessionToken, hashPassword, hashToken } from './crypto.js';

export const SESSION_COOKIE_NAME = 'ih_session';
export const PENDING_MFA_PREFIX = 'pending_mfa:';
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const SESSION_ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export interface RequestActor {
  userId: string;
  email: string;
  fullName: string;
  role: UserRole;
  subCompanyId: string | null;
  approvalLimitCents?: number | null;
  lastReauthAt: number;
  mfaEnabled?: boolean;
  authenticated?: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    actor: RequestActor;
    sessionId?: string | null;
    sessionTokenHash?: string | null;
    mfaPending?: boolean;
  }
}

const VALID_ROLES = new Set<UserRole>([
  'admin',
  'estimator_approver',
  'project_manager',
  'subcontractor',
  'homeowner',
]);

export function getRuntimeMode(): 'demo' | 'postgres' {
  return isDemoMode() ? 'demo' : 'postgres';
}

export function isUsingDemoStore(): boolean {
  return isDemoMode() || !isDatabaseConfigured();
}

export function isSecureRequest(request?: FastifyRequest): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  if (!request) return false;
  const fwdProto = request.headers['x-forwarded-proto'];
  if (typeof fwdProto === 'string' && fwdProto.split(',')[0]?.trim().toLowerCase() === 'https') {
    return true;
  }
  return request.protocol === 'https';
}

function isPublicPath(url: string): boolean {
  const pathname = url.split('?')[0] ?? '/';
  if (
    pathname === '/api/health' ||
    pathname === '/api/auth/login' ||
    pathname === '/api/auth/mfa/verify' ||
    pathname === '/api/auth/logout'
  ) {
    return true;
  }
  // Protect Swagger/OpenAPI in production Postgres mode
  if (process.env.NODE_ENV === 'production' && !isDemoMode()) {
    return false;
  }
  return pathname === '/openapi.json' || pathname === '/docs' || pathname.startsWith('/docs/');
}

// ---------------------------------------------------------------------------
// Demo-mode in-memory session & auth state (mirrors Postgres users/sessions)
// ---------------------------------------------------------------------------

export interface DemoAuthUserState {
  userId: string;
  passwordHash: string;
  mfaEnabled: boolean;
  mfaSecretEncrypted: string | null;
  failedLoginAttempts: number;
  status: 'active' | 'disabled' | 'locked';
}

export interface MemorySession {
  id: string;
  userId: string;
  tokenHash: string;
  mfaPending: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  lastActivityAt: number;
  lastReauthAt: number;
  expiresAt: number;
  revokedAt: number | null;
  createdAt: number;
}

const demoAuthStateMap = new Map<string, DemoAuthUserState>();
const demoSessionMap = new Map<string, MemorySession>();
const authRateLimitMap = new Map<string, number[]>();
const pendingMfaSetupMap = new Map<string, { encryptedSecret: string; expiresAt: number }>();
let cachedDefaultDemoPasswordHash: string | null = null;

async function getDefaultDemoPasswordHash(): Promise<string> {
  if (!cachedDefaultDemoPasswordHash) {
    const defaultPwd = process.env.INITIAL_ADMIN_PASSWORD ?? 'ChangeMe-Interstate2026!';
    cachedDefaultDemoPasswordHash = await hashPassword(defaultPwd);
  }
  return cachedDefaultDemoPasswordHash;
}

export async function getOrInitDemoAuthState(userId: string): Promise<DemoAuthUserState | null> {
  const existing = demoAuthStateMap.get(userId);
  if (existing) return existing;

  const user = demoStore.users.find((u) => u.id === userId);
  if (!user) return null;

  const state: DemoAuthUserState = {
    userId: user.id,
    passwordHash: await getDefaultDemoPasswordHash(),
    mfaEnabled: false,
    mfaSecretEncrypted: null,
    failedLoginAttempts: 0,
    status: user.status,
  };
  demoAuthStateMap.set(userId, state);
  return state;
}

export function setDemoAuthState(userId: string, state: DemoAuthUserState): void {
  demoAuthStateMap.set(userId, state);
}

export function getDemoSessionByToken(rawToken: string): MemorySession | undefined {
  const tokenHash = hashToken(rawToken);
  return demoSessionMap.get(tokenHash);
}

export function saveDemoSession(session: MemorySession): void {
  demoSessionMap.set(session.tokenHash, session);
}

export function deleteDemoSession(tokenHash: string): void {
  demoSessionMap.delete(tokenHash);
}

export function revokeUserDemoSessions(userId: string): void {
  const now = Date.now();
  for (const [hash, sess] of demoSessionMap.entries()) {
    if (sess.userId === userId) {
      sess.revokedAt = now;
      demoSessionMap.delete(hash);
    }
  }
}

export function checkAuthAttemptLimit(
  bucket: 'mfa' | 'reauth',
  subjectId: string,
  maxAttempts = 5,
  windowMs = 15 * 60_000
): { allowed: boolean; attempts: number } {
  const key = `${bucket}:${subjectId}`;
  const now = Date.now();
  const recent = (authRateLimitMap.get(key) ?? []).filter((ts) => now - ts < windowMs);
  authRateLimitMap.set(key, recent);
  return { allowed: recent.length < maxAttempts, attempts: recent.length };
}

export function recordFailedAuthAttempt(
  bucket: 'mfa' | 'reauth',
  subjectId: string,
  windowMs = 15 * 60_000
): number {
  const key = `${bucket}:${subjectId}`;
  const now = Date.now();
  const recent = (authRateLimitMap.get(key) ?? []).filter((ts) => now - ts < windowMs);
  recent.push(now);
  authRateLimitMap.set(key, recent);
  return recent.length;
}

export function clearAuthAttempts(bucket: 'mfa' | 'reauth', subjectId: string): void {
  authRateLimitMap.delete(`${bucket}:${subjectId}`);
}

export function stagePendingMfaSecret(userId: string, encryptedSecret: string, ttlMs = 15 * 60_000): void {
  pendingMfaSetupMap.set(userId, { encryptedSecret, expiresAt: Date.now() + ttlMs });
}

export function getStagedPendingMfaSecret(userId: string): string | null {
  const entry = pendingMfaSetupMap.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    pendingMfaSetupMap.delete(userId);
    return null;
  }
  return entry.encryptedSecret;
}

export function clearStagedPendingMfaSecret(userId: string): void {
  pendingMfaSetupMap.delete(userId);
}

export function resetDemoAuthState(): void {
  demoAuthStateMap.clear();
  demoSessionMap.clear();
  authRateLimitMap.clear();
  pendingMfaSetupMap.clear();
  cachedDefaultDemoPasswordHash = null;
}

// ---------------------------------------------------------------------------
// Cookie & Session creation helpers
// ---------------------------------------------------------------------------

export function setSessionCookie(
  reply: FastifyReply,
  rawToken: string,
  request?: FastifyRequest
): void {
  reply.setCookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(request),
    path: '/',
    maxAge: Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply, request?: FastifyRequest): void {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(request),
    path: '/',
  });
}

export async function createSessionForUser(params: {
  userId: string;
  mfaPending: boolean;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<{ rawToken: string; sessionId: string; tokenHash: string }> {
  const rawToken = generateSessionToken();
  const baseHash = hashToken(rawToken);
  const now = Date.now();
  const expiresAt = now + SESSION_ABSOLUTE_TTL_MS;

  if (isUsingDemoStore()) {
    const id = `sess-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const session: MemorySession = {
      id,
      userId: params.userId,
      tokenHash: baseHash,
      mfaPending: params.mfaPending,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      lastActivityAt: now,
      lastReauthAt: now,
      expiresAt,
      revokedAt: null,
      createdAt: now,
    };
    saveDemoSession(session);
    return { rawToken, sessionId: id, tokenHash: baseHash };
  }

  const db = getDb();
  const storedHash = params.mfaPending ? `${PENDING_MFA_PREFIX}${baseHash}` : baseHash;
  const [inserted] = await db
    .insert(sessions)
    .values({
      userId: params.userId,
      tokenHash: storedHash,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      lastActivityAt: new Date(now),
      lastReauthAt: new Date(now),
      expiresAt: new Date(expiresAt),
    })
    .returning({ id: sessions.id });

  return { rawToken, sessionId: inserted!.id, tokenHash: storedHash };
}

export async function getSessionTimeoutMinutes(): Promise<number> {
  if (isUsingDemoStore()) {
    return demoStore.settings.sessionTimeoutMinutes;
  }
  const db = getDb();
  const [row] = await db
    .select({ sessionTimeoutMinutes: systemSettings.sessionTimeoutMinutes })
    .from(systemSettings)
    .where(eq(systemSettings.id, 'default'))
    .limit(1);
  return row?.sessionTimeoutMinutes ?? DEFAULT_SYSTEM_SETTINGS.sessionTimeoutMinutes;
}

export async function getMinPasswordLength(): Promise<number> {
  if (isUsingDemoStore()) {
    return demoStore.settings.minPasswordLength;
  }
  const db = getDb();
  const [row] = await db
    .select({ minPasswordLength: systemSettings.minPasswordLength })
    .from(systemSettings)
    .where(eq(systemSettings.id, 'default'))
    .limit(1);
  return row?.minPasswordLength ?? DEFAULT_SYSTEM_SETTINGS.minPasswordLength;
}

// ---------------------------------------------------------------------------
// Sync actor resolver (called from app.ts) + Async session auth hook
// ---------------------------------------------------------------------------

export function resolveRequestActor(request: FastifyRequest): RequestActor {
  // In DEMO_MODE (before Neon/Cloud SQL is provisioned), allow explicit role preview header
  // defaulting to estimator_approver when no session cookie is present.
  if (isDemoMode() && !request.cookies?.[SESSION_COOKIE_NAME]) {
    const headerRole = String(request.headers['x-demo-role'] ?? 'estimator_approver') as UserRole;
    const role: UserRole = VALID_ROLES.has(headerRole) ? headerRole : 'estimator_approver';
    const rawSubHeader = request.headers['x-demo-sub-id'];
    const subCompanyId =
      role === 'subcontractor'
        ? rawSubHeader === ''
          ? null
          : String(rawSubHeader ?? demoStore.subcontractors[0]?.id ?? 'sub-red-cliffs')
        : null;

    const matchedUser = demoStore.users.find((u) => u.role === role) ?? demoStore.users[0]!;
    return {
      userId: matchedUser.id,
      email: matchedUser.email,
      fullName: matchedUser.fullName,
      role,
      subCompanyId,
      approvalLimitCents: matchedUser.approvalLimitCents,
      lastReauthAt: Date.now(),
      mfaEnabled: false,
      authenticated: true,
    };
  }

  // Unauthenticated placeholder; authenticateRequest async preHandler populates real session actor
  return {
    userId: 'anonymous',
    email: 'anonymous@interstatehomes.com',
    fullName: 'Anonymous',
    role: 'homeowner',
    subCompanyId: null,
    approvalLimitCents: null,
    lastReauthAt: 0,
    mfaEnabled: false,
    authenticated: false,
  };
}

export async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const mode = getRuntimeMode();
  const publicRoute = isPublicPath(request.url);
  const rawToken = request.cookies?.[SESSION_COOKIE_NAME];

  // Demo mode without session cookie: keep header-based role preview resolved by resolveRequestActor
  if (mode === 'demo' && !rawToken) {
    request.sessionId = null;
    request.sessionTokenHash = null;
    request.mfaPending = false;
    return;
  }

  // Postgres mode (never fall back to x-demo-role)
  if (mode === 'postgres') {
    if (!rawToken) {
      request.sessionId = null;
      request.sessionTokenHash = null;
      request.mfaPending = false;
      if (publicRoute) return;
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required.',
        authenticated: false,
        mode: 'postgres',
      });
    }

    if (!isDatabaseConfigured()) {
      if (publicRoute) return;
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Database is not configured for Postgres session verification.',
        authenticated: false,
        mode: 'postgres',
      });
    }

    const baseHash = hashToken(rawToken);
    const pendingHash = `${PENDING_MFA_PREFIX}${baseHash}`;
    const db = getDb();

    const rows = await db
      .select({
        sessionId: sessions.id,
        tokenHash: sessions.tokenHash,
        lastActivityAt: sessions.lastActivityAt,
        lastReauthAt: sessions.lastReauthAt,
        expiresAt: sessions.expiresAt,
        userId: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        subCompanyId: users.subCompanyId,
        approvalLimitCents: users.approvalLimitCents,
        status: users.status,
        mfaEnabled: users.mfaEnabled,
        mfaSecretEncrypted: users.mfaSecretEncrypted,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(inArray(sessions.tokenHash, [baseHash, pendingHash]), isNull(sessions.revokedAt)))
      .limit(1);

    const record = rows[0];
    if (!record || record.status !== 'active' || record.expiresAt.getTime() <= Date.now()) {
      clearSessionCookie(reply, request);
      if (publicRoute) return;
      return reply.status(401).send({
        error: 'SessionExpired',
        message: 'Session is invalid or expired.',
        authenticated: false,
        mode: 'postgres',
      });
    }

    const timeoutMinutes = await getSessionTimeoutMinutes();
    const idleMs = Date.now() - record.lastActivityAt.getTime();
    if (idleMs > timeoutMinutes * 60_000) {
      await db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.id, record.sessionId));
      clearSessionCookie(reply, request);
      if (publicRoute) return;
      return reply.status(401).send({
        error: 'SessionTimeout',
        message: `Session expired after ${timeoutMinutes} minutes of inactivity.`,
        authenticated: false,
        mode: 'postgres',
        sessionTimeoutMinutes: timeoutMinutes,
      });
    }

    const isPendingMfa = record.tokenHash.startsWith(PENDING_MFA_PREFIX);
    const role: UserRole = VALID_ROLES.has(record.role as UserRole)
      ? (record.role as UserRole)
      : 'homeowner';

    request.sessionId = record.sessionId;
    request.sessionTokenHash = record.tokenHash;
    request.mfaPending = isPendingMfa;
    request.actor = {
      userId: record.userId,
      email: record.email,
      fullName: record.fullName,
      role,
      subCompanyId: record.subCompanyId ?? null,
      approvalLimitCents: record.approvalLimitCents ?? null,
      lastReauthAt: record.lastReauthAt.getTime(),
      mfaEnabled: Boolean(record.mfaEnabled && record.mfaSecretEncrypted),
      authenticated: !isPendingMfa,
    };

    if (isPendingMfa) {
      if (publicRoute) return;
      return reply.status(401).send({
        error: 'MfaRequired',
        message: 'MFA verification is required to complete sign-in.',
        mfaRequired: true,
        authenticated: false,
        mode: 'postgres',
      });
    }

    await db
      .update(sessions)
      .set({ lastActivityAt: new Date() })
      .where(eq(sessions.id, record.sessionId));
    return;
  }

  // Demo mode WITH ih_session cookie: enforce full session, timeout, and MFA state in memory
  const memSession = getDemoSessionByToken(rawToken!);
  if (!memSession || memSession.revokedAt !== null || memSession.expiresAt <= Date.now()) {
    clearSessionCookie(reply, request);
    if (publicRoute) return;
    return reply.status(401).send({
      error: 'SessionExpired',
      message: 'Session is invalid or expired.',
      authenticated: false,
      mode: 'demo',
    });
  }

  const timeoutMinutes = demoStore.settings.sessionTimeoutMinutes;
  if (Date.now() - memSession.lastActivityAt > timeoutMinutes * 60_000) {
    memSession.revokedAt = Date.now();
    clearSessionCookie(reply, request);
    if (publicRoute) return;
    return reply.status(401).send({
      error: 'SessionTimeout',
      message: `Session expired after ${timeoutMinutes} minutes of inactivity.`,
      authenticated: false,
      mode: 'demo',
      sessionTimeoutMinutes: timeoutMinutes,
    });
  }

  const demoUser = demoStore.users.find((u) => u.id === memSession.userId);
  const authState = demoUser ? await getOrInitDemoAuthState(demoUser.id) : null;
  if (!demoUser || !authState || authState.status !== 'active') {
    memSession.revokedAt = Date.now();
    clearSessionCookie(reply, request);
    if (publicRoute) return;
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'User account is inactive or locked.',
      authenticated: false,
      mode: 'demo',
    });
  }

  request.sessionId = memSession.id;
  request.sessionTokenHash = memSession.tokenHash;
  request.mfaPending = memSession.mfaPending;
  request.actor = {
    userId: demoUser.id,
    email: demoUser.email,
    fullName: demoUser.fullName,
    role: demoUser.role,
    subCompanyId: demoUser.subCompanyId,
    approvalLimitCents: demoUser.approvalLimitCents,
    lastReauthAt: memSession.lastReauthAt,
    mfaEnabled: Boolean(authState.mfaEnabled && authState.mfaSecretEncrypted),
    authenticated: !memSession.mfaPending,
  };

  if (memSession.mfaPending) {
    if (publicRoute) return;
    return reply.status(401).send({
      error: 'MfaRequired',
      message: 'MFA verification is required to complete sign-in.',
      mfaRequired: true,
      authenticated: false,
      mode: 'demo',
    });
  }

  memSession.lastActivityAt = Date.now();
}

export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!canAccess(request.actor.role, permission)) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: `Role "${request.actor.role}" lacks permission "${permission}".`,
      });
    }
  };
}

export function requireRecentReauth(maxAgeMinutes = 15) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const ageMs = Date.now() - request.actor.lastReauthAt;
    if (ageMs > maxAgeMinutes * 60_000) {
      return reply.status(401).send({
        error: 'ReauthRequired',
        message: 'Recent re-authentication is required before signing a PO or approving a budget.',
      });
    }
  };
}
