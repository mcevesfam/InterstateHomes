import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import {
  INTERNAL_ONLY_COST_CODES,
  canAccess,
  projectHomeownerEstimate,
  updateEstimateLineSchema,
} from '@interstate/shared';
import { demoStore } from '../data/demo-store.js';
import { getDb } from '../db/client.js';
import {
  costClassifications,
  costCodes,
  estimateLines,
  estimates,
  homePlanRevisions,
  homes,
  quotes,
  subCompanies,
  subCostCodes,
  subdivisions,
} from '../db/schema/index.js';
import { isUsingDemoStore, requirePermission } from '../security/auth-plugin.js';
import { isValidUuid, writeAuditLog } from '../security/audit.js';

async function loadPostgresHomeEstimate(homeId: string) {
  if (!isValidUuid(homeId)) return null;
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

  if (!home || !est) return null;

  const [
    [subdivision],
    [latestRev],
    lineRows,
    codeRows,
    clsRows,
    subRows,
    quoteRows,
    subCodeRows,
  ] = await Promise.all([
    db
      .select()
      .from(subdivisions)
      .where(eq(subdivisions.code, home.subdivisionCode))
      .limit(1),
    db
      .select()
      .from(homePlanRevisions)
      .where(eq(homePlanRevisions.homeId, home.id))
      .orderBy(desc(homePlanRevisions.uploadedAt))
      .limit(1),
    db.select().from(estimateLines).where(eq(estimateLines.estimateId, est.id)),
    db.select().from(costCodes),
    db.select().from(costClassifications),
    db.select().from(subCompanies),
    db.select().from(quotes).where(eq(quotes.homeId, home.id)),
    db.select().from(subCostCodes),
  ]);

  const codeMap = new Map(codeRows.map((c) => [c.code, c]));
  const clsMap = new Map(clsRows.map((c) => [c.code, c.name]));
  const subNameMap = new Map(subRows.map((s) => [s.id, s.legalName]));
  const preferredSet = new Set(
    subCodeRows.filter((sc) => sc.isPreferred).map((sc) => `${sc.subCompanyId}:${sc.costCode}`)
  );

  const quotesByCode = new Map<
    string,
    Array<{ subId: string; subName: string; totalCents: number; isPreferred: boolean }>
  >();
  for (const q of quoteRows) {
    const arr = quotesByCode.get(q.costCode) ?? [];
    arr.push({
      subId: q.subCompanyId,
      subName: subNameMap.get(q.subCompanyId) ?? q.subCompanyId,
      totalCents: q.quotedTotalCents,
      isPreferred: preferredSet.has(`${q.subCompanyId}:${q.costCode}`),
    });
    quotesByCode.set(q.costCode, arr);
  }

  const mappedLines = lineRows
    .map((l) => {
      const cc = codeMap.get(l.costCode);
      const clsCode = cc?.classificationCode ?? '';
      return {
        sortOrder: cc?.sortOrder ?? 999,
        costCode: l.costCode,
        costCodeName: cc?.name ?? l.costCode,
        classificationCode: clsCode,
        classificationName: clsMap.get(clsCode) ?? clsCode,
        quantity: Number(l.quantity),
        unit: l.unit,
        quantitySource: l.quantitySource as 'plan_library' | 'manual' | 'ai_takeoff',
        pricingSource: l.pricingSource as 'sub' | 'supplier' | 'fixed' | 'allowance' | 'none',
        selectedSubId: l.selectedSubId ?? null,
        selectedSubName: l.selectedSubId ? (subNameMap.get(l.selectedSubId) ?? null) : null,
        unitPriceCents: l.unitPriceCents,
        extendedCents: l.extendedCents,
        isAllowanceOrFixed: l.isAllowanceOrFixed,
        showOnHomeownerPdf: l.showOnHomeownerPdf,
        notes: l.notes ?? '',
        competingSubQuotes: quotesByCode.get(l.costCode) ?? [],
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ sortOrder: _sortOrder, ...rest }) => rest);

  return {
    home: {
      id: home.id,
      homeCode: home.homeCode,
      subdivisionCode: home.subdivisionCode,
      subdivisionName: subdivision?.name ?? home.subdivisionCode,
      lot: home.lot,
      address: home.address,
      planName: home.planName,
      elevation: home.elevation,
      garageHanding: home.garageHanding,
      finishedSqFt: home.finishedSqFt,
      garageSqFt: home.garageSqFt,
      bedrooms: home.bedrooms,
      baths: Number(home.baths),
      stories: home.stories,
      roofPitch: home.roofPitch,
      exteriorFinishMix: home.exteriorFinishMix,
      stage: home.stage,
      soldAmountCents: home.soldAmountCents,
      planRevision: latestRev?.revisionLabel ?? 'Rev 1',
      createdAt: home.createdAt.toISOString(),
    },
    estimate: {
      id: est.id,
      homeId: est.homeId,
      versionNumber: est.versionNumber,
      status: est.status,
      lines: mappedLines,
    },
  };
}

export async function registerEstimateRoutes(app: FastifyInstance) {
  app.get(
    '/api/homes/:homeId/estimate',
    {
      preHandler: [requirePermission('budgets:view')],
      schema: { tags: ['Estimates'] },
    },
    async (request, reply) => {
      const { homeId } = request.params as { homeId: string };
      const canSeeInternal = canAccess(request.actor.role, 'financials:view_internal');

      if (isUsingDemoStore()) {
        const home = demoStore.homes.find((h) => h.id === homeId);
        const est = demoStore.estimates.get(homeId);
        if (!home || !est) return reply.status(404).send({ error: 'EstimateNotFound' });

        const lines = est.lines.filter(
          (l) => canSeeInternal || !INTERNAL_ONLY_COST_CODES.has(l.costCode)
        );
        const totalEstimatedCents = lines.reduce((sum, l) => sum + l.extendedCents, 0);

        return {
          home: {
            ...home,
            soldAmountCents: canSeeInternal ? home.soldAmountCents : null,
          },
          estimate: {
            id: est.id,
            homeId: est.homeId,
            versionNumber: est.versionNumber,
            status: est.status,
            totalEstimatedCents,
            lines,
          },
        };
      }

      const loaded = await loadPostgresHomeEstimate(homeId);
      if (!loaded) return reply.status(404).send({ error: 'EstimateNotFound' });

      const lines = loaded.estimate.lines.filter(
        (l) => canSeeInternal || !INTERNAL_ONLY_COST_CODES.has(l.costCode)
      );
      const totalEstimatedCents = lines.reduce((sum, l) => sum + l.extendedCents, 0);

      return {
        home: {
          ...loaded.home,
          soldAmountCents: canSeeInternal ? loaded.home.soldAmountCents : null,
        },
        estimate: {
          id: loaded.estimate.id,
          homeId: loaded.estimate.homeId,
          versionNumber: loaded.estimate.versionNumber,
          status: loaded.estimate.status,
          totalEstimatedCents,
          lines,
        },
      };
    }
  );

  app.get(
    '/api/homes/:homeId/estimate/homeowner',
    {
      preHandler: [requirePermission('estimates:export_homeowner')],
      schema: {
        tags: ['Estimates'],
        summary: 'Homeowner-safe estimate projection (Rule 10: strips internal codes, vendors, unit costs, margin)',
      },
    },
    async (request, reply) => {
      const { homeId } = request.params as { homeId: string };

      if (isUsingDemoStore()) {
        const home = demoStore.homes.find((h) => h.id === homeId);
        const est = demoStore.estimates.get(homeId);
        if (!home || !est) return reply.status(404).send({ error: 'EstimateNotFound' });

        const projection = projectHomeownerEstimate({
          homeCode: home.homeCode,
          planName: home.planName,
          subdivisionName: home.subdivisionName,
          lines: est.lines,
        });

        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'HOMEOWNER_ESTIMATE_EXPORTED',
          entityType: 'estimate',
          entityId: est.id,
          homeId,
          ipAddress: request.ip,
        });

        return { projection };
      }

      const loaded = await loadPostgresHomeEstimate(homeId);
      if (!loaded) return reply.status(404).send({ error: 'EstimateNotFound' });

      const projection = projectHomeownerEstimate({
        homeCode: loaded.home.homeCode,
        planName: loaded.home.planName,
        subdivisionName: loaded.home.subdivisionName,
        lines: loaded.estimate.lines,
      });

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'HOMEOWNER_ESTIMATE_EXPORTED',
        entityType: 'estimate',
        entityId: loaded.estimate.id,
        homeId: loaded.home.id,
        ipAddress: request.ip,
      });

      return { projection };
    }
  );

  app.patch(
    '/api/estimates/:homeId/lines/:costCode',
    {
      preHandler: [requirePermission('estimates:build')],
      schema: { tags: ['Estimates'] },
    },
    async (request, reply) => {
      const { homeId, costCode } = request.params as { homeId: string; costCode: string };
      const parsed = updateEstimateLineSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
      }

      if (costCode === '00') {
        return reply.status(400).send({
          error: 'InvalidCostCode',
          message: 'Cost code "00" (Uncategorized) is not estimateable.',
        });
      }

      if (isUsingDemoStore()) {
        const home = demoStore.homes.find((h) => h.id === homeId);
        const est = demoStore.estimates.get(homeId);
        if (!home || !est) return reply.status(404).send({ error: 'EstimateNotFound' });

        if (home.stage === 'live_budget') {
          return reply.status(409).send({
            error: 'BudgetLocked',
            message: 'This home already has an approved live budget. Create a new estimate version to modify lines.',
          });
        }

        const line = est.lines.find((l) => l.costCode === costCode);
        if (!line) return reply.status(404).send({ error: 'CostCodeLineNotFound' });

        const before = { ...line };
        const d = parsed.data;
        if (d.quantity !== undefined) line.quantity = d.quantity;
        if (d.unit !== undefined) line.unit = d.unit;
        if (d.pricingSource !== undefined) line.pricingSource = d.pricingSource;
        if (d.selectedSubId !== undefined) {
          line.selectedSubId = d.selectedSubId;
          const sub = demoStore.subcontractors.find((s) => s.id === d.selectedSubId);
          line.selectedSubName = sub?.legalName ?? null;
        }
        if (d.unitPriceCents !== undefined) line.unitPriceCents = d.unitPriceCents;
        if (d.fixedAmountCents !== undefined) {
          line.quantity = 1;
          line.unitPriceCents = d.fixedAmountCents;
        }
        if (d.isAllowanceOrFixed !== undefined) line.isAllowanceOrFixed = d.isAllowanceOrFixed;
        if (d.showOnHomeownerPdf !== undefined) line.showOnHomeownerPdf = d.showOnHomeownerPdf;
        if (d.notes !== undefined) line.notes = d.notes;

        line.extendedCents = Math.round(line.quantity * line.unitPriceCents);

        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'ESTIMATE_LINE_UPDATED',
          entityType: 'estimate_line',
          entityId: `${homeId}:${costCode}`,
          homeId,
          ipAddress: request.ip,
          beforeValues: { extendedCents: before.extendedCents, selectedSubId: before.selectedSubId },
          afterValues: { extendedCents: line.extendedCents, selectedSubId: line.selectedSubId },
        });

        return { line };
      }

      // Postgres mode
      if (!isValidUuid(homeId)) {
        return reply.status(404).send({ error: 'EstimateNotFound' });
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
      if (!home || !est) return reply.status(404).send({ error: 'EstimateNotFound' });

      if (home.stage === 'live_budget' || est.status === 'approved') {
        return reply.status(409).send({
          error: 'BudgetLocked',
          message: 'This estimate is approved/live-budgeted and locked against direct edits.',
        });
      }

      const [existingLine] = await db
        .select()
        .from(estimateLines)
        .where(and(eq(estimateLines.estimateId, est.id), eq(estimateLines.costCode, costCode)))
        .limit(1);
      if (!existingLine) return reply.status(404).send({ error: 'CostCodeLineNotFound' });

      const d = parsed.data;
      let nextQty = d.quantity !== undefined ? d.quantity : Number(existingLine.quantity);
      let nextUnitPrice =
        d.unitPriceCents !== undefined ? d.unitPriceCents : existingLine.unitPriceCents;

      if (d.fixedAmountCents !== undefined) {
        nextQty = 1;
        nextUnitPrice = d.fixedAmountCents;
      }

      let nextSubId = existingLine.selectedSubId;
      let selectedSubName: string | null = null;
      if (d.selectedSubId !== undefined) {
        if (d.selectedSubId === null) {
          nextSubId = null;
        } else {
          if (!isValidUuid(d.selectedSubId)) {
            return reply.status(400).send({ error: 'InvalidSubcontractorId' });
          }
          const [sub] = await db
            .select({ id: subCompanies.id, legalName: subCompanies.legalName })
            .from(subCompanies)
            .where(eq(subCompanies.id, d.selectedSubId))
            .limit(1);
          if (!sub) return reply.status(404).send({ error: 'SubcontractorNotFound' });
          nextSubId = sub.id;
          selectedSubName = sub.legalName;
        }
      } else if (nextSubId) {
        const [sub] = await db
          .select({ legalName: subCompanies.legalName })
          .from(subCompanies)
          .where(eq(subCompanies.id, nextSubId))
          .limit(1);
        selectedSubName = sub?.legalName ?? null;
      }

      const nextExtended = Math.round(nextQty * nextUnitPrice);
      const nextPricingSource = d.pricingSource ?? existingLine.pricingSource;
      const nextIsAllowanceOrFixed =
        d.isAllowanceOrFixed !== undefined
          ? d.isAllowanceOrFixed
          : existingLine.isAllowanceOrFixed;
      const nextShowOnPdf =
        d.showOnHomeownerPdf !== undefined
          ? d.showOnHomeownerPdf
          : existingLine.showOnHomeownerPdf;

      const [updated] = await db
        .update(estimateLines)
        .set({
          quantity: String(nextQty),
          unit: d.unit ?? existingLine.unit,
          pricingSource: nextPricingSource,
          selectedSubId: nextSubId,
          unitPriceCents: nextUnitPrice,
          extendedCents: nextExtended,
          isAllowanceOrFixed: nextIsAllowanceOrFixed,
          showOnHomeownerPdf: nextShowOnPdf,
          notes: d.notes !== undefined ? d.notes : existingLine.notes,
        })
        .where(eq(estimateLines.id, existingLine.id))
        .returning();

      const [[cc], lineQuotes, allSubs, subCodeRows] = await Promise.all([
        db.select().from(costCodes).where(eq(costCodes.code, costCode)).limit(1),
        db
          .select()
          .from(quotes)
          .where(and(eq(quotes.homeId, homeId), eq(quotes.costCode, costCode))),
        db.select({ id: subCompanies.id, legalName: subCompanies.legalName }).from(subCompanies),
        db.select().from(subCostCodes).where(eq(subCostCodes.costCode, costCode)),
      ]);

      const [cls] = cc
        ? await db
            .select()
            .from(costClassifications)
            .where(eq(costClassifications.code, cc.classificationCode))
            .limit(1)
        : [undefined];

      const subMap = new Map(allSubs.map((s) => [s.id, s.legalName]));
      const preferredSubs = new Set(
        subCodeRows.filter((sc) => sc.isPreferred).map((sc) => sc.subCompanyId)
      );

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'ESTIMATE_LINE_UPDATED',
        entityType: 'estimate_line',
        entityId: `${homeId}:${costCode}`,
        homeId,
        ipAddress: request.ip,
        beforeValues: {
          extendedCents: existingLine.extendedCents,
          selectedSubId: existingLine.selectedSubId,
        },
        afterValues: {
          extendedCents: updated!.extendedCents,
          selectedSubId: updated!.selectedSubId,
        },
      });

      return {
        line: {
          costCode: updated!.costCode,
          costCodeName: cc?.name ?? updated!.costCode,
          classificationCode: cc?.classificationCode ?? '',
          classificationName: cls?.name ?? cc?.classificationCode ?? '',
          quantity: Number(updated!.quantity),
          unit: updated!.unit,
          quantitySource: updated!.quantitySource,
          pricingSource: updated!.pricingSource,
          selectedSubId: updated!.selectedSubId ?? null,
          selectedSubName,
          unitPriceCents: updated!.unitPriceCents,
          extendedCents: updated!.extendedCents,
          isAllowanceOrFixed: updated!.isAllowanceOrFixed,
          showOnHomeownerPdf: updated!.showOnHomeownerPdf,
          notes: updated!.notes ?? '',
          competingSubQuotes: lineQuotes.map((q) => ({
            subId: q.subCompanyId,
            subName: subMap.get(q.subCompanyId) ?? q.subCompanyId,
            totalCents: q.quotedTotalCents,
            isPreferred: preferredSubs.has(q.subCompanyId),
          })),
        },
      };
    }
  );
}
