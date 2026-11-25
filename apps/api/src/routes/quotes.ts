import type { FastifyInstance } from 'fastify';
import { asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  COST_CODE_MAP,
  INTERNAL_ONLY_COST_CODES,
  canAccess,
  costCodeTextSchema,
  isoDateSchema,
  quoteCounterSchema,
  quoteDecisionSchema,
} from '@interstate/shared';
import { demoStore } from '../data/demo-store.js';
import { getDb } from '../db/client.js';
import {
  costCodes,
  estimates,
  homes,
  quoteRounds,
  quotes,
  subCompanies,
} from '../db/schema/index.js';
import { isUsingDemoStore, requirePermission } from '../security/auth-plugin.js';
import { isValidUuid, writeAuditLog } from '../security/audit.js';

const createQuoteSchema = z.object({
  homeId: z.string().min(1),
  subCompanyId: z.string().min(1),
  costCode: costCodeTextSchema,
  responseDeadline: isoDateSchema,
  quotedTotalCents: z.number().int().nonnegative(),
  proposedQuantity: z.number().nonnegative().optional(),
  comment: z.string().max(1000).default('Initial quote sent from estimate.'),
});

async function loadPostgresQuoteById(id: string) {
  if (!isValidUuid(id)) return null;
  const db = getDb();
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, id)).limit(1);
  if (!quote) return null;

  const [[home], [sub], [cc], rounds] = await Promise.all([
    db.select().from(homes).where(eq(homes.id, quote.homeId)).limit(1),
    db.select().from(subCompanies).where(eq(subCompanies.id, quote.subCompanyId)).limit(1),
    db.select().from(costCodes).where(eq(costCodes.code, quote.costCode)).limit(1),
    db
      .select()
      .from(quoteRounds)
      .where(eq(quoteRounds.quoteId, quote.id))
      .orderBy(asc(quoteRounds.roundNumber)),
  ]);

  return {
    id: quote.id,
    homeId: quote.homeId,
    homeCode: home?.homeCode ?? quote.homeId,
    subCompanyId: quote.subCompanyId,
    subName: sub?.legalName ?? quote.subCompanyId,
    costCode: quote.costCode,
    costCodeName: cc?.name ?? quote.costCode,
    status: quote.status,
    responseDeadline: quote.responseDeadline,
    quotedTotalCents: quote.quotedTotalCents,
    rounds: rounds.map((r) => ({
      roundNumber: r.roundNumber,
      actorType: r.actorType,
      proposedTotalCents: r.proposedTotalCents,
      proposedQuantity: r.proposedQuantity !== null ? Number(r.proposedQuantity) : undefined,
      comment: r.comment ?? '',
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function registerQuoteRoutes(app: FastifyInstance) {
  app.get('/api/quotes', { schema: { tags: ['Quotes'] } }, async (request, reply) => {
    if (request.actor.role === 'homeowner') {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const canSeeInternal = canAccess(request.actor.role, 'financials:view_internal');

    if (isUsingDemoStore()) {
      if (request.actor.role === 'subcontractor') {
        if (!request.actor.subCompanyId) return { quotes: [] };
        return {
          quotes: demoStore.quotes.filter(
            (q) =>
              q.subCompanyId === request.actor.subCompanyId &&
              !INTERNAL_ONLY_COST_CODES.has(q.costCode)
          ),
        };
      }
      const list = demoStore.quotes.filter(
        (q) => canSeeInternal || !INTERNAL_ONLY_COST_CODES.has(q.costCode)
      );
      return { quotes: list };
    }

    const db = getDb();
    const isSubRole = request.actor.role === 'subcontractor';
    const subFilterId =
      isSubRole && isValidUuid(request.actor.subCompanyId) ? request.actor.subCompanyId : null;

    if (isSubRole && !subFilterId) {
      return { quotes: [] };
    }

    const [quoteRows, roundRows, homeRows, subRows, codeRows] = await Promise.all([
      subFilterId
        ? db
            .select()
            .from(quotes)
            .where(eq(quotes.subCompanyId, subFilterId))
            .orderBy(desc(quotes.sentAt))
        : db.select().from(quotes).orderBy(desc(quotes.sentAt)),
      db.select().from(quoteRounds).orderBy(asc(quoteRounds.roundNumber)),
      db.select({ id: homes.id, homeCode: homes.homeCode }).from(homes),
      db.select({ id: subCompanies.id, legalName: subCompanies.legalName }).from(subCompanies),
      db.select({ code: costCodes.code, name: costCodes.name }).from(costCodes),
    ]);

    const homeMap = new Map(homeRows.map((h) => [h.id, h.homeCode]));
    const subMap = new Map(subRows.map((s) => [s.id, s.legalName]));
    const codeMap = new Map(codeRows.map((c) => [c.code, c.name]));
    const roundsByQuote = new Map<
      string,
      Array<{
        roundNumber: number;
        actorType: string;
        proposedTotalCents: number;
        proposedQuantity?: number;
        comment: string;
        createdAt: string;
      }>
    >();

    for (const r of roundRows) {
      const list = roundsByQuote.get(r.quoteId) ?? [];
      list.push({
        roundNumber: r.roundNumber,
        actorType: r.actorType,
        proposedTotalCents: r.proposedTotalCents,
        proposedQuantity: r.proposedQuantity !== null ? Number(r.proposedQuantity) : undefined,
        comment: r.comment ?? '',
        createdAt: r.createdAt.toISOString(),
      });
      roundsByQuote.set(r.quoteId, list);
    }

    const visibleQuotes = quoteRows.filter(
      (q) => canSeeInternal || !INTERNAL_ONLY_COST_CODES.has(q.costCode)
    );

    return {
      quotes: visibleQuotes.map((q) => ({
        id: q.id,
        homeId: q.homeId,
        homeCode: homeMap.get(q.homeId) ?? q.homeId,
        subCompanyId: q.subCompanyId,
        subName: subMap.get(q.subCompanyId) ?? q.subCompanyId,
        costCode: q.costCode,
        costCodeName: codeMap.get(q.costCode) ?? q.costCode,
        status: q.status,
        responseDeadline: q.responseDeadline,
        quotedTotalCents: q.quotedTotalCents,
        rounds: roundsByQuote.get(q.id) ?? [],
      })),
    };
  });

  app.post(
    '/api/quotes',
    {
      preHandler: [requirePermission('quotes:issue')],
      schema: { tags: ['Quotes'], summary: 'Issue a new quote with immutable snapshot' },
    },
    async (request, reply) => {
      const parsed = createQuoteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
      }
      const d = parsed.data;

      if (d.costCode === '00' || INTERNAL_ONLY_COST_CODES.has(d.costCode)) {
        return reply.status(400).send({
          error: 'InvalidCostCode',
          message: `Cost code "${d.costCode}" cannot be sent to subcontractors as a quote.`,
        });
      }

      if (isUsingDemoStore()) {
        const home = demoStore.homes.find((h) => h.id === d.homeId);
        const sub = demoStore.subcontractors.find((s) => s.id === d.subCompanyId);
        const cc = COST_CODE_MAP.get(d.costCode);
        if (!home || !sub || !cc) {
          return reply.status(404).send({ error: 'ReferencedEntityNotFound' });
        }

        const newQuote = {
          id: `q-${Date.now().toString(36)}`,
          homeId: home.id,
          homeCode: home.homeCode,
          subCompanyId: sub.id,
          subName: sub.legalName,
          costCode: d.costCode,
          costCodeName: cc.name,
          status: 'sent' as const,
          responseDeadline: d.responseDeadline,
          quotedTotalCents: d.quotedTotalCents,
          rounds: [
            {
              roundNumber: 1,
              actorType: 'estimator' as const,
              proposedTotalCents: d.quotedTotalCents,
              proposedQuantity: d.proposedQuantity,
              comment: d.comment,
              createdAt: new Date().toISOString(),
            },
          ],
        };
        demoStore.quotes.unshift(newQuote);

        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'QUOTE_ISSUED',
          entityType: 'quote',
          entityId: newQuote.id,
          homeId: home.id,
          ipAddress: request.ip,
          afterValues: { costCode: d.costCode, quotedTotalCents: d.quotedTotalCents },
        });

        return reply.status(201).send({ quote: newQuote });
      }

      if (!isValidUuid(d.homeId) || !isValidUuid(d.subCompanyId)) {
        return reply.status(404).send({ error: 'ReferencedEntityNotFound' });
      }
      const db = getDb();
      const [[home], [sub], [cc], [est]] = await Promise.all([
        db.select().from(homes).where(eq(homes.id, d.homeId)).limit(1),
        db.select().from(subCompanies).where(eq(subCompanies.id, d.subCompanyId)).limit(1),
        db.select().from(costCodes).where(eq(costCodes.code, d.costCode)).limit(1),
        db
          .select()
          .from(estimates)
          .where(eq(estimates.homeId, d.homeId))
          .orderBy(desc(estimates.versionNumber))
          .limit(1),
      ]);

      if (!home || !sub || !cc || !est) {
        return reply.status(404).send({ error: 'ReferencedEntityNotFound' });
      }

      const createdId = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(quotes)
          .values({
            homeId: home.id,
            estimateId: est.id,
            subCompanyId: sub.id,
            costCode: cc.code,
            status: 'sent',
            responseDeadline: d.responseDeadline,
            quotedTotalCents: d.quotedTotalCents,
            snapshotJson: {
              homeCode: home.homeCode,
              costCode: cc.code,
              costCodeName: cc.name,
              quotedTotalCents: d.quotedTotalCents,
              proposedQuantity: d.proposedQuantity ?? null,
              sentAt: new Date().toISOString(),
            },
          })
          .returning({ id: quotes.id });

        await tx.insert(quoteRounds).values({
          quoteId: inserted!.id,
          roundNumber: 1,
          actorType: 'estimator',
          actorUserId: isValidUuid(request.actor.userId) ? request.actor.userId : null,
          proposedTotalCents: d.quotedTotalCents,
          proposedQuantity: d.proposedQuantity !== undefined ? String(d.proposedQuantity) : null,
          comment: d.comment,
        });

        return inserted!.id;
      });

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'QUOTE_ISSUED',
        entityType: 'quote',
        entityId: createdId,
        homeId: home.id,
        ipAddress: request.ip,
        afterValues: { costCode: d.costCode, quotedTotalCents: d.quotedTotalCents },
      });

      const fullQuote = await loadPostgresQuoteById(createdId);
      return reply.status(201).send({ quote: fullQuote });
    }
  );

  app.post(
    '/api/quotes/:id/counter',
    {
      preHandler: [requirePermission('quotes:respond_own')],
      schema: { tags: ['Quotes'], summary: 'Subcontractor adjusts quote price or quantity (Rule 3)' },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = quoteCounterSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
      }

      if (!request.actor.subCompanyId) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Subcontractor company link required.' });
      }

      if (isUsingDemoStore()) {
        const quote = demoStore.quotes.find((q) => q.id === id);
        if (!quote) return reply.status(404).send({ error: 'QuoteNotFound' });

        if (quote.subCompanyId !== request.actor.subCompanyId) {
          return reply.status(403).send({ error: 'Forbidden' });
        }
        if (quote.status !== 'sent') {
          return reply.status(409).send({
            error: 'InvalidQuoteState',
            message: `Cannot counter a quote with status "${quote.status}". Only sent quotes can be adjusted.`,
          });
        }

        const prevTotal = quote.quotedTotalCents;
        quote.status = 'sub_adjusted';
        quote.rounds.push({
          roundNumber: quote.rounds.length + 1,
          actorType: 'subcontractor',
          proposedTotalCents: parsed.data.proposedTotalCents,
          proposedQuantity: parsed.data.proposedQuantity,
          comment: parsed.data.comment,
          createdAt: new Date().toISOString(),
        });

        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'QUOTE_COUNTER_SUBMITTED',
          entityType: 'quote',
          entityId: quote.id,
          homeId: quote.homeId,
          ipAddress: request.ip,
          beforeValues: { quotedTotalCents: prevTotal },
          afterValues: {
            proposedTotalCents: parsed.data.proposedTotalCents,
            proposedQuantity: parsed.data.proposedQuantity,
          },
        });

        return { quote };
      }

      if (!isValidUuid(id)) return reply.status(404).send({ error: 'QuoteNotFound' });
      const db = getDb();
      const [quote] = await db.select().from(quotes).where(eq(quotes.id, id)).limit(1);
      if (!quote) return reply.status(404).send({ error: 'QuoteNotFound' });

      if (quote.subCompanyId !== request.actor.subCompanyId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      if (quote.status !== 'sent') {
        return reply.status(409).send({
          error: 'InvalidQuoteState',
          message: `Cannot counter a quote with status "${quote.status}". Only sent quotes can be adjusted.`,
        });
      }

      const existingRounds = await db
        .select({ roundNumber: quoteRounds.roundNumber })
        .from(quoteRounds)
        .where(eq(quoteRounds.quoteId, quote.id));

      const nextRoundNumber =
        existingRounds.reduce((max, r) => Math.max(max, r.roundNumber), 0) + 1;

      await db.transaction(async (tx) => {
        await tx
          .update(quotes)
          .set({ status: 'sub_adjusted' })
          .where(eq(quotes.id, quote.id));

        await tx.insert(quoteRounds).values({
          quoteId: quote.id,
          roundNumber: nextRoundNumber,
          actorType: 'subcontractor',
          actorUserId: isValidUuid(request.actor.userId) ? request.actor.userId : null,
          proposedTotalCents: parsed.data.proposedTotalCents,
          proposedQuantity:
            parsed.data.proposedQuantity !== undefined
              ? String(parsed.data.proposedQuantity)
              : null,
          comment: parsed.data.comment,
        });
      });

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'QUOTE_COUNTER_SUBMITTED',
        entityType: 'quote',
        entityId: quote.id,
        homeId: quote.homeId,
        ipAddress: request.ip,
        beforeValues: { quotedTotalCents: quote.quotedTotalCents },
        afterValues: {
          proposedTotalCents: parsed.data.proposedTotalCents,
          proposedQuantity: parsed.data.proposedQuantity,
        },
      });

      const updatedQuote = await loadPostgresQuoteById(quote.id);
      return { quote: updatedQuote };
    }
  );

  app.post(
    '/api/quotes/:id/accept',
    {
      preHandler: [requirePermission('quotes:respond_own')],
      schema: { tags: ['Quotes'], summary: 'Subcontractor accepts a sent quote as-is' },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!request.actor.subCompanyId) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Subcontractor company link required.' });
      }

      if (isUsingDemoStore()) {
        const quote = demoStore.quotes.find((q) => q.id === id);
        if (!quote) return reply.status(404).send({ error: 'QuoteNotFound' });
        if (quote.subCompanyId !== request.actor.subCompanyId) {
          return reply.status(403).send({ error: 'Forbidden' });
        }
        if (quote.status !== 'sent') {
          return reply.status(409).send({
            error: 'InvalidQuoteState',
            message: `Cannot accept a quote with status "${quote.status}".`,
          });
        }

        const prevStatus = quote.status;
        quote.status = 'accepted';
        quote.rounds.push({
          roundNumber: quote.rounds.length + 1,
          actorType: 'subcontractor',
          proposedTotalCents: quote.quotedTotalCents,
          comment: 'Accepted quote as issued.',
          createdAt: new Date().toISOString(),
        });

        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'QUOTE_ACCEPTED_BY_SUB',
          entityType: 'quote',
          entityId: quote.id,
          homeId: quote.homeId,
          ipAddress: request.ip,
          beforeValues: { status: prevStatus },
          afterValues: { status: quote.status, quotedTotalCents: quote.quotedTotalCents },
        });

        return { quote };
      }

      if (!isValidUuid(id)) return reply.status(404).send({ error: 'QuoteNotFound' });
      const db = getDb();
      const [quote] = await db.select().from(quotes).where(eq(quotes.id, id)).limit(1);
      if (!quote) return reply.status(404).send({ error: 'QuoteNotFound' });
      if (quote.subCompanyId !== request.actor.subCompanyId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      if (quote.status !== 'sent') {
        return reply.status(409).send({
          error: 'InvalidQuoteState',
          message: `Cannot accept a quote with status "${quote.status}".`,
        });
      }

      const existingRounds = await db
        .select({ roundNumber: quoteRounds.roundNumber })
        .from(quoteRounds)
        .where(eq(quoteRounds.quoteId, quote.id));
      const nextRoundNumber =
        existingRounds.reduce((max, r) => Math.max(max, r.roundNumber), 0) + 1;

      await db.transaction(async (tx) => {
        await tx
          .update(quotes)
          .set({ status: 'accepted', decidedAt: new Date() })
          .where(eq(quotes.id, quote.id));

        await tx.insert(quoteRounds).values({
          quoteId: quote.id,
          roundNumber: nextRoundNumber,
          actorType: 'subcontractor',
          actorUserId: isValidUuid(request.actor.userId) ? request.actor.userId : null,
          proposedTotalCents: quote.quotedTotalCents,
          comment: 'Accepted quote as issued.',
        });
      });

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'QUOTE_ACCEPTED_BY_SUB',
        entityType: 'quote',
        entityId: quote.id,
        homeId: quote.homeId,
        ipAddress: request.ip,
        beforeValues: { status: quote.status },
        afterValues: { status: 'accepted', quotedTotalCents: quote.quotedTotalCents },
      });

      const updatedQuote = await loadPostgresQuoteById(quote.id);
      return { quote: updatedQuote };
    }
  );

  app.post(
    '/api/quotes/:id/decision',
    {
      preHandler: [requirePermission('quotes:decide')],
      schema: { tags: ['Quotes'], summary: 'Estimator accepts, rejects, or renegotiates a quote' },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = quoteDecisionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
      }

      if (isUsingDemoStore()) {
        const quote = demoStore.quotes.find((q) => q.id === id);
        if (!quote) return reply.status(404).send({ error: 'QuoteNotFound' });

        if (quote.status !== 'sent' && quote.status !== 'sub_adjusted') {
          return reply.status(409).send({
            error: 'InvalidQuoteState',
            message: `Quote is already finalized ("${quote.status}") and cannot be modified.`,
          });
        }

        const prevStatus = quote.status;
        if (parsed.data.decision === 'accept') {
          const latest = quote.rounds[quote.rounds.length - 1];
          quote.quotedTotalCents = latest?.proposedTotalCents ?? quote.quotedTotalCents;
          quote.status = 'accepted';
        } else if (parsed.data.decision === 'reject') {
          quote.status = 'rejected';
        } else {
          quote.status = 'sent';
          quote.rounds.push({
            roundNumber: quote.rounds.length + 1,
            actorType: 'estimator',
            proposedTotalCents: quote.quotedTotalCents,
            comment: parsed.data.note ?? 'Returned to subcontractor for renegotiation.',
            createdAt: new Date().toISOString(),
          });
        }

        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'QUOTE_DECISION',
          entityType: 'quote',
          entityId: quote.id,
          homeId: quote.homeId,
          ipAddress: request.ip,
          beforeValues: { status: prevStatus },
          afterValues: { status: quote.status, decision: parsed.data.decision },
        });

        return { quote };
      }

      if (!isValidUuid(id)) return reply.status(404).send({ error: 'QuoteNotFound' });
      const db = getDb();
      const [quote] = await db.select().from(quotes).where(eq(quotes.id, id)).limit(1);
      if (!quote) return reply.status(404).send({ error: 'QuoteNotFound' });

      if (quote.status !== 'sent' && quote.status !== 'sub_adjusted') {
        return reply.status(409).send({
          error: 'InvalidQuoteState',
          message: `Quote is already finalized ("${quote.status}") and cannot be modified.`,
        });
      }

      const rounds = await db
        .select()
        .from(quoteRounds)
        .where(eq(quoteRounds.quoteId, quote.id))
        .orderBy(asc(quoteRounds.roundNumber));

      const prevStatus = quote.status;
      const latest = rounds[rounds.length - 1];
      let nextStatus = quote.status;

      await db.transaction(async (tx) => {
        if (parsed.data.decision === 'accept') {
          nextStatus = 'accepted';
          await tx
            .update(quotes)
            .set({
              quotedTotalCents: latest?.proposedTotalCents ?? quote.quotedTotalCents,
              status: 'accepted',
              decidedAt: new Date(),
            })
            .where(eq(quotes.id, quote.id));
        } else if (parsed.data.decision === 'reject') {
          nextStatus = 'rejected';
          await tx
            .update(quotes)
            .set({ status: 'rejected', decidedAt: new Date() })
            .where(eq(quotes.id, quote.id));
        } else {
          nextStatus = 'sent';
          await tx
            .update(quotes)
            .set({ status: 'sent' })
            .where(eq(quotes.id, quote.id));

          await tx.insert(quoteRounds).values({
            quoteId: quote.id,
            roundNumber: (latest?.roundNumber ?? 0) + 1,
            actorType: 'estimator',
            actorUserId: isValidUuid(request.actor.userId) ? request.actor.userId : null,
            proposedTotalCents: quote.quotedTotalCents,
            comment: parsed.data.note ?? 'Returned to subcontractor for renegotiation.',
          });
        }
      });

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'QUOTE_DECISION',
        entityType: 'quote',
        entityId: quote.id,
        homeId: quote.homeId,
        ipAddress: request.ip,
        beforeValues: { status: prevStatus },
        afterValues: { status: nextStatus, decision: parsed.data.decision },
      });

      const updatedQuote = await loadPostgresQuoteById(quote.id);
      return { quote: updatedQuote };
    }
  );
}
