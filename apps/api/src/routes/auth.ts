import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { writeAuditLog } from '../security/audit.js';
import { demoStore } from '../data/demo-store.js';
import { getDb } from '../db/client.js';
import { sessions, users } from '../db/schema/index.js';
import {
  decryptSensitive,
  encryptSensitive,
  generateTotpSecret,
  hashPassword,
  hashToken,
  verifyPassword,
  verifyTotpToken,
} from '../security/crypto.js';
import {
  MAX_FAILED_LOGIN_ATTEMPTS,
  PENDING_MFA_PREFIX,
  SESSION_COOKIE_NAME,
  authenticateRequest,
  checkAuthAttemptLimit,
  clearAuthAttempts,
  clearSessionCookie,
  clearStagedPendingMfaSecret,
  createSessionForUser,
  deleteDemoSession,
  getDemoSessionByToken,
  getMinPasswordLength,
  getOrInitDemoAuthState,
  getRuntimeMode,
  getSessionTimeoutMinutes,
  getStagedPendingMfaSecret,
  isUsingDemoStore,
  recordFailedAuthAttempt,
  setSessionCookie,
  stagePendingMfaSecret,
} from '../security/auth-plugin.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const mfaVerifySchema = z
  .object({
    code: z.string().min(6).max(12).optional(),
    token: z.string().min(6).max(12).optional(),
  })
  .refine((v) => Boolean(v.code || v.token), {
    message: 'A 6-digit TOTP code is required.',
  });

const reauthSchema = z.object({
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1).max(200),
});

export async function registerAuthRoutes(app: FastifyInstance) {
  // Register async session & MFA verification hook on the root Fastify instance
  app.addHook('preHandler', authenticateRequest);

  app.get('/api/auth/me', { schema: { tags: ['Auth'] } }, async (request) => {
    const mode = getRuntimeMode();
    const sessionTimeoutMinutes = await getSessionTimeoutMinutes();
    return {
      authenticated: request.actor.authenticated ?? true,
      mode,
      user: {
        ...request.actor,
        id: request.actor.userId,
      },
      sessionTimeoutMinutes,
    };
  });

  app.post('/api/auth/login', { schema: { tags: ['Auth'] } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'InvalidCredentialsPayload' });
    }

    const emailNormalized = parsed.data.email.trim().toLowerCase();
    const userAgent =
      typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null;

    if (isUsingDemoStore()) {
      const user = demoStore.users.find((u) => u.email.toLowerCase() === emailNormalized);
      if (!user) {
        await writeAuditLog({
          actorUserId: null,
          actorEmail: emailNormalized,
          action: 'AUTH_LOGIN_FAILED',
          entityType: 'user',
          entityId: emailNormalized,
          ipAddress: request.ip,
          afterValues: { reason: 'user_not_found' },
        });
        return reply.status(401).send({ error: 'InvalidCredentials', message: 'Invalid email or password.' });
      }

      const authState = (await getOrInitDemoAuthState(user.id))!;
      if (authState.status === 'locked') {
        await writeAuditLog({
          actorUserId: user.id,
          actorEmail: user.email,
          action: 'AUTH_LOGIN_FAILED',
          entityType: 'user',
          entityId: user.id,
          ipAddress: request.ip,
          afterValues: { reason: 'account_locked' },
        });
        return reply.status(423).send({
          error: 'AccountLocked',
          message: 'Account is locked after too many failed login attempts. Contact an administrator.',
        });
      }
      if (authState.status === 'disabled') {
        await writeAuditLog({
          actorUserId: user.id,
          actorEmail: user.email,
          action: 'AUTH_LOGIN_FAILED',
          entityType: 'user',
          entityId: user.id,
          ipAddress: request.ip,
          afterValues: { reason: 'account_disabled' },
        });
        return reply.status(403).send({ error: 'AccountDisabled', message: 'User account is disabled.' });
      }

      const valid = await verifyPassword(parsed.data.password, authState.passwordHash);
      if (!valid) {
        authState.failedLoginAttempts += 1;
        const nowLocked = authState.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;
        if (nowLocked) {
          authState.status = 'locked';
        }
        await writeAuditLog({
          actorUserId: user.id,
          actorEmail: user.email,
          action: 'AUTH_LOGIN_FAILED',
          entityType: 'user',
          entityId: user.id,
          ipAddress: request.ip,
          afterValues: {
            failedLoginAttempts: authState.failedLoginAttempts,
            locked: nowLocked,
          },
        });
        if (nowLocked) {
          return reply.status(423).send({
            error: 'AccountLocked',
            message: 'Account locked after 5 failed login attempts.',
          });
        }
        return reply.status(401).send({
          error: 'InvalidCredentials',
          message: 'Invalid email or password.',
        });
      }

      authState.failedLoginAttempts = 0;
      user.lastLoginAt = new Date().toISOString();

      const mfaRequired = Boolean(authState.mfaEnabled && authState.mfaSecretEncrypted);
      const { rawToken } = await createSessionForUser({
        userId: user.id,
        mfaPending: mfaRequired,
        ipAddress: request.ip,
        userAgent,
      });
      setSessionCookie(reply, rawToken, request);

      await writeAuditLog({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'AUTH_LOGIN_SUCCESS',
        entityType: 'user',
        entityId: user.id,
        ipAddress: request.ip,
        afterValues: { mfaRequired },
      });

      return {
        mfaRequired,
        user: {
          id: user.id,
          userId: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          subCompanyId: user.subCompanyId,
          mfaEnabled: mfaRequired,
        },
      };
    }

    // Postgres mode
    const db = getDb();
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${emailNormalized}`)
      .limit(1);

    if (!user || !user.passwordHash) {
      await writeAuditLog({
        actorUserId: user?.id ?? null,
        actorEmail: emailNormalized,
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'user',
        entityId: user?.id ?? emailNormalized,
        ipAddress: request.ip,
        afterValues: { reason: 'user_not_found_or_no_password' },
      });
      return reply.status(401).send({ error: 'InvalidCredentials', message: 'Invalid email or password.' });
    }

    if (user.status === 'locked') {
      await writeAuditLog({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'user',
        entityId: user.id,
        ipAddress: request.ip,
        afterValues: { reason: 'account_locked' },
      });
      return reply.status(423).send({
        error: 'AccountLocked',
        message: 'Account is locked after too many failed login attempts. Contact an administrator.',
      });
    }

    if (user.status !== 'active') {
      await writeAuditLog({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'user',
        entityId: user.id,
        ipAddress: request.ip,
        afterValues: { reason: 'account_disabled' },
      });
      return reply.status(403).send({ error: 'AccountDisabled', message: 'User account is disabled.' });
    }

    const valid = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!valid) {
      // Atomic increment prevents concurrent brute-force past lockout threshold
      const [updated] = await db
        .update(users)
        .set({
          failedLoginAttempts: sql`${users.failedLoginAttempts} + 1`,
          status: sql`CASE WHEN ${users.failedLoginAttempts} + 1 >= ${MAX_FAILED_LOGIN_ATTEMPTS} THEN 'locked' ELSE ${users.status} END`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning({
          failedLoginAttempts: users.failedLoginAttempts,
          status: users.status,
        });

      const nextAttempts = updated?.failedLoginAttempts ?? user.failedLoginAttempts + 1;
      const nowLocked = updated?.status === 'locked' || nextAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;

      await writeAuditLog({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'user',
        entityId: user.id,
        ipAddress: request.ip,
        afterValues: { failedLoginAttempts: nextAttempts, locked: nowLocked },
      });

      if (nowLocked) {
        return reply.status(423).send({
          error: 'AccountLocked',
          message: 'Account locked after 5 failed login attempts.',
        });
      }
      return reply.status(401).send({ error: 'InvalidCredentials', message: 'Invalid email or password.' });
    }

    await db
      .update(users)
      .set({
        failedLoginAttempts: 0,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    const mfaRequired = Boolean(user.mfaEnabled && user.mfaSecretEncrypted);
    const { rawToken } = await createSessionForUser({
      userId: user.id,
      mfaPending: mfaRequired,
      ipAddress: request.ip,
      userAgent,
    });
    setSessionCookie(reply, rawToken, request);

    await writeAuditLog({
      actorUserId: user.id,
      actorEmail: user.email,
      action: 'AUTH_LOGIN_SUCCESS',
      entityType: 'user',
      entityId: user.id,
      ipAddress: request.ip,
      afterValues: { mfaRequired },
    });

    return {
      mfaRequired,
      user: {
        id: user.id,
        userId: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        subCompanyId: user.subCompanyId ?? null,
        mfaEnabled: mfaRequired,
      },
    };
  });

  app.post('/api/auth/mfa/setup', { schema: { tags: ['Auth'] } }, async (request, reply) => {
    if (!request.actor.authenticated || request.actor.userId === 'anonymous') {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
    }

    // If MFA is already active, require recent reauth before staging a secret rotation
    if (request.actor.mfaEnabled && Date.now() - request.actor.lastReauthAt > 15 * 60_000) {
      return reply.status(401).send({
        error: 'ReauthRequired',
        message: 'Recent re-authentication is required to rotate an existing MFA secret.',
      });
    }

    const secret = generateTotpSecret();
    const encrypted = encryptSensitive(secret);
    const label = encodeURIComponent(`Interstate Homes:${request.actor.email}`);
    const issuer = encodeURIComponent('Interstate Homes');
    const otpauthUri = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;

    // Stage pending secret so abandoning setup never breaks an active MFA enrollment
    stagePendingMfaSecret(request.actor.userId, encrypted);

    if (isUsingDemoStore()) {
      const authState = await getOrInitDemoAuthState(request.actor.userId);
      if (!authState) {
        return reply.status(404).send({ error: 'UserNotFound' });
      }
      if (!authState.mfaEnabled) {
        authState.mfaSecretEncrypted = encrypted;
      }
    } else if (!request.actor.mfaEnabled) {
      // For initial enrollment (mfaEnabled is false), persist encrypted secret for multi-instance Cloud Run
      const db = getDb();
      await db
        .update(users)
        .set({ mfaSecretEncrypted: encrypted, updatedAt: new Date() })
        .where(eq(users.id, request.actor.userId));
    }

    await writeAuditLog({
      actorUserId: request.actor.userId,
      actorEmail: request.actor.email,
      action: 'AUTH_MFA_SETUP_INITIATED',
      entityType: 'user',
      entityId: request.actor.userId,
      ipAddress: request.ip,
    });

    return { secret, otpauthUri };
  });

  app.post('/api/auth/mfa/verify', { schema: { tags: ['Auth'] } }, async (request, reply) => {
    const parsed = mfaVerifySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'InvalidMfaPayload', details: parsed.error.flatten() });
    }
    const totpCode = (parsed.data.code ?? parsed.data.token ?? '').trim();

    const rawToken = request.cookies?.[SESSION_COOKIE_NAME];
    if (!request.sessionId && !rawToken) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Active or pending session required.' });
    }

    if (isUsingDemoStore()) {
      const memSession = rawToken ? getDemoSessionByToken(rawToken) : undefined;
      if (!memSession || memSession.revokedAt !== null || memSession.expiresAt <= Date.now()) {
        return reply.status(401).send({ error: 'SessionExpired', message: 'Session is invalid or expired.' });
      }

      const limitCheck = checkAuthAttemptLimit('mfa', memSession.userId, 5);
      if (!limitCheck.allowed) {
        if (memSession.mfaPending) {
          memSession.revokedAt = Date.now();
          deleteDemoSession(memSession.tokenHash);
          clearSessionCookie(reply, request);
        }
        return reply.status(429).send({
          error: 'TooManyMfaAttempts',
          message: 'Too many invalid MFA verification attempts. Please sign in again.',
        });
      }

      const user = demoStore.users.find((u) => u.id === memSession.userId);
      const authState = user ? await getOrInitDemoAuthState(user.id) : null;
      const stagedSecret = user ? getStagedPendingMfaSecret(user.id) : null;
      const encryptedCandidate = !memSession.mfaPending && stagedSecret
        ? stagedSecret
        : authState?.mfaSecretEncrypted ?? stagedSecret;

      if (!user || !authState || !encryptedCandidate) {
        return reply.status(400).send({ error: 'MfaNotConfigured', message: 'MFA setup has not been initiated.' });
      }

      const secret = decryptSensitive(encryptedCandidate);
      if (!verifyTotpToken(secret, totpCode)) {
        const failedCount = recordFailedAuthAttempt('mfa', user.id);
        await writeAuditLog({
          actorUserId: user.id,
          actorEmail: user.email,
          action: 'AUTH_MFA_FAILED',
          entityType: 'user',
          entityId: user.id,
          ipAddress: request.ip,
          afterValues: { failedAttempts: failedCount },
        });
        if (failedCount >= 5 && memSession.mfaPending) {
          memSession.revokedAt = Date.now();
          deleteDemoSession(memSession.tokenHash);
          clearSessionCookie(reply, request);
          return reply.status(429).send({
            error: 'TooManyMfaAttempts',
            message: 'Too many invalid MFA attempts. Session revoked; please sign in again.',
          });
        }
        return reply.status(401).send({ error: 'InvalidMfaCode', message: 'Invalid 6-digit MFA code.' });
      }

      clearAuthAttempts('mfa', user.id);
      if (!memSession.mfaPending && stagedSecret) {
        authState.mfaSecretEncrypted = stagedSecret;
        clearStagedPendingMfaSecret(user.id);
      }
      authState.mfaEnabled = true;
      memSession.mfaPending = false;
      memSession.lastActivityAt = Date.now();
      memSession.lastReauthAt = Date.now();

      await writeAuditLog({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'AUTH_MFA_VERIFIED',
        entityType: 'session',
        entityId: memSession.id,
        ipAddress: request.ip,
      });

      return {
        ok: true,
        mfaVerified: true,
        user: {
          id: user.id,
          userId: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          subCompanyId: user.subCompanyId,
          mfaEnabled: true,
        },
      };
    }

    // Postgres mode
    if (!request.sessionId || request.actor.userId === 'anonymous') {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Valid session required for MFA verification.' });
    }

    const db = getDb();
    const limitCheck = checkAuthAttemptLimit('mfa', request.actor.userId, 5);
    if (!limitCheck.allowed) {
      if (request.mfaPending) {
        await db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.id, request.sessionId));
        clearSessionCookie(reply, request);
      }
      return reply.status(429).send({
        error: 'TooManyMfaAttempts',
        message: 'Too many invalid MFA verification attempts. Please sign in again.',
      });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, request.actor.userId))
      .limit(1);

    const stagedSecret = user ? getStagedPendingMfaSecret(user.id) : null;
    const encryptedCandidate = !request.mfaPending && stagedSecret
      ? stagedSecret
      : user?.mfaSecretEncrypted ?? stagedSecret;

    if (!user || !encryptedCandidate) {
      return reply.status(400).send({ error: 'MfaNotConfigured', message: 'MFA setup has not been initiated.' });
    }

    const secret = decryptSensitive(encryptedCandidate);
    if (!verifyTotpToken(secret, totpCode)) {
      const failedCount = recordFailedAuthAttempt('mfa', user.id);
      await writeAuditLog({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'AUTH_MFA_FAILED',
        entityType: 'user',
        entityId: user.id,
        ipAddress: request.ip,
        afterValues: { failedAttempts: failedCount },
      });
      if (failedCount >= 5 && request.mfaPending) {
        await db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.id, request.sessionId));
        clearSessionCookie(reply, request);
        return reply.status(429).send({
          error: 'TooManyMfaAttempts',
          message: 'Too many invalid MFA attempts. Session revoked; please sign in again.',
        });
      }
      return reply.status(401).send({ error: 'InvalidMfaCode', message: 'Invalid 6-digit MFA code.' });
    }

    clearAuthAttempts('mfa', user.id);
    const now = new Date();
    const cleanTokenHash = rawToken
      ? hashToken(rawToken)
      : (request.sessionTokenHash ?? '').replace(PENDING_MFA_PREFIX, '');

    await db
      .update(sessions)
      .set({
        tokenHash: cleanTokenHash,
        lastActivityAt: now,
        lastReauthAt: now,
      })
      .where(eq(sessions.id, request.sessionId));

    if (!user.mfaEnabled || (!request.mfaPending && stagedSecret)) {
      await db
        .update(users)
        .set({
          mfaEnabled: true,
          mfaSecretEncrypted: encryptedCandidate,
          updatedAt: now,
        })
        .where(eq(users.id, user.id));
      clearStagedPendingMfaSecret(user.id);
    }

    await writeAuditLog({
      actorUserId: user.id,
      actorEmail: user.email,
      action: 'AUTH_MFA_VERIFIED',
      entityType: 'session',
      entityId: request.sessionId,
      ipAddress: request.ip,
    });

    return {
      ok: true,
      mfaVerified: true,
      user: {
        id: user.id,
        userId: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        subCompanyId: user.subCompanyId ?? null,
        mfaEnabled: true,
      },
    };
  });

  app.post('/api/auth/reauth', { schema: { tags: ['Auth'] } }, async (request, reply) => {
    const parsed = reauthSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'InvalidReauthPayload', message: 'Password is required.' });
    }

    if (!request.actor.authenticated || request.actor.userId === 'anonymous') {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
    }

    const limitCheck = checkAuthAttemptLimit('reauth', request.actor.userId, 5);
    if (!limitCheck.allowed) {
      return reply.status(429).send({
        error: 'TooManyReauthAttempts',
        message: 'Too many failed re-authentication attempts. Please wait 15 minutes or sign in again.',
      });
    }

    const now = Date.now();

    if (isUsingDemoStore()) {
      const authState = await getOrInitDemoAuthState(request.actor.userId);
      if (!authState) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const valid = await verifyPassword(parsed.data.password, authState.passwordHash);
      if (!valid) {
        const attempts = recordFailedAuthAttempt('reauth', request.actor.userId);
        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'AUTH_REAUTH_FAILED',
          entityType: 'session',
          entityId: request.sessionId ?? request.actor.userId,
          ipAddress: request.ip,
          afterValues: { failedAttempts: attempts },
        });
        return reply.status(401).send({ error: 'InvalidCredentials', message: 'Password verification failed.' });
      }

      clearAuthAttempts('reauth', request.actor.userId);
      const rawToken = request.cookies?.[SESSION_COOKIE_NAME];
      if (rawToken) {
        const memSession = getDemoSessionByToken(rawToken);
        if (memSession) {
          memSession.lastReauthAt = now;
          memSession.lastActivityAt = now;
        }
      }
      request.actor.lastReauthAt = now;

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'AUTH_REAUTH_VERIFIED',
        entityType: 'session',
        entityId: request.sessionId ?? request.actor.userId,
        ipAddress: request.ip,
      });

      return { ok: true, reauthenticatedAt: new Date(now).toISOString() };
    }

    // Postgres mode
    const db = getDb();
    const [user] = await db
      .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, request.actor.userId))
      .limit(1);

    if (!user || !user.passwordHash) {
      return reply.status(401).send({ error: 'InvalidCredentials', message: 'Password verification failed.' });
    }

    const valid = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!valid) {
      const attempts = recordFailedAuthAttempt('reauth', user.id);
      await writeAuditLog({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'AUTH_REAUTH_FAILED',
        entityType: 'session',
        entityId: request.sessionId ?? user.id,
        ipAddress: request.ip,
        afterValues: { failedAttempts: attempts },
      });
      return reply.status(401).send({ error: 'InvalidCredentials', message: 'Password verification failed.' });
    }

    clearAuthAttempts('reauth', user.id);
    if (request.sessionId) {
      await db
        .update(sessions)
        .set({ lastReauthAt: new Date(now), lastActivityAt: new Date(now) })
        .where(eq(sessions.id, request.sessionId));
    }
    request.actor.lastReauthAt = now;

    await writeAuditLog({
      actorUserId: user.id,
      actorEmail: user.email,
      action: 'AUTH_REAUTH_VERIFIED',
      entityType: 'session',
      entityId: request.sessionId ?? user.id,
      ipAddress: request.ip,
    });

    return { ok: true, reauthenticatedAt: new Date(now).toISOString() };
  });

  app.post('/api/auth/change-password', { schema: { tags: ['Auth'] } }, async (request, reply) => {
    if (!request.actor.authenticated || request.actor.userId === 'anonymous') {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
    }

    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
    }

    const minLength = await getMinPasswordLength();
    if (parsed.data.newPassword.length < minLength) {
      return reply.status(400).send({
        error: 'WeakPassword',
        message: `New password must be at least ${minLength} characters long.`,
      });
    }

    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return reply.status(400).send({
        error: 'PasswordUnchanged',
        message: 'New password must be different from your current password.',
      });
    }

    const newHash = await hashPassword(parsed.data.newPassword);

    if (isUsingDemoStore()) {
      const authState = await getOrInitDemoAuthState(request.actor.userId);
      if (!authState) {
        return reply.status(404).send({ error: 'UserNotFound' });
      }
      const valid = await verifyPassword(parsed.data.currentPassword, authState.passwordHash);
      if (!valid) {
        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'AUTH_PASSWORD_CHANGE_FAILED',
          entityType: 'user',
          entityId: request.actor.userId,
          ipAddress: request.ip,
        });
        return reply.status(401).send({
          error: 'InvalidCredentials',
          message: 'Current password is incorrect.',
        });
      }

      authState.passwordHash = newHash;
      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'AUTH_PASSWORD_CHANGED',
        entityType: 'user',
        entityId: request.actor.userId,
        ipAddress: request.ip,
      });

      return { ok: true, message: 'Password updated successfully.' };
    }

    const db = getDb();
    const [user] = await db
      .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, request.actor.userId))
      .limit(1);

    if (!user || !user.passwordHash) {
      return reply.status(401).send({ error: 'InvalidCredentials', message: 'Current password is incorrect.' });
    }

    const valid = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
    if (!valid) {
      await writeAuditLog({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'AUTH_PASSWORD_CHANGE_FAILED',
        entityType: 'user',
        entityId: user.id,
        ipAddress: request.ip,
      });
      return reply.status(401).send({
        error: 'InvalidCredentials',
        message: 'Current password is incorrect.',
      });
    }

    await db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    await writeAuditLog({
      actorUserId: user.id,
      actorEmail: user.email,
      action: 'AUTH_PASSWORD_CHANGED',
      entityType: 'user',
      entityId: user.id,
      ipAddress: request.ip,
    });

    return { ok: true, message: 'Password updated successfully.' };
  });

  app.post('/api/auth/logout', { schema: { tags: ['Auth'] } }, async (request, reply) => {
    const rawToken = request.cookies?.[SESSION_COOKIE_NAME];

    if (isUsingDemoStore()) {
      if (rawToken) {
        const memSession = getDemoSessionByToken(rawToken);
        if (memSession) {
          memSession.revokedAt = Date.now();
          deleteDemoSession(memSession.tokenHash);
        }
      }
    } else if (request.sessionId) {
      const db = getDb();
      await db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.id, request.sessionId));
    } else if (rawToken) {
      const db = getDb();
      const baseHash = hashToken(rawToken);
      await db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.tokenHash, baseHash));
    }

    clearSessionCookie(reply, request);

    if (request.actor.userId !== 'anonymous') {
      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'AUTH_LOGOUT',
        entityType: 'session',
        entityId: request.sessionId ?? request.actor.userId,
        ipAddress: request.ip,
      });
    }

    return { ok: true };
  });
}
