import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import {
  COST_CODE_MAP,
  DEFAULT_SYSTEM_SETTINGS,
  INTERNAL_ONLY_COST_CODES,
  canAccess,
  checkSubComplianceForPO,
  createPurchaseOrderSchema,
  formatPoNumber,
  type ComplianceDocRecord,
  type ComplianceDocType,
} from '@interstate/shared';
import { demoStore } from '../data/demo-store.js';
import { getDb } from '../db/client.js';
import {
  complianceDocuments,
  costCodes,
  homes,
  purchaseOrders,
  subCompanies,
  subContacts,
  systemSettings,
} from '../db/schema/index.js';
import {
  isUsingDemoStore,
  requirePermission,
  requireRecentReauth,
} from '../security/auth-plugin.js';
import { isValidUuid, writeAuditLog } from '../security/audit.js';
import { createPoDocuSealSubmission } from '../services/docuseal.js';

export async function registerPurchaseOrderRoutes(app: FastifyInstance) {
  app.get('/api/purchase-orders', { schema: { tags: ['Purchase Orders'] } }, async (request, reply) => {
    if (request.actor.role === 'homeowner') {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const canSeeInternal = canAccess(request.actor.role, 'financials:view_internal');

    if (isUsingDemoStore()) {
      if (request.actor.role === 'subcontractor') {
        if (!request.actor.subCompanyId) {
          return { purchaseOrders: [] };
        }
        return {
          purchaseOrders: demoStore.purchaseOrders.filter(
            (p) =>
              p.subCompanyId === request.actor.subCompanyId &&
              !INTERNAL_ONLY_COST_CODES.has(p.costCode)
          ),
        };
      }
      const pos = demoStore.purchaseOrders.filter(
        (p) => canSeeInternal || !INTERNAL_ONLY_COST_CODES.has(p.costCode)
      );
      return { purchaseOrders: pos };
    }

    const db = getDb();
    const isSubRole = request.actor.role === 'subcontractor';
    const subFilterId =
      isSubRole && isValidUuid(request.actor.subCompanyId) ? request.actor.subCompanyId : null;

    if (isSubRole && !subFilterId) {
      return { purchaseOrders: [] };
    }

    const [poRows, homeRows, subRows, codeRows] = await Promise.all([
      subFilterId
        ? db
            .select()
            .from(purchaseOrders)
            .where(eq(purchaseOrders.subCompanyId, subFilterId))
            .orderBy(desc(purchaseOrders.createdAt))
        : db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.createdAt)),
      db.select({ id: homes.id, homeCode: homes.homeCode }).from(homes),
      db.select({ id: subCompanies.id, legalName: subCompanies.legalName }).from(subCompanies),
      db.select({ code: costCodes.code, name: costCodes.name }).from(costCodes),
    ]);

    const homeMap = new Map(homeRows.map((h) => [h.id, h.homeCode]));
    const subMap = new Map(subRows.map((s) => [s.id, s.legalName]));
    const codeMap = new Map(codeRows.map((c) => [c.code, c.name]));

    const visibleRows = poRows.filter(
      (p) => canSeeInternal || !INTERNAL_ONLY_COST_CODES.has(p.costCode)
    );

    return {
      purchaseOrders: visibleRows.map((p) => ({
        id: p.id,
        poNumber: p.poNumber,
        homeId: p.homeId,
        homeCode: homeMap.get(p.homeId) ?? p.homeId,
        costCode: p.costCode,
        costCodeName: codeMap.get(p.costCode) ?? p.costCode,
        subCompanyId: p.subCompanyId,
        subName: subMap.get(p.subCompanyId) ?? p.subCompanyId,
        poType: p.poType,
        scopeSummary: p.scopeSummary,
        planRevision: p.planRevision,
        totalCents: p.totalCents,
        masterAgreementRef: p.masterAgreementRef,
        status: p.status,
        docusealSubmissionId: p.docusealSubmissionId ?? '',
        subSignedAt: p.subSignedAt ? p.subSignedAt.toISOString() : null,
        approverSignedAt: p.approverSignedAt ? p.approverSignedAt.toISOString() : null,
      })),
    };
  });

  app.post(
    '/api/purchase-orders',
    {
      preHandler: [requirePermission('pos:issue')],
      schema: {
        tags: ['Purchase Orders'],
        summary: 'Issue a compliance-gated Subcontractor or Supplier PO and create DocuSeal envelope',
      },
    },
    async (request, reply) => {
      const parsed = createPurchaseOrderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
      }
      const d = parsed.data;

      // Reject non-estimateable "00" and internal-only cost codes on POs (SOW Section 7 & 9)
      if (d.costCode === '00' || INTERNAL_ONLY_COST_CODES.has(d.costCode)) {
        return reply.status(400).send({
          error: 'InvalidCostCode',
          message: `Cost code "${d.costCode}" cannot be used for a subcontractor or supplier Purchase Order.`,
        });
      }

      if (isUsingDemoStore()) {
        const home = demoStore.homes.find((h) => h.id === d.homeId);
        const sub = demoStore.subcontractors.find((s) => s.id === d.subId);
        const cc = COST_CODE_MAP.get(d.costCode);
        if (!home || !sub || !cc) {
          return reply.status(404).send({ error: 'ReferencedEntityNotFound' });
        }

        // Prevent compliance gate bypass via client-controlled poType
        if (
          d.poType === 'supplier' &&
          (sub.companyType === 'subcontractor' || !cc.pricingSources.includes('supplier'))
        ) {
          return reply.status(422).send({
            error: 'InvalidPoType',
            message: `Cannot issue a supplier PO for subcontractor "${sub.legalName}" on cost code ${cc.code}.`,
          });
        }
        if (d.poType === 'subcontractor' && sub.companyType === 'supplier') {
          return reply.status(422).send({
            error: 'InvalidPoType',
            message: `Cannot issue a subcontractor PO to supplier-only vendor "${sub.legalName}".`,
          });
        }

        // Section 8.2 & Rule 4: Block PO if any required compliance document is missing/expired
        const compliance = checkSubComplianceForPO(
          { status: sub.status, hasVehiclesOnSite: sub.hasVehiclesOnSite },
          sub.complianceDocs,
          {
            poType: d.poType,
            requiresUtahLicense: cc.requiresUtahLicense,
            minGlLimitCents: demoStore.settings.defaultGlMinLimitCents,
            minAutoLimitCents: demoStore.settings.defaultAutoMinLimitCents,
            requireMasterAgreement: demoStore.settings.requireMasterAgreement,
            currentMasterAgreementVersion: demoStore.settings.currentMasterAgreementVersion,
          }
        );

        if (!compliance.eligible) {
          await writeAuditLog({
            actorUserId: request.actor.userId,
            actorEmail: request.actor.email,
            action: 'PO_BLOCKED_COMPLIANCE',
            entityType: 'subcontractor',
            entityId: sub.id,
            homeId: home.id,
            ipAddress: request.ip,
            afterValues: { costCode: d.costCode, blockingReasons: compliance.blockingReasons },
          });
          return reply.status(422).send({
            error: 'ComplianceBlocked',
            subCompanyId: sub.id,
            message: `${sub.legalName} cannot receive a PO due to compliance issues.`,
            blockingReasons: compliance.blockingReasons,
          });
        }

        const existingSameCode = demoStore.purchaseOrders.filter(
          (p) => p.homeId === home.id && p.costCode === d.costCode
        );
        const existingSameType = existingSameCode.filter((p) => p.poType === d.poType);
        if (existingSameType.length > 0 && !d.splitScopeOverrideReason?.trim()) {
          return reply.status(422).send({
            error: 'SplitScopeOverrideRequired',
            message: `A ${d.poType} PO already exists for ${home.homeCode} cost code ${d.costCode}. Provide a split-scope override reason to issue an additional PO.`,
          });
        }

        const poNumber = formatPoNumber(
          home.subdivisionCode,
          home.lot,
          d.costCode,
          existingSameCode.length + 1
        );

        const docuseal = await createPoDocuSealSubmission({
          poNumber,
          documentTitle: `${poNumber} — ${cc.name}`,
          subSignerName: sub.primaryContactName,
          subSignerEmail: sub.primaryContactEmail,
          approverName: request.actor.fullName,
          approverEmail: request.actor.email,
          masterAgreementRef:
            d.poType === 'subcontractor'
              ? `MSA v${demoStore.settings.currentMasterAgreementVersion}`
              : 'Supplier Terms',
          totalCents: d.totalCents,
        });

        const newPo = {
          id: `po-${poNumber.toLowerCase()}`,
          poNumber,
          homeId: home.id,
          homeCode: home.homeCode,
          costCode: d.costCode,
          costCodeName: cc.name,
          subCompanyId: sub.id,
          subName: sub.legalName,
          poType: d.poType,
          scopeSummary: d.scopeSummary,
          planRevision: d.planRevision,
          totalCents: d.totalCents,
          masterAgreementRef:
            d.poType === 'subcontractor'
              ? `MSA v${demoStore.settings.currentMasterAgreementVersion}`
              : null,
          status: 'pending_sub_signature' as const,
          docusealSubmissionId: docuseal.submissionId,
          subSignedAt: null,
          approverSignedAt: null,
        };

        demoStore.purchaseOrders.unshift(newPo);
        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'PO_ISSUED',
          entityType: 'purchase_order',
          entityId: poNumber,
          homeId: home.id,
          ipAddress: request.ip,
          afterValues: {
            poNumber,
            poType: d.poType,
            totalCents: d.totalCents,
            splitScopeOverrideReason: d.splitScopeOverrideReason ?? null,
          },
        });

        return reply.status(201).send({ purchaseOrder: newPo, docuseal });
      }

      // Postgres mode
      if (!isValidUuid(d.homeId) || !isValidUuid(d.subId)) {
        return reply.status(404).send({ error: 'ReferencedEntityNotFound' });
      }

      const db = getDb();
      const [[home], [sub], [cc], docs, contacts, [settingsRow], existingPos] = await Promise.all([
        db.select().from(homes).where(eq(homes.id, d.homeId)).limit(1),
        db.select().from(subCompanies).where(eq(subCompanies.id, d.subId)).limit(1),
        db.select().from(costCodes).where(eq(costCodes.code, d.costCode)).limit(1),
        db
          .select()
          .from(complianceDocuments)
          .where(eq(complianceDocuments.subCompanyId, d.subId))
          .orderBy(desc(complianceDocuments.receivedAt)),
        db.select().from(subContacts).where(eq(subContacts.subCompanyId, d.subId)),
        db.select().from(systemSettings).where(eq(systemSettings.id, 'default')).limit(1),
        db
          .select({ id: purchaseOrders.id, poType: purchaseOrders.poType, status: purchaseOrders.status })
          .from(purchaseOrders)
          .where(
            and(eq(purchaseOrders.homeId, d.homeId), eq(purchaseOrders.costCode, d.costCode))
          ),
      ]);

      if (!home || !sub || !cc) {
        return reply.status(404).send({ error: 'ReferencedEntityNotFound' });
      }

      // Prevent compliance gate bypass via client-controlled poType
      if (
        d.poType === 'supplier' &&
        (sub.companyType === 'subcontractor' || !cc.pricingSourcesJson.includes('supplier'))
      ) {
        return reply.status(422).send({
          error: 'InvalidPoType',
          message: `Cannot issue a supplier PO for subcontractor "${sub.legalName}" on cost code ${cc.code}.`,
        });
      }
      if (d.poType === 'subcontractor' && sub.companyType === 'supplier') {
        return reply.status(422).send({
          error: 'InvalidPoType',
          message: `Cannot issue a subcontractor PO to supplier-only vendor "${sub.legalName}".`,
        });
      }

      const minGlLimitCents =
        settingsRow?.defaultGlMinLimitCents ?? DEFAULT_SYSTEM_SETTINGS.defaultGlMinLimitCents;
      const minAutoLimitCents =
        settingsRow?.defaultAutoMinLimitCents ?? DEFAULT_SYSTEM_SETTINGS.defaultAutoMinLimitCents;
      const requireMasterAgreement =
        settingsRow?.requireMasterAgreement ?? DEFAULT_SYSTEM_SETTINGS.requireMasterAgreement;
      const currentMasterAgreementVersion =
        settingsRow?.currentMasterAgreementVersion ??
        DEFAULT_SYSTEM_SETTINGS.currentMasterAgreementVersion;

      const mappedDocs: ComplianceDocRecord[] = docs.map((doc) => ({
        id: doc.id,
        fileName: doc.fileName,
        docType: doc.docType as ComplianceDocType,
        reviewStatus: doc.reviewStatus as 'pending' | 'approved' | 'rejected',
        expiresAt: doc.expiresAt ?? null,
        limitAmountCents: doc.limitAmountCents ?? null,
        additionalInsured: doc.additionalInsured ?? false,
        licenseClassification: doc.licenseClassification ?? null,
        agreementVersion: doc.agreementVersion ?? null,
      }));

      // Section 8.2 & Rule 4: Block PO if any required compliance document is missing/expired
      const compliance = checkSubComplianceForPO(
        {
          status: sub.status as 'active' | 'on_hold' | 'inactive',
          hasVehiclesOnSite: sub.hasVehiclesOnSite,
        },
        mappedDocs,
        {
          poType: d.poType,
          requiresUtahLicense: cc.requiresUtahLicense,
          minGlLimitCents,
          minAutoLimitCents,
          requireMasterAgreement,
          currentMasterAgreementVersion,
        }
      );

      if (!compliance.eligible) {
        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'PO_BLOCKED_COMPLIANCE',
          entityType: 'subcontractor',
          entityId: sub.id,
          homeId: home.id,
          ipAddress: request.ip,
          afterValues: { costCode: d.costCode, blockingReasons: compliance.blockingReasons },
        });
        return reply.status(422).send({
          error: 'ComplianceBlocked',
          subCompanyId: sub.id,
          message: `${sub.legalName} cannot receive a PO due to compliance issues.`,
          blockingReasons: compliance.blockingReasons,
        });
      }

      const existingSameType = existingPos.filter(
        (p) => p.poType === d.poType && p.status !== 'voided'
      );
      if (existingSameType.length > 0 && !d.splitScopeOverrideReason?.trim()) {
        return reply.status(422).send({
          error: 'SplitScopeOverrideRequired',
          message: `A ${d.poType} PO already exists for ${home.homeCode} cost code ${d.costCode}. Provide a split-scope override reason to issue an additional PO.`,
        });
      }

      const primaryContact = contacts.find((c) => c.isSigner) ?? contacts[0];
      const masterAgreementRef =
        d.poType === 'subcontractor' ? `MSA v${currentMasterAgreementVersion}` : null;

      let inserted: typeof purchaseOrders.$inferSelect | undefined;
      let poNumber = '';
      let docuseal: Awaited<ReturnType<typeof createPoDocuSealSubmission>> | undefined;

      for (let attempt = 0; attempt < 5; attempt++) {
        const currentPos = await db
          .select({ id: purchaseOrders.id })
          .from(purchaseOrders)
          .where(
            and(eq(purchaseOrders.homeId, d.homeId), eq(purchaseOrders.costCode, d.costCode))
          );
        poNumber = formatPoNumber(
          home.subdivisionCode,
          home.lot,
          d.costCode,
          currentPos.length + 1 + attempt
        );

        docuseal = await createPoDocuSealSubmission({
          poNumber,
          documentTitle: `${poNumber} — ${cc.name}`,
          subSignerName: primaryContact?.fullName ?? sub.legalName,
          subSignerEmail: primaryContact?.email ?? 'office@interstatehomes.com',
          approverName: request.actor.fullName,
          approverEmail: request.actor.email,
          masterAgreementRef: masterAgreementRef ?? 'Supplier Terms',
          totalCents: d.totalCents,
        });

        try {
          const [row] = await db
            .insert(purchaseOrders)
            .values({
              poNumber,
              homeId: home.id,
              costCode: cc.code,
              subCompanyId: sub.id,
              poType: d.poType,
              scopeSummary: d.scopeSummary,
              planRevision: d.planRevision,
              totalCents: d.totalCents,
              masterAgreementRef,
              splitScopeOverrideBy:
                d.splitScopeOverrideReason && isValidUuid(request.actor.userId)
                  ? request.actor.userId
                  : null,
              splitScopeOverrideReason: d.splitScopeOverrideReason ?? null,
              status: 'pending_sub_signature',
              docusealSubmissionId: docuseal.submissionId,
            })
            .returning();
          inserted = row;
          break;
        } catch (err) {
          const pgCode = (err as { code?: string })?.code;
          if (pgCode === '23505' && attempt < 4) continue;
          throw err;
        }
      }

      if (!inserted || !docuseal) {
        return reply.status(409).send({ error: 'PoNumberConflict', message: 'Could not allocate unique PO number.' });
      }

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'PO_ISSUED',
        entityType: 'purchase_order',
        entityId: poNumber,
        homeId: home.id,
        ipAddress: request.ip,
        afterValues: {
          poNumber,
          poType: d.poType,
          totalCents: d.totalCents,
          splitScopeOverrideReason: d.splitScopeOverrideReason ?? null,
        },
      });

      return reply.status(201).send({
        purchaseOrder: {
          id: inserted.id,
          poNumber: inserted.poNumber,
          homeId: inserted.homeId,
          homeCode: home.homeCode,
          costCode: inserted.costCode,
          costCodeName: cc.name,
          subCompanyId: inserted.subCompanyId,
          subName: sub.legalName,
          poType: inserted.poType,
          scopeSummary: inserted.scopeSummary,
          planRevision: inserted.planRevision,
          totalCents: inserted.totalCents,
          masterAgreementRef: inserted.masterAgreementRef,
          status: inserted.status,
          docusealSubmissionId: inserted.docusealSubmissionId ?? '',
          subSignedAt: null,
          approverSignedAt: null,
        },
        docuseal,
      });
    }
  );

  app.post(
    '/api/purchase-orders/:id/sign',
    {
      preHandler: [requireRecentReauth(15)],
      schema: { tags: ['Purchase Orders'], summary: 'Record subcontractor or approver e-signature' },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      if (isUsingDemoStore()) {
        const po = demoStore.purchaseOrders.find((p) => p.id === id);
        if (!po) return reply.status(404).send({ error: 'PurchaseOrderNotFound' });

        const prevStatus = po.status;
        if (po.status === 'pending_sub_signature') {
          if (
            !canAccess(request.actor.role, 'pos:sign_sub') ||
            !request.actor.subCompanyId ||
            po.subCompanyId !== request.actor.subCompanyId
          ) {
            return reply.status(403).send({
              error: 'Forbidden',
              message: 'Only the assigned subcontractor can apply the subcontractor e-signature.',
            });
          }
          po.status = 'pending_approver_signature';
          po.subSignedAt = new Date().toISOString();
        } else if (po.status === 'pending_approver_signature') {
          if (!canAccess(request.actor.role, 'pos:sign_approver')) {
            return reply.status(403).send({
              error: 'Forbidden',
              message: 'Approver permission is required for final PO counter-signature.',
            });
          }
          if (
            request.actor.approvalLimitCents !== null &&
            request.actor.approvalLimitCents !== undefined &&
            po.totalCents > request.actor.approvalLimitCents
          ) {
            return reply.status(403).send({
              error: 'ApprovalLimitExceeded',
              message: `PO total exceeds your approval limit of $${(request.actor.approvalLimitCents / 100).toLocaleString()}.`,
            });
          }
          po.status = 'fully_signed';
          po.approverSignedAt = new Date().toISOString();
        } else {
          return reply.status(409).send({
            error: 'InvalidPoState',
            message: `Purchase order ${po.poNumber} is already "${po.status}" and cannot be signed again.`,
          });
        }

        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'PO_SIGNED',
          entityType: 'purchase_order',
          entityId: po.poNumber,
          homeId: po.homeId,
          ipAddress: request.ip,
          beforeValues: { status: prevStatus },
          afterValues: { status: po.status },
        });

        return { purchaseOrder: po };
      }

      if (!isValidUuid(id)) {
        return reply.status(404).send({ error: 'PurchaseOrderNotFound' });
      }
      const db = getDb();
      const [po] = await db
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, id))
        .limit(1);
      if (!po) return reply.status(404).send({ error: 'PurchaseOrderNotFound' });

      const prevStatus = po.status;
      const now = new Date();
      let nextStatus = po.status;
      let nextSubSignedAt = po.subSignedAt;
      let nextApproverSignedAt = po.approverSignedAt;

      if (po.status === 'pending_sub_signature') {
        if (
          !canAccess(request.actor.role, 'pos:sign_sub') ||
          !request.actor.subCompanyId ||
          po.subCompanyId !== request.actor.subCompanyId
        ) {
          return reply.status(403).send({
            error: 'Forbidden',
            message: 'Only the assigned subcontractor can apply the subcontractor e-signature.',
          });
        }
        nextStatus = 'pending_approver_signature';
        nextSubSignedAt = now;
      } else if (po.status === 'pending_approver_signature') {
        if (!canAccess(request.actor.role, 'pos:sign_approver')) {
          return reply.status(403).send({
            error: 'Forbidden',
            message: 'Approver permission is required for final PO counter-signature.',
          });
        }
        if (
          request.actor.approvalLimitCents !== null &&
          request.actor.approvalLimitCents !== undefined &&
          po.totalCents > request.actor.approvalLimitCents
        ) {
          return reply.status(403).send({
            error: 'ApprovalLimitExceeded',
            message: `PO total exceeds your approval limit of $${(request.actor.approvalLimitCents / 100).toLocaleString()}.`,
          });
        }
        nextStatus = 'fully_signed';
        nextApproverSignedAt = now;
      } else {
        return reply.status(409).send({
          error: 'InvalidPoState',
          message: `Purchase order ${po.poNumber} is already "${po.status}" and cannot be signed again.`,
        });
      }

      const [updated] = await db
        .update(purchaseOrders)
        .set({
          status: nextStatus,
          subSignedAt: nextSubSignedAt,
          approverSignedAt: nextApproverSignedAt,
        })
        .where(eq(purchaseOrders.id, po.id))
        .returning();

      const [[home], [sub], [cc]] = await Promise.all([
        db.select({ homeCode: homes.homeCode }).from(homes).where(eq(homes.id, po.homeId)).limit(1),
        db
          .select({ legalName: subCompanies.legalName })
          .from(subCompanies)
          .where(eq(subCompanies.id, po.subCompanyId))
          .limit(1),
        db
          .select({ name: costCodes.name })
          .from(costCodes)
          .where(eq(costCodes.code, po.costCode))
          .limit(1),
      ]);

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'PO_SIGNED',
        entityType: 'purchase_order',
        entityId: po.poNumber,
        homeId: po.homeId,
        ipAddress: request.ip,
        beforeValues: { status: prevStatus },
        afterValues: { status: nextStatus },
      });

      return {
        purchaseOrder: {
          id: updated!.id,
          poNumber: updated!.poNumber,
          homeId: updated!.homeId,
          homeCode: home?.homeCode ?? updated!.homeId,
          costCode: updated!.costCode,
          costCodeName: cc?.name ?? updated!.costCode,
          subCompanyId: updated!.subCompanyId,
          subName: sub?.legalName ?? updated!.subCompanyId,
          poType: updated!.poType,
          scopeSummary: updated!.scopeSummary,
          planRevision: updated!.planRevision,
          totalCents: updated!.totalCents,
          masterAgreementRef: updated!.masterAgreementRef,
          status: updated!.status,
          docusealSubmissionId: updated!.docusealSubmissionId ?? '',
          subSignedAt: updated!.subSignedAt ? updated!.subSignedAt.toISOString() : null,
          approverSignedAt: updated!.approverSignedAt
            ? updated!.approverSignedAt.toISOString()
            : null,
        },
      };
    }
  );
}
