import type { FastifyInstance } from 'fastify';
import { asc, desc, eq } from 'drizzle-orm';
import {
  COST_CODE_MAP,
  INTERNAL_ONLY_COST_CODES,
  canAccess,
  createClarificationSchema,
} from '@interstate/shared';
import { demoStore } from '../data/demo-store.js';
import { getDb } from '../db/client.js';
import {
  clarificationItems,
  clarificationMessages,
  costCodes,
  homes,
  purchaseOrders,
  quotes,
  users,
} from '../db/schema/index.js';
import { isUsingDemoStore, requirePermission } from '../security/auth-plugin.js';
import { isValidUuid, writeAuditLog } from '../security/audit.js';

export async function registerClarificationRoutes(app: FastifyInstance) {
  app.get(
    '/api/clarifications',
    {
      preHandler: [requirePermission('clarifications:view')],
      schema: { tags: ['Clarifications'] },
    },
    async (request) => {
      const canSeeInternal = canAccess(request.actor.role, 'financials:view_internal');

      if (isUsingDemoStore()) {
        let list = demoStore.clarifications.filter(
          (c) => canSeeInternal || !INTERNAL_ONLY_COST_CODES.has(c.costCode)
        );

        if (request.actor.role === 'subcontractor') {
          const subId = request.actor.subCompanyId;
          if (!subId) return { clarifications: [] };
          const assignedPairs = new Set<string>([
            ...demoStore.quotes
              .filter((q) => q.subCompanyId === subId)
              .map((q) => `${q.homeId}:${q.costCode}`),
            ...demoStore.purchaseOrders
              .filter((p) => p.subCompanyId === subId)
              .map((p) => `${p.homeId}:${p.costCode}`),
          ]);
          list = list.filter((c) => assignedPairs.has(`${c.homeId}:${c.costCode}`));
        }

        return { clarifications: list };
      }

      const db = getDb();
      let subAssignedPairs: Set<string> | null = null;
      if (request.actor.role === 'subcontractor') {
        if (!isValidUuid(request.actor.subCompanyId)) {
          return { clarifications: [] };
        }
        const [subQuotes, subPos] = await Promise.all([
          db
            .select({ homeId: quotes.homeId, costCode: quotes.costCode })
            .from(quotes)
            .where(eq(quotes.subCompanyId, request.actor.subCompanyId)),
          db
            .select({ homeId: purchaseOrders.homeId, costCode: purchaseOrders.costCode })
            .from(purchaseOrders)
            .where(eq(purchaseOrders.subCompanyId, request.actor.subCompanyId)),
        ]);
        subAssignedPairs = new Set<string>([
          ...subQuotes.map((q) => `${q.homeId}:${q.costCode}`),
          ...subPos.map((p) => `${p.homeId}:${p.costCode}`),
        ]);
        if (subAssignedPairs.size === 0) {
          return { clarifications: [] };
        }
      }

      const [items, messages, homeRows, codeRows, userRows] = await Promise.all([
        db.select().from(clarificationItems).orderBy(desc(clarificationItems.createdAt)),
        db.select().from(clarificationMessages).orderBy(asc(clarificationMessages.createdAt)),
        db.select({ id: homes.id, homeCode: homes.homeCode }).from(homes),
        db.select({ code: costCodes.code, name: costCodes.name }).from(costCodes),
        db.select({ id: users.id, fullName: users.fullName }).from(users),
      ]);

      const homeMap = new Map(homeRows.map((h) => [h.id, h.homeCode]));
      const codeMap = new Map(codeRows.map((c) => [c.code, c.name]));
      const userMap = new Map(userRows.map((u) => [u.id, u.fullName]));

      const msgsByItem = new Map<
        string,
        Array<{ author: string; body: string; createdAt: string }>
      >();
      for (const m of messages) {
        const list = msgsByItem.get(m.clarificationId) ?? [];
        list.push({
          author: m.authorUserId ? (userMap.get(m.authorUserId) ?? 'Interstate User') : 'System',
          body: m.body,
          createdAt: m.createdAt.toISOString(),
        });
        msgsByItem.set(m.clarificationId, list);
      }

      const filteredItems = items.filter((c) => {
        if (!canSeeInternal && INTERNAL_ONLY_COST_CODES.has(c.costCode)) return false;
        if (subAssignedPairs && !subAssignedPairs.has(`${c.homeId}:${c.costCode}`)) return false;
        return true;
      });

      return {
        clarifications: filteredItems.map((c) => ({
          id: c.id,
          homeId: c.homeId,
          homeCode: homeMap.get(c.homeId) ?? c.homeId,
          costCode: c.costCode,
          costCodeName: codeMap.get(c.costCode) ?? c.costCode,
          category: c.category,
          title: c.title,
          status: c.status,
          ownerName: c.ownerUserId ? (userMap.get(c.ownerUserId) ?? 'Unassigned') : 'Unassigned',
          dueDate: c.dueDate ?? '',
          messages: msgsByItem.get(c.id) ?? [],
        })),
      };
    }
  );

  app.post(
    '/api/clarifications',
    {
      preHandler: [requirePermission('clarifications:create')],
      schema: { tags: ['Clarifications'] },
    },
    async (request, reply) => {
      const parsed = createClarificationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
      }
      const d = parsed.data;

      if (
        !canAccess(request.actor.role, 'financials:view_internal') &&
        INTERNAL_ONLY_COST_CODES.has(d.costCode)
      ) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: `Cost code "${d.costCode}" is restricted to internal financial staff.`,
        });
      }

      const dueDate = d.dueDate ?? new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);

      if (isUsingDemoStore()) {
        const home = demoStore.homes.find((h) => h.id === d.homeId);
        const cc = COST_CODE_MAP.get(d.costCode);
        if (!home || !cc) return reply.status(404).send({ error: 'HomeOrCostCodeNotFound' });

        if (request.actor.role === 'subcontractor') {
          const subId = request.actor.subCompanyId;
          const assigned =
            Boolean(subId) &&
            (demoStore.quotes.some(
              (q) => q.homeId === home.id && q.costCode === d.costCode && q.subCompanyId === subId
            ) ||
              demoStore.purchaseOrders.some(
                (p) => p.homeId === home.id && p.costCode === d.costCode && p.subCompanyId === subId
              ));
          if (!assigned) {
            return reply.status(403).send({
              error: 'Forbidden',
              message: 'Subcontractors may only log clarifications for assigned homes and cost codes.',
            });
          }
        }

        const newItem = {
          id: `clr-${Date.now().toString(36)}`,
          homeId: home.id,
          homeCode: home.homeCode,
          costCode: d.costCode,
          costCodeName: cc.name,
          category: d.category,
          title: d.title,
          status: 'open' as const,
          ownerName: request.actor.fullName,
          dueDate,
          messages: [
            {
              author: request.actor.fullName,
              body: d.description,
              createdAt: new Date().toISOString(),
            },
          ],
        };

        demoStore.clarifications.unshift(newItem);
        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'CLARIFICATION_CREATED',
          entityType: 'clarification',
          entityId: newItem.id,
          homeId: home.id,
          ipAddress: request.ip,
          afterValues: { costCode: d.costCode, category: d.category, title: d.title },
        });

        return reply.status(201).send({ clarification: newItem });
      }

      if (!isValidUuid(d.homeId)) {
        return reply.status(404).send({ error: 'HomeOrCostCodeNotFound' });
      }
      const db = getDb();
      const [[home], [cc]] = await Promise.all([
        db.select().from(homes).where(eq(homes.id, d.homeId)).limit(1),
        db.select().from(costCodes).where(eq(costCodes.code, d.costCode)).limit(1),
      ]);
      if (!home || !cc) return reply.status(404).send({ error: 'HomeOrCostCodeNotFound' });

      if (request.actor.role === 'subcontractor') {
        if (!isValidUuid(request.actor.subCompanyId)) {
          return reply.status(403).send({ error: 'Forbidden' });
        }
        const [subQuotes, subPos] = await Promise.all([
          db
            .select({ homeId: quotes.homeId, costCode: quotes.costCode })
            .from(quotes)
            .where(eq(quotes.subCompanyId, request.actor.subCompanyId)),
          db
            .select({ homeId: purchaseOrders.homeId, costCode: purchaseOrders.costCode })
            .from(purchaseOrders)
            .where(eq(purchaseOrders.subCompanyId, request.actor.subCompanyId)),
        ]);
        const assigned =
          subQuotes.some((q) => q.homeId === home.id && q.costCode === cc.code) ||
          subPos.some((p) => p.homeId === home.id && p.costCode === cc.code);
        if (!assigned) {
          return reply.status(403).send({
            error: 'Forbidden',
            message: 'Subcontractors may only log clarifications for assigned homes and cost codes.',
          });
        }
      }

      const actorUuid = isValidUuid(request.actor.userId) ? request.actor.userId : null;

      const created = await db.transaction(async (tx) => {
        const [item] = await tx
          .insert(clarificationItems)
          .values({
            homeId: home.id,
            costCode: cc.code,
            category: d.category,
            title: d.title,
            status: 'open',
            ownerUserId: actorUuid,
            dueDate,
            createdBy: actorUuid,
          })
          .returning();

        const [msg] = await tx
          .insert(clarificationMessages)
          .values({
            clarificationId: item!.id,
            authorUserId: actorUuid,
            body: d.description,
          })
          .returning();

        return { item: item!, msg: msg! };
      });

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'CLARIFICATION_CREATED',
        entityType: 'clarification',
        entityId: created.item.id,
        homeId: home.id,
        ipAddress: request.ip,
        afterValues: { costCode: d.costCode, category: d.category, title: d.title },
      });

      return reply.status(201).send({
        clarification: {
          id: created.item.id,
          homeId: home.id,
          homeCode: home.homeCode,
          costCode: cc.code,
          costCodeName: cc.name,
          category: created.item.category,
          title: created.item.title,
          status: created.item.status,
          ownerName: request.actor.fullName,
          dueDate: created.item.dueDate ?? dueDate,
          messages: [
            {
              author: request.actor.fullName,
              body: created.msg.body,
              createdAt: created.msg.createdAt.toISOString(),
            },
          ],
        },
      });
    }
  );
}
