import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  DEFAULT_SYSTEM_SETTINGS,
  updateSystemSettingsSchema,
  type SystemSettingsConfig,
  type UserRole,
} from '@interstate/shared';
import { demoStore } from '../data/demo-store.js';
import { getDb } from '../db/client.js';
import {
  auditLogs,
  dimHomes,
  dimSubcontractors,
  estimateLines,
  estimates,
  factBudgets,
  factEstimates,
  factPurchaseOrders,
  factQuotes,
  homes,
  jobCostBudgets,
  purchaseOrders,
  quotes,
  sessions,
  subCompanies,
  systemSettings,
  users,
  warehouseRefreshRuns,
} from '../db/schema/index.js';
import {
  getMinPasswordLength,
  getOrInitDemoAuthState,
  isUsingDemoStore,
  requirePermission,
  revokeUserDemoSessions,
  setDemoAuthState,
} from '../security/auth-plugin.js';
import { isValidUuid, writeAuditLog } from '../security/audit.js';
import { hashPassword } from '../security/crypto.js';

const userRoleSchema = z.enum([
  'admin',
  'estimator_approver',
  'project_manager',
  'subcontractor',
  'homeowner',
]);

const createAdminUserSchema = z.object({
  email: z.string().email().max(200),
  fullName: z.string().min(1).max(120),
  role: userRoleSchema,
  password: z.string().min(1).max(200).optional(),
  subCompanyId: z.string().nullable().optional(),
  approvalLimitCents: z.number().int().nonnegative().nullable().optional(),
});

const updateAdminUserSchema = z.object({
  role: userRoleSchema.optional(),
  status: z.enum(['active', 'disabled', 'locked']).optional(),
  approvalLimitCents: z.number().int().nonnegative().nullable().optional(),
  subCompanyId: z.string().nullable().optional(),
  unlock: z.boolean().optional(),
  resetMfa: z.boolean().optional(),
});

function mapSettingsRow(row: typeof systemSettings.$inferSelect | undefined): SystemSettingsConfig {
  if (!row) return { ...DEFAULT_SYSTEM_SETTINGS };
  return {
    minPasswordLength: row.minPasswordLength,
    sessionTimeoutMinutes: row.sessionTimeoutMinutes,
    inactiveDisableDays: row.inactiveDisableDays,
    auditRetentionYears: row.auditRetentionYears,
    breachNoticeHours: row.breachNoticeHours,
    maxPlanUploadMb: row.maxPlanUploadMb,
    warehouseRefreshSchedule: row.warehouseRefreshSchedule,
    coiReminderDays: row.coiReminderDaysJson,
    requireMasterAgreement: row.requireMasterAgreement,
    currentMasterAgreementVersion: row.currentMasterAgreementVersion,
    defaultGlMinLimitCents: row.defaultGlMinLimitCents,
    defaultAutoMinLimitCents: row.defaultAutoMinLimitCents,
    poNumberFormat: row.poNumberFormat,
  };
}

export async function registerAdminRoutes(app: FastifyInstance) {
  app.get(
    '/api/admin/settings',
    {
      preHandler: [requirePermission('budgets:view')],
      schema: { tags: ['Admin'] },
    },
    async () => {
      if (isUsingDemoStore()) {
        return { settings: demoStore.settings };
      }
      const db = getDb();
      const [row] = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.id, 'default'))
        .limit(1);
      return { settings: mapSettingsRow(row) };
    }
  );

  app.patch(
    '/api/admin/settings',
    {
      preHandler: [requirePermission('settings:manage')],
      schema: { tags: ['Admin'] },
    },
    async (request, reply) => {
      const parsed = updateSystemSettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
      }

      if (isUsingDemoStore()) {
        const before = { ...demoStore.settings };
        Object.assign(demoStore.settings, parsed.data);

        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'SYSTEM_SETTINGS_UPDATED',
          entityType: 'system_settings',
          entityId: 'default',
          ipAddress: request.ip,
          beforeValues: before as unknown as Record<string, unknown>,
          afterValues: demoStore.settings as unknown as Record<string, unknown>,
        });

        return { settings: demoStore.settings };
      }

      const db = getDb();
      const [existing] = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.id, 'default'))
        .limit(1);

      const before = mapSettingsRow(existing);
      const next: SystemSettingsConfig = { ...before, ...parsed.data };

      const [updated] = await db
        .insert(systemSettings)
        .values({
          id: 'default',
          minPasswordLength: next.minPasswordLength,
          sessionTimeoutMinutes: next.sessionTimeoutMinutes,
          inactiveDisableDays: next.inactiveDisableDays,
          auditRetentionYears: next.auditRetentionYears,
          breachNoticeHours: next.breachNoticeHours,
          maxPlanUploadMb: next.maxPlanUploadMb,
          warehouseRefreshSchedule: next.warehouseRefreshSchedule,
          coiReminderDaysJson: next.coiReminderDays,
          requireMasterAgreement: next.requireMasterAgreement,
          currentMasterAgreementVersion: next.currentMasterAgreementVersion,
          defaultGlMinLimitCents: next.defaultGlMinLimitCents,
          defaultAutoMinLimitCents: next.defaultAutoMinLimitCents,
          poNumberFormat: next.poNumberFormat,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: systemSettings.id,
          set: {
            minPasswordLength: next.minPasswordLength,
            sessionTimeoutMinutes: next.sessionTimeoutMinutes,
            inactiveDisableDays: next.inactiveDisableDays,
            auditRetentionYears: next.auditRetentionYears,
            breachNoticeHours: next.breachNoticeHours,
            maxPlanUploadMb: next.maxPlanUploadMb,
            warehouseRefreshSchedule: next.warehouseRefreshSchedule,
            coiReminderDaysJson: next.coiReminderDays,
            requireMasterAgreement: next.requireMasterAgreement,
            currentMasterAgreementVersion: next.currentMasterAgreementVersion,
            defaultGlMinLimitCents: next.defaultGlMinLimitCents,
            defaultAutoMinLimitCents: next.defaultAutoMinLimitCents,
            poNumberFormat: next.poNumberFormat,
            updatedAt: new Date(),
          },
        })
        .returning();

      const mapped = mapSettingsRow(updated);
      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'SYSTEM_SETTINGS_UPDATED',
        entityType: 'system_settings',
        entityId: 'default',
        ipAddress: request.ip,
        beforeValues: before as unknown as Record<string, unknown>,
        afterValues: mapped as unknown as Record<string, unknown>,
      });

      return { settings: mapped };
    }
  );

  app.get(
    '/api/admin/users',
    {
      preHandler: [requirePermission('users:manage')],
      schema: { tags: ['Admin'] },
    },
    async () => {
      if (isUsingDemoStore()) {
        const enriched = await Promise.all(
          demoStore.users.map(async (u) => {
            const authState = await getOrInitDemoAuthState(u.id);
            return {
              ...u,
              status: authState?.status ?? u.status,
              mfaEnabled: Boolean(authState?.mfaEnabled && authState?.mfaSecretEncrypted),
              failedLoginAttempts: authState?.failedLoginAttempts ?? 0,
            };
          })
        );
        return { users: enriched };
      }

      const db = getDb();
      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          role: users.role,
          subCompanyId: users.subCompanyId,
          status: users.status,
          mfaEnabled: users.mfaEnabled,
          mfaSecretEncrypted: users.mfaSecretEncrypted,
          approvalLimitCents: users.approvalLimitCents,
          failedLoginAttempts: users.failedLoginAttempts,
          lastLoginAt: users.lastLoginAt,
        })
        .from(users)
        .orderBy(desc(users.createdAt));

      return {
        users: rows.map((u) => ({
          id: u.id,
          email: u.email,
          fullName: u.fullName,
          role: u.role,
          subCompanyId: u.subCompanyId,
          status: u.status,
          mfaEnabled: Boolean(u.mfaEnabled && u.mfaSecretEncrypted),
          approvalLimitCents: u.approvalLimitCents,
          failedLoginAttempts: u.failedLoginAttempts,
          lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
        })),
      };
    }
  );

  app.post(
    '/api/admin/users',
    {
      preHandler: [requirePermission('users:manage')],
      schema: { tags: ['Admin'], summary: 'Create/invite a user account with scrypt password' },
    },
    async (request, reply) => {
      const parsed = createAdminUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
      }
      const d = parsed.data;
      const emailNormalized = d.email.trim().toLowerCase();
      const minLen = await getMinPasswordLength();

      let generatedPassword: string | undefined;
      const plainPassword =
        d.password && d.password.length > 0
          ? d.password
          : (generatedPassword = `IH-${crypto.randomBytes(10).toString('base64url')}!9`);

      if (plainPassword.length < minLen) {
        return reply.status(400).send({
          error: 'WeakPassword',
          message: `Password must be at least ${minLen} characters long.`,
        });
      }

      const passwordHash = await hashPassword(plainPassword);
      const subCompanyId =
        d.role === 'subcontractor' && d.subCompanyId ? d.subCompanyId : null;

      if (isUsingDemoStore()) {
        if (demoStore.users.some((u) => u.email.toLowerCase() === emailNormalized)) {
          return reply.status(409).send({
            error: 'DuplicateEmail',
            message: `A user with email "${emailNormalized}" already exists.`,
          });
        }
        const id = `usr-${Date.now().toString(36)}`;
        const newUser = {
          id,
          email: emailNormalized,
          fullName: d.fullName.trim(),
          role: d.role as UserRole,
          subCompanyId,
          status: 'active' as const,
          approvalLimitCents: d.approvalLimitCents ?? null,
          lastLoginAt: '',
        };
        demoStore.users.unshift(newUser);
        setDemoAuthState(id, {
          userId: id,
          passwordHash,
          mfaEnabled: false,
          mfaSecretEncrypted: null,
          failedLoginAttempts: 0,
          status: 'active',
        });

        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'USER_CREATED',
          entityType: 'user',
          entityId: id,
          ipAddress: request.ip,
          afterValues: { email: emailNormalized, role: d.role, subCompanyId },
        });

        return reply.status(201).send({
          user: {
            ...newUser,
            mfaEnabled: false,
            failedLoginAttempts: 0,
          },
          ...(generatedPassword ? { temporaryPassword: generatedPassword } : {}),
        });
      }

      const db = getDb();
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${emailNormalized}`)
        .limit(1);
      if (existing) {
        return reply.status(409).send({
          error: 'DuplicateEmail',
          message: `A user with email "${emailNormalized}" already exists.`,
        });
      }

      let validSubId: string | null = null;
      if (subCompanyId) {
        if (!isValidUuid(subCompanyId)) {
          return reply.status(400).send({ error: 'InvalidSubcontractorId' });
        }
        const [subRow] = await db
          .select({ id: subCompanies.id })
          .from(subCompanies)
          .where(eq(subCompanies.id, subCompanyId))
          .limit(1);
        if (!subRow) {
          return reply.status(404).send({ error: 'SubcontractorNotFound' });
        }
        validSubId = subRow.id;
      }

      const [inserted] = await db
        .insert(users)
        .values({
          email: emailNormalized,
          fullName: d.fullName.trim(),
          role: d.role,
          subCompanyId: validSubId,
          passwordHash,
          mfaEnabled: false,
          approvalLimitCents: d.approvalLimitCents ?? null,
          status: 'active',
          failedLoginAttempts: 0,
        })
        .returning();

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'USER_CREATED',
        entityType: 'user',
        entityId: inserted!.id,
        ipAddress: request.ip,
        afterValues: { email: emailNormalized, role: d.role, subCompanyId: validSubId },
      });

      return reply.status(201).send({
        user: {
          id: inserted!.id,
          email: inserted!.email,
          fullName: inserted!.fullName,
          role: inserted!.role,
          subCompanyId: inserted!.subCompanyId,
          status: inserted!.status,
          mfaEnabled: false,
          approvalLimitCents: inserted!.approvalLimitCents,
          failedLoginAttempts: inserted!.failedLoginAttempts,
          lastLoginAt: null,
        },
        ...(generatedPassword ? { temporaryPassword: generatedPassword } : {}),
      });
    }
  );

  app.patch(
    '/api/admin/users/:id',
    {
      preHandler: [requirePermission('users:manage')],
      schema: {
        tags: ['Admin'],
        summary: 'Update user role/status/approval limit, unlock locked account, or reset MFA',
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateAdminUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
      }
      const d = parsed.data;

      if (isUsingDemoStore()) {
        const user = demoStore.users.find((u) => u.id === id);
        if (!user) return reply.status(404).send({ error: 'UserNotFound' });
        const authState = (await getOrInitDemoAuthState(user.id))!;

        const before = {
          role: user.role,
          status: authState.status,
          approvalLimitCents: user.approvalLimitCents,
          failedLoginAttempts: authState.failedLoginAttempts,
          mfaEnabled: authState.mfaEnabled,
        };

        if (d.role !== undefined) user.role = d.role;
        if (d.approvalLimitCents !== undefined) user.approvalLimitCents = d.approvalLimitCents;
        if (d.subCompanyId !== undefined) user.subCompanyId = d.subCompanyId;

        if (d.unlock || d.status === 'active') {
          authState.status = 'active';
          authState.failedLoginAttempts = 0;
          user.status = 'active';
        } else if (d.status === 'disabled' || d.status === 'locked') {
          authState.status = d.status;
          user.status = d.status === 'disabled' ? 'disabled' : 'active';
          revokeUserDemoSessions(user.id);
        }

        if (d.resetMfa) {
          authState.mfaEnabled = false;
          authState.mfaSecretEncrypted = null;
        }

        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'USER_UPDATED',
          entityType: 'user',
          entityId: user.id,
          ipAddress: request.ip,
          beforeValues: before,
          afterValues: {
            role: user.role,
            status: authState.status,
            approvalLimitCents: user.approvalLimitCents,
            failedLoginAttempts: authState.failedLoginAttempts,
            mfaEnabled: authState.mfaEnabled,
          },
        });

        return {
          user: {
            ...user,
            status: authState.status,
            mfaEnabled: Boolean(authState.mfaEnabled && authState.mfaSecretEncrypted),
            failedLoginAttempts: authState.failedLoginAttempts,
          },
        };
      }

      if (!isValidUuid(id)) {
        return reply.status(404).send({ error: 'UserNotFound' });
      }
      const db = getDb();
      const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!existing) return reply.status(404).send({ error: 'UserNotFound' });

      const nextStatus =
        d.unlock || d.status === 'active'
          ? 'active'
          : d.status !== undefined
            ? d.status
            : existing.status;

      const nextFailedAttempts =
        d.unlock || d.status === 'active' ? 0 : existing.failedLoginAttempts;

      const nextSubId =
        d.subCompanyId === undefined
          ? existing.subCompanyId
          : d.subCompanyId === null
            ? null
            : isValidUuid(d.subCompanyId)
              ? d.subCompanyId
              : null;

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(users)
          .set({
            role: d.role ?? existing.role,
            status: nextStatus,
            failedLoginAttempts: nextFailedAttempts,
            approvalLimitCents:
              d.approvalLimitCents !== undefined
                ? d.approvalLimitCents
                : existing.approvalLimitCents,
            subCompanyId: nextSubId,
            mfaEnabled: d.resetMfa ? false : existing.mfaEnabled,
            mfaSecretEncrypted: d.resetMfa ? null : existing.mfaSecretEncrypted,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existing.id))
          .returning();

        if (nextStatus !== 'active') {
          await tx
            .update(sessions)
            .set({ revokedAt: new Date() })
            .where(and(eq(sessions.userId, existing.id), isNull(sessions.revokedAt)));
        }

        return row!;
      });

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'USER_UPDATED',
        entityType: 'user',
        entityId: updated.id,
        ipAddress: request.ip,
        beforeValues: {
          role: existing.role,
          status: existing.status,
          approvalLimitCents: existing.approvalLimitCents,
          failedLoginAttempts: existing.failedLoginAttempts,
        },
        afterValues: {
          role: updated.role,
          status: updated.status,
          approvalLimitCents: updated.approvalLimitCents,
          failedLoginAttempts: updated.failedLoginAttempts,
        },
      });

      return {
        user: {
          id: updated.id,
          email: updated.email,
          fullName: updated.fullName,
          role: updated.role,
          subCompanyId: updated.subCompanyId,
          status: updated.status,
          mfaEnabled: Boolean(updated.mfaEnabled && updated.mfaSecretEncrypted),
          approvalLimitCents: updated.approvalLimitCents,
          failedLoginAttempts: updated.failedLoginAttempts,
          lastLoginAt: updated.lastLoginAt ? updated.lastLoginAt.toISOString() : null,
        },
      };
    }
  );

  app.get(
    '/api/admin/audit-logs',
    {
      preHandler: [requirePermission('audit_log:view')],
      schema: { tags: ['Admin'] },
    },
    async () => {
      if (isUsingDemoStore()) {
        return { auditLogs: demoStore.auditLogs };
      }

      const db = getDb();
      const rows = await db
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt))
        .limit(200);

      return {
        auditLogs: rows.map((r) => ({
          id: r.id,
          actorUserId: r.actorUserId,
          actorEmail: r.actorEmail ?? 'system@interstatehomes.com',
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          homeId: r.homeId,
          ipAddress: r.ipAddress ?? '',
          beforeValues: r.beforeValues,
          afterValues: r.afterValues,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    }
  );

  app.post(
    '/api/admin/warehouse/refresh',
    {
      preHandler: [requirePermission('settings:manage')],
      schema: {
        tags: ['Admin'],
        summary: 'Admin-only manual refresh of warehouse dimension and fact tables',
      },
    },
    async (request, reply) => {
      if (isUsingDemoStore()) {
        const factEstimatesCount = Array.from(demoStore.estimates.values()).reduce(
          (sum, e) => sum + e.lines.length,
          0
        );
        const tables = {
          dimHomes: demoStore.homes.length,
          dimSubcontractors: demoStore.subcontractors.length,
          factEstimates: factEstimatesCount,
          factQuotes: demoStore.quotes.length,
          factPurchaseOrders: demoStore.purchaseOrders.length,
          factBudgets: demoStore.jobCostBudgets.length,
        };
        const rowsWritten = Object.values(tables).reduce((a, b) => a + b, 0);
        const runId = `wh-demo-${Date.now().toString(36)}`;

        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'WAREHOUSE_REFRESHED',
          entityType: 'warehouse_refresh_run',
          entityId: runId,
          ipAddress: request.ip,
          afterValues: { mode: 'demo', rowsWritten, tables },
        });

        return {
          ok: true,
          mode: 'demo',
          runId,
          status: 'succeeded',
          rowsWritten,
          tables,
          finishedAt: new Date().toISOString(),
        };
      }

      const db = getDb();
      const startedAt = new Date();
      const [run] = await db
        .insert(warehouseRefreshRuns)
        .values({
          triggerType: 'manual',
          status: 'running',
          rowsWritten: 0,
          startedAt,
        })
        .returning();

      try {
        const snapshotDate = startedAt.toISOString().slice(0, 10);
        const now = new Date();

        const tables = await db.transaction(async (tx) => {
          const [homeRows, subRows, estRows, lineRows, quoteRows, poRows, budgetRows] =
            await Promise.all([
              tx.select().from(homes),
              tx.select().from(subCompanies),
              tx.select().from(estimates),
              tx.select().from(estimateLines),
              tx.select().from(quotes),
              tx.select().from(purchaseOrders),
              tx.select().from(jobCostBudgets),
            ]);

          const estMap = new Map(estRows.map((e) => [e.id, e]));

          // 1. dim_homes
          await tx.delete(dimHomes);
          if (homeRows.length > 0) {
            await tx.insert(dimHomes).values(
              homeRows.map((h) => ({
                homeId: h.id,
                homeCode: h.homeCode,
                subdivisionCode: h.subdivisionCode,
                planName: h.planName,
                finishedSqFt: h.finishedSqFt,
                stage: h.stage,
                refreshedAt: now,
              }))
            );
          }

          // 2. dim_subcontractors
          await tx.delete(dimSubcontractors);
          if (subRows.length > 0) {
            await tx.insert(dimSubcontractors).values(
              subRows.map((s) => ({
                subCompanyId: s.id,
                legalName: s.legalName,
                companyType: s.companyType,
                status: s.status,
                refreshedAt: now,
              }))
            );
          }

          // 3. fact_estimates (idempotent per snapshotDate)
          await tx.delete(factEstimates).where(eq(factEstimates.snapshotDate, snapshotDate));
          const factEstValues = lineRows
            .map((l) => {
              const est = estMap.get(l.estimateId);
              if (!est) return null;
              return {
                homeId: est.homeId,
                estimateId: est.id,
                versionNumber: est.versionNumber,
                costCode: l.costCode,
                estimatedCents: l.extendedCents,
                snapshotDate,
              };
            })
            .filter((v): v is NonNullable<typeof v> => v !== null);
          if (factEstValues.length > 0) {
            await tx.insert(factEstimates).values(factEstValues);
          }

          // 4. fact_quotes (idempotent per snapshotDate)
          await tx.delete(factQuotes).where(eq(factQuotes.snapshotDate, snapshotDate));
          if (quoteRows.length > 0) {
            await tx.insert(factQuotes).values(
              quoteRows.map((q) => ({
                quoteId: q.id,
                homeId: q.homeId,
                subCompanyId: q.subCompanyId,
                costCode: q.costCode,
                status: q.status,
                quotedTotalCents: q.quotedTotalCents,
                snapshotDate,
              }))
            );
          }

          // 5. fact_purchase_orders (idempotent per snapshotDate)
          await tx
            .delete(factPurchaseOrders)
            .where(eq(factPurchaseOrders.snapshotDate, snapshotDate));
          if (poRows.length > 0) {
            await tx.insert(factPurchaseOrders).values(
              poRows.map((p) => ({
                poId: p.id,
                poNumber: p.poNumber,
                homeId: p.homeId,
                subCompanyId: p.subCompanyId,
                costCode: p.costCode,
                poType: p.poType,
                totalCents: p.totalCents,
                status: p.status,
                snapshotDate,
              }))
            );
          }

          // 6. fact_budgets
          await tx.delete(factBudgets);
          if (budgetRows.length > 0) {
            await tx.insert(factBudgets).values(
              budgetRows.map((b) => ({
                homeId: b.homeId,
                homeCode: b.homeCode,
                costCode: b.costCode,
                budgetCents: b.budgetCents,
                estimateVersion: b.estimateVersion,
                loadedAt: b.loadedAt,
              }))
            );
          }

          return {
            dimHomes: homeRows.length,
            dimSubcontractors: subRows.length,
            factEstimates: factEstValues.length,
            factQuotes: quoteRows.length,
            factPurchaseOrders: poRows.length,
            factBudgets: budgetRows.length,
          };
        });

        const rowsWritten = Object.values(tables).reduce((a, b) => a + b, 0);
        const finishedAt = new Date();

        await db
          .update(warehouseRefreshRuns)
          .set({
            status: 'succeeded',
            rowsWritten,
            finishedAt,
          })
          .where(eq(warehouseRefreshRuns.id, run!.id));

        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'WAREHOUSE_REFRESHED',
          entityType: 'warehouse_refresh_run',
          entityId: run!.id,
          ipAddress: request.ip,
          afterValues: { mode: 'postgres', rowsWritten, tables },
        });

        return {
          ok: true,
          mode: 'postgres',
          runId: run!.id,
          status: 'succeeded',
          rowsWritten,
          tables,
          finishedAt: finishedAt.toISOString(),
        };
      } catch {
        await db
          .update(warehouseRefreshRuns)
          .set({ status: 'failed', finishedAt: new Date() })
          .where(eq(warehouseRefreshRuns.id, run!.id));
        return reply.status(500).send({
          error: 'WarehouseRefreshFailed',
          message: 'Warehouse refresh failed. Check server logs for details.',
          runId: run!.id,
        });
      }
    }
  );
}
