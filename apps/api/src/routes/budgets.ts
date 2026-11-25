import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  INTERNAL_ONLY_COST_CODES,
  calculateFinalBudget,
  canAccess,
  costCodeTextSchema,
} from '@interstate/shared';
import { demoStore } from '../data/demo-store.js';
import { getDb } from '../db/client.js';
import {
  costCodes,
  estimateLines,
  estimates,
  homeBudgetFixedLines,
  homes,
  jobCostBudgets,
  purchaseOrders,
} from '../db/schema/index.js';
import {
  isUsingDemoStore,
  requirePermission,
  requireRecentReauth,
} from '../security/auth-plugin.js';
import { isValidUuid, writeAuditLog } from '../security/audit.js';

const fixedLineSchema = z.object({
  costCode: costCodeTextSchema,
  amountCents: z.number().int().nonnegative(),
  note: z.string().max(500).default(''),
});

export async function registerBudgetRoutes(app: FastifyInstance) {
  app.get(
    '/api/budgets',
    {
      preHandler: [requirePermission('budgets:view')],
      schema: { tags: ['Budgets'] },
    },
    async (request) => {
      const canSeeInternal = canAccess(request.actor.role, 'financials:view_internal');

      if (isUsingDemoStore()) {
        const summaries = demoStore.homes.map((home) => {
          const est = demoStore.estimates.get(home.id);
          const pos = demoStore.purchaseOrders.filter((p) => p.homeId === home.id);
          const fixed = demoStore.fixedBudgetEntries.filter((f) => f.homeId === home.id);
          const calc = calculateFinalBudget(
            (est?.lines ?? [])
              .filter((l) => canSeeInternal || !INTERNAL_ONLY_COST_CODES.has(l.costCode))
              .map((l) => ({
                costCode: l.costCode,
                costCodeName: l.costCodeName,
                pricingSource: l.pricingSource,
                estimatedAmountCents: l.extendedCents,
                isAllowanceOrFixed: l.isAllowanceOrFixed,
              })),
            pos.map((p) => ({ costCode: p.costCode, totalCents: p.totalCents, status: p.status })),
            fixed.map((f) => ({ costCode: f.costCode, amountCents: f.amountCents }))
          );

          return {
            homeId: home.id,
            homeCode: home.homeCode,
            planName: home.planName,
            stage: home.stage,
            estimateVersion: est?.versionNumber ?? 1,
            ...calc,
          };
        });

        const liveJobCostRows = demoStore.jobCostBudgets.filter(
          (r) => canSeeInternal || !INTERNAL_ONLY_COST_CODES.has(r.costCode)
        );

        return {
          budgets: summaries,
          liveJobCostRows,
        };
      }

      const db = getDb();
      const [homeRows, estRows, lineRows, codeRows, poRows, fixedRows, liveRows] =
        await Promise.all([
          db.select().from(homes).orderBy(desc(homes.createdAt)),
          db.select().from(estimates).orderBy(desc(estimates.versionNumber)),
          db.select().from(estimateLines),
          db.select().from(costCodes),
          db.select().from(purchaseOrders),
          db.select().from(homeBudgetFixedLines),
          db.select().from(jobCostBudgets).orderBy(desc(jobCostBudgets.loadedAt)),
        ]);

      const codeMap = new Map(codeRows.map((c) => [c.code, c]));
      const latestEstByHome = new Map<string, typeof estimates.$inferSelect>();
      for (const e of estRows) {
        if (!latestEstByHome.has(e.homeId)) {
          latestEstByHome.set(e.homeId, e);
        }
      }

      const linesByEstimate = new Map<string, Array<typeof estimateLines.$inferSelect>>();
      for (const l of lineRows) {
        const list = linesByEstimate.get(l.estimateId) ?? [];
        list.push(l);
        linesByEstimate.set(l.estimateId, list);
      }

      const posByHome = new Map<string, Array<typeof purchaseOrders.$inferSelect>>();
      for (const p of poRows) {
        const list = posByHome.get(p.homeId) ?? [];
        list.push(p);
        posByHome.set(p.homeId, list);
      }

      const fixedByHome = new Map<string, Array<typeof homeBudgetFixedLines.$inferSelect>>();
      for (const f of fixedRows) {
        const list = fixedByHome.get(f.homeId) ?? [];
        list.push(f);
        fixedByHome.set(f.homeId, list);
      }

      const summaries = homeRows.map((home) => {
        const est = latestEstByHome.get(home.id);
        const estLines = (est ? (linesByEstimate.get(est.id) ?? []) : [])
          .filter((l) => canSeeInternal || !INTERNAL_ONLY_COST_CODES.has(l.costCode))
          .sort(
            (a, b) =>
              (codeMap.get(a.costCode)?.sortOrder ?? 999) -
              (codeMap.get(b.costCode)?.sortOrder ?? 999)
          );
        const homePos = posByHome.get(home.id) ?? [];
        const homeFixed = fixedByHome.get(home.id) ?? [];

        const calc = calculateFinalBudget(
          estLines.map((l) => ({
            costCode: l.costCode,
            costCodeName: codeMap.get(l.costCode)?.name ?? l.costCode,
            pricingSource: l.pricingSource as 'sub' | 'supplier' | 'fixed' | 'allowance' | 'none',
            estimatedAmountCents: l.extendedCents,
            isAllowanceOrFixed: l.isAllowanceOrFixed,
          })),
          homePos.map((p) => ({ costCode: p.costCode, totalCents: p.totalCents, status: p.status })),
          homeFixed.map((f) => ({ costCode: f.costCode, amountCents: f.amountCents }))
        );

        return {
          homeId: home.id,
          homeCode: home.homeCode,
          planName: home.planName,
          stage: home.stage,
          estimateVersion: est?.versionNumber ?? 1,
          ...calc,
        };
      });

      const liveJobCostRows = liveRows
        .filter((r) => canSeeInternal || !INTERNAL_ONLY_COST_CODES.has(r.costCode))
        .map((r) => ({
          homeId: r.homeId,
          homeCode: r.homeCode,
          costCode: r.costCode,
          costCodeName: r.costCodeName,
          budgetCents: r.budgetCents,
          source: r.source,
          loadedAt: r.loadedAt.toISOString(),
          estimateVersion: r.estimateVersion,
        }));

      return {
        budgets: summaries,
        liveJobCostRows,
      };
    }
  );

  app.post(
    '/api/budgets/:homeId/fixed-lines',
    {
      preHandler: [requirePermission('estimates:build')],
      schema: {
        tags: ['Budgets'],
        summary: 'Upsert hand-entered fixed budget entry for a cost code (Rule 7)',
      },
    },
    async (request, reply) => {
      const { homeId } = request.params as { homeId: string };
      const parsed = fixedLineSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
      }
      const d = parsed.data;

      if (d.costCode === '00') {
        return reply.status(400).send({
          error: 'InvalidCostCode',
          message: 'Cost code "00" (Uncategorized) cannot carry a budget line.',
        });
      }

      if (isUsingDemoStore()) {
        const home = demoStore.homes.find((h) => h.id === homeId);
        if (!home) return reply.status(404).send({ error: 'HomeNotFound' });
        if (home.stage === 'live_budget') {
          return reply.status(409).send({
            error: 'BudgetLocked',
            message: 'This home already has an approved live budget and is locked against direct edits.',
          });
        }
        const existing = demoStore.fixedBudgetEntries.find(
          (f) => f.homeId === homeId && f.costCode === d.costCode
        );
        if (existing) {
          existing.amountCents = d.amountCents;
          existing.note = d.note;
        } else {
          demoStore.fixedBudgetEntries.push({
            homeId,
            costCode: d.costCode,
            amountCents: d.amountCents,
            note: d.note,
          });
        }
        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'BUDGET_FIXED_LINE_UPSERTED',
          entityType: 'home_budget_fixed_line',
          entityId: `${homeId}:${d.costCode}`,
          homeId,
          ipAddress: request.ip,
          afterValues: { costCode: d.costCode, amountCents: d.amountCents },
        });
        return {
          ok: true,
          entry: { homeId, costCode: d.costCode, amountCents: d.amountCents, note: d.note },
        };
      }

      if (!isValidUuid(homeId)) return reply.status(404).send({ error: 'HomeNotFound' });
      const db = getDb();
      const [home] = await db.select().from(homes).where(eq(homes.id, homeId)).limit(1);
      if (!home) return reply.status(404).send({ error: 'HomeNotFound' });
      if (home.stage === 'live_budget') {
        return reply.status(409).send({
          error: 'BudgetLocked',
          message: 'This home already has an approved live budget and is locked against direct edits.',
        });
      }

      const [existing] = await db
        .select()
        .from(homeBudgetFixedLines)
        .where(
          and(
            eq(homeBudgetFixedLines.homeId, homeId),
            eq(homeBudgetFixedLines.costCode, d.costCode)
          )
        )
        .limit(1);

      if (existing) {
        await db
          .update(homeBudgetFixedLines)
          .set({
            amountCents: d.amountCents,
            note: d.note,
            enteredBy: isValidUuid(request.actor.userId) ? request.actor.userId : null,
            updatedAt: new Date(),
          })
          .where(eq(homeBudgetFixedLines.id, existing.id));
      } else {
        await db.insert(homeBudgetFixedLines).values({
          homeId,
          costCode: d.costCode,
          amountCents: d.amountCents,
          note: d.note,
          enteredBy: isValidUuid(request.actor.userId) ? request.actor.userId : null,
        });
      }

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'BUDGET_FIXED_LINE_UPSERTED',
        entityType: 'home_budget_fixed_line',
        entityId: `${homeId}:${d.costCode}`,
        homeId,
        ipAddress: request.ip,
        afterValues: { costCode: d.costCode, amountCents: d.amountCents },
      });

      return {
        ok: true,
        entry: { homeId, costCode: d.costCode, amountCents: d.amountCents, note: d.note },
      };
    }
  );

  app.post(
    '/api/budgets/:homeId/approve',
    {
      preHandler: [requirePermission('budgets:approve'), requireRecentReauth(15)],
      schema: {
        tags: ['Budgets'],
        summary: 'Approve final budget and write live rows to job_cost_budgets (Rules 7, 8, 11)',
      },
    },
    async (request, reply) => {
      const { homeId } = request.params as { homeId: string };

      if (isUsingDemoStore()) {
        const home = demoStore.homes.find((h) => h.id === homeId);
        const est = demoStore.estimates.get(homeId);
        if (!home || !est) return reply.status(404).send({ error: 'HomeOrEstimateNotFound' });

        const pos = demoStore.purchaseOrders.filter((p) => p.homeId === home.id);
        const fixed = demoStore.fixedBudgetEntries.filter((f) => f.homeId === home.id);
        const calc = calculateFinalBudget(
          est.lines.map((l) => ({
            costCode: l.costCode,
            costCodeName: l.costCodeName,
            pricingSource: l.pricingSource,
            estimatedAmountCents: l.extendedCents,
            isAllowanceOrFixed: l.isAllowanceOrFixed,
          })),
          pos.map((p) => ({ costCode: p.costCode, totalCents: p.totalCents, status: p.status })),
          fixed.map((f) => ({ costCode: f.costCode, amountCents: f.amountCents }))
        );

        if (!calc.canApprove) {
          return reply.status(422).send({
            error: 'UnsignedPurchaseOrders',
            message: 'Cannot approve budget while priced lines lack a fully signed PO.',
            blockingCostCodes: calc.blockingCostCodes,
          });
        }

        // Replace existing live job cost rows for this home (Section 5.9 & Rule 11)
        demoStore.jobCostBudgets = demoStore.jobCostBudgets.filter((r) => r.homeId !== home.id);
        const loadedAt = new Date().toISOString();
        const newRows = calc.lines
          .filter((l) => l.finalBudgetCents > 0)
          .map((l) => ({
            homeId: home.id,
            homeCode: home.homeCode,
            costCode: l.costCode,
            costCodeName: l.costCodeName,
            budgetCents: l.finalBudgetCents,
            source: `Estimating system v${est.versionNumber}`,
            loadedAt,
            estimateVersion: est.versionNumber,
          }));

        demoStore.jobCostBudgets.push(...newRows);
        home.stage = 'live_budget';
        est.status = 'approved';

        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'BUDGET_APPROVED_LIVE',
          entityType: 'job_cost_budget',
          entityId: home.homeCode,
          homeId: home.id,
          ipAddress: request.ip,
          afterValues: {
            rowsWritten: newRows.length,
            totalFinalBudgetCents: calc.totalFinalBudgetCents,
          },
        });

        return { ok: true, rowsWritten: newRows.length, liveRows: newRows };
      }

      // Postgres mode
      if (!isValidUuid(homeId)) {
        return reply.status(404).send({ error: 'HomeOrEstimateNotFound' });
      }
      const db = getDb();
      const [[home], [est]] = await Promise.all([
        db.select().from(homes).where(eq(homes.id, homeId)).limit(1),
        db
          .select()
          .from(estimates)
          .where(eq(estimates.homeId, homeId))
          .orderBy(desc(estimates.versionNumber))
          .limit(1),
      ]);

      if (!home || !est) return reply.status(404).send({ error: 'HomeOrEstimateNotFound' });

      const [lines, codeRows, pos, fixed] = await Promise.all([
        db.select().from(estimateLines).where(eq(estimateLines.estimateId, est.id)),
        db.select().from(costCodes),
        db.select().from(purchaseOrders).where(eq(purchaseOrders.homeId, home.id)),
        db.select().from(homeBudgetFixedLines).where(eq(homeBudgetFixedLines.homeId, home.id)),
      ]);

      const codeMap = new Map(codeRows.map((c) => [c.code, c]));
      const calc = calculateFinalBudget(
        lines.map((l) => ({
          costCode: l.costCode,
          costCodeName: codeMap.get(l.costCode)?.name ?? l.costCode,
          pricingSource: l.pricingSource as 'sub' | 'supplier' | 'fixed' | 'allowance' | 'none',
          estimatedAmountCents: l.extendedCents,
          isAllowanceOrFixed: l.isAllowanceOrFixed,
        })),
        pos.map((p) => ({ costCode: p.costCode, totalCents: p.totalCents, status: p.status })),
        fixed.map((f) => ({ costCode: f.costCode, amountCents: f.amountCents }))
      );

      if (!calc.canApprove) {
        return reply.status(422).send({
          error: 'UnsignedPurchaseOrders',
          message: 'Cannot approve budget while priced lines lack a fully signed PO.',
          blockingCostCodes: calc.blockingCostCodes,
        });
      }

      const loadedAtDate = new Date();
      const newRows = calc.lines
        .filter((l) => l.finalBudgetCents > 0)
        .map((l) => ({
          homeId: home.id,
          homeCode: home.homeCode,
          costCode: l.costCode,
          costCodeName: l.costCodeName,
          budgetCents: l.finalBudgetCents,
          source: `Estimating system v${est.versionNumber}`,
          loadedAt: loadedAtDate,
          estimateVersion: est.versionNumber,
        }));

      await db.transaction(async (tx) => {
        // Section 5.9 & Rule 11: replace live job_cost_budgets rows for this home
        await tx.delete(jobCostBudgets).where(eq(jobCostBudgets.homeId, home.id));
        if (newRows.length > 0) {
          await tx.insert(jobCostBudgets).values(newRows);
        }
        await tx
          .update(homes)
          .set({ stage: 'live_budget', updatedAt: loadedAtDate })
          .where(eq(homes.id, home.id));
        await tx
          .update(estimates)
          .set({
            status: 'approved',
            approvedBy: isValidUuid(request.actor.userId) ? request.actor.userId : null,
            approvedAt: loadedAtDate,
          })
          .where(eq(estimates.id, est.id));
      });

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'BUDGET_APPROVED_LIVE',
        entityType: 'job_cost_budget',
        entityId: home.homeCode,
        homeId: home.id,
        ipAddress: request.ip,
        afterValues: {
          rowsWritten: newRows.length,
          totalFinalBudgetCents: calc.totalFinalBudgetCents,
        },
      });

      return {
        ok: true,
        rowsWritten: newRows.length,
        liveRows: newRows.map((r) => ({ ...r, loadedAt: loadedAtDate.toISOString() })),
      };
    }
  );
}
