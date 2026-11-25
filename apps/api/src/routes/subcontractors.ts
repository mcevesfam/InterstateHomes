import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  COST_CODE_MAP,
  DEFAULT_SYSTEM_SETTINGS,
  canAccess,
  checkSubComplianceForPO,
  costCodeTextSchema,
  createSubcontractorSchema,
  isoDateSchema,
  type ComplianceDocRecord,
  type ComplianceDocType,
} from '@interstate/shared';
import { demoStore } from '../data/demo-store.js';
import { getDb } from '../db/client.js';
import {
  complianceDocuments,
  costCodes,
  priceSheetItems,
  priceSheets,
  subCompanies,
  subContacts,
  subCostCodes,
  subdivisions,
  systemSettings,
} from '../db/schema/index.js';
import { isUsingDemoStore, requirePermission } from '../security/auth-plugin.js';
import { isValidUuid, writeAuditLog } from '../security/audit.js';
import { encryptSensitive, maskTin } from '../security/crypto.js';

const createPriceSheetSchema = z.object({
  subCompanyId: z.string().min(1),
  costCode: costCodeTextSchema,
  subdivisionScope: z.string().min(1).max(32).default('ALL'),
  effectiveFrom: isoDateSchema,
  effectiveTo: isoDateSchema.nullable().optional(),
  minimumChargeCents: z.number().int().nonnegative().nullable().optional(),
  inclusionsExclusions: z.string().max(2000).default(''),
  items: z
    .array(
      z.object({
        subLineName: z.string().min(1).max(200),
        unit: z.string().min(1).max(32),
        unitPriceCents: z.number().int().nonnegative(),
        notes: z.string().max(500).optional(),
      })
    )
    .min(1),
});

const complianceDocTypeSchema = z.enum([
  'coi_gl',
  'auto_liability',
  'workers_comp',
  'w9',
  'utah_license',
  'business_license',
  'master_agreement',
]);

const uploadComplianceDocSchema = z.object({
  docType: complianceDocTypeSchema,
  fileName: z.string().min(1).max(200),
  storageKey: z.string().max(300).optional(),
  carrier: z.string().max(150).optional(),
  policyOrLicenseNumber: z.string().max(100).optional(),
  limitAmountCents: z.number().int().nonnegative().nullable().optional(),
  additionalInsured: z.boolean().optional(),
  licenseClassification: z.string().max(60).optional(),
  agreementVersion: z.string().max(40).optional(),
  entityType: z.string().max(60).optional(),
  w9Tin: z.string().max(30).optional(),
  expiresAt: isoDateSchema.nullable().optional(),
});

const reviewComplianceDocSchema = z
  .object({
    reviewStatus: z.enum(['approved', 'rejected']).optional(),
    status: z.enum(['approved', 'rejected']).optional(),
  })
  .refine((v) => Boolean(v.reviewStatus || v.status), {
    message: 'reviewStatus ("approved" | "rejected") is required.',
  });

function subRequiresUtahLicense(companyType: string, codesServed: string[]): boolean {
  if (companyType === 'supplier') return false;
  if (codesServed.length === 0) return false;
  return codesServed.some((code) => COST_CODE_MAP.get(code)?.requiresUtahLicense === true);
}

async function getComplianceSettingsFromDb() {
  const db = getDb();
  const [row] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.id, 'default'))
    .limit(1);
  return {
    defaultGlMinLimitCents:
      row?.defaultGlMinLimitCents ?? DEFAULT_SYSTEM_SETTINGS.defaultGlMinLimitCents,
    defaultAutoMinLimitCents:
      row?.defaultAutoMinLimitCents ?? DEFAULT_SYSTEM_SETTINGS.defaultAutoMinLimitCents,
    requireMasterAgreement:
      row?.requireMasterAgreement ?? DEFAULT_SYSTEM_SETTINGS.requireMasterAgreement,
    currentMasterAgreementVersion:
      row?.currentMasterAgreementVersion ?? DEFAULT_SYSTEM_SETTINGS.currentMasterAgreementVersion,
  };
}

function mapComplianceDocs(rows: Array<typeof complianceDocuments.$inferSelect>): ComplianceDocRecord[] {
  return rows.map((d) => ({
    id: d.id,
    fileName: d.fileName,
    docType: d.docType as ComplianceDocType,
    reviewStatus: d.reviewStatus as 'pending' | 'approved' | 'rejected',
    expiresAt: d.expiresAt ?? null,
    limitAmountCents: d.limitAmountCents ?? null,
    additionalInsured: d.additionalInsured ?? false,
    licenseClassification: d.licenseClassification ?? null,
    agreementVersion: d.agreementVersion ?? null,
  }));
}

function enrichDemoComplianceDocs(subId: string, docs: ComplianceDocRecord[]): ComplianceDocRecord[] {
  return docs.map((d, idx) => ({
    ...d,
    id: d.id ?? `doc-${subId}-${d.docType}-${idx}`,
    fileName: d.fileName ?? `${d.docType}.pdf`,
  }));
}

export async function registerSubcontractorRoutes(app: FastifyInstance) {
  app.get('/api/subcontractors', { schema: { tags: ['Subcontractors'] } }, async (request, reply) => {
    if (request.actor.role === 'homeowner') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    if (isUsingDemoStore()) {
      let subs = demoStore.subcontractors;
      if (request.actor.role === 'subcontractor') {
        if (!request.actor.subCompanyId) {
          return { subcontractors: [] };
        }
        subs = demoStore.subcontractors.filter((s) => s.id === request.actor.subCompanyId);
      }

      return {
        subcontractors: subs.map((s) => {
          const docsWithIds = enrichDemoComplianceDocs(s.id, s.complianceDocs);
          return {
            ...s,
            complianceDocs: docsWithIds,
            complianceStatus: checkSubComplianceForPO(
              { status: s.status, hasVehiclesOnSite: s.hasVehiclesOnSite },
              docsWithIds,
              {
                poType: s.companyType === 'supplier' ? 'supplier' : 'subcontractor',
                requiresUtahLicense: subRequiresUtahLicense(s.companyType, s.costCodesServed),
                minGlLimitCents: demoStore.settings.defaultGlMinLimitCents,
                minAutoLimitCents: demoStore.settings.defaultAutoMinLimitCents,
                requireMasterAgreement: demoStore.settings.requireMasterAgreement,
                currentMasterAgreementVersion: demoStore.settings.currentMasterAgreementVersion,
              }
            ),
          };
        }),
      };
    }

    const db = getDb();
    const isSubRole = request.actor.role === 'subcontractor';
    const subFilterId =
      isSubRole && isValidUuid(request.actor.subCompanyId) ? request.actor.subCompanyId : null;

    if (isSubRole && !subFilterId) {
      return { subcontractors: [] };
    }

    const [companies, contacts, costCodeLinks, docs, sheets, settings] = await Promise.all([
      subFilterId
        ? db.select().from(subCompanies).where(eq(subCompanies.id, subFilterId))
        : db.select().from(subCompanies).orderBy(desc(subCompanies.createdAt)),
      db.select().from(subContacts),
      db.select().from(subCostCodes),
      db.select().from(complianceDocuments).orderBy(desc(complianceDocuments.receivedAt)),
      db.select().from(priceSheets).orderBy(desc(priceSheets.createdAt)),
      getComplianceSettingsFromDb(),
    ]);

    const contactsBySub = new Map<string, Array<typeof subContacts.$inferSelect>>();
    for (const c of contacts) {
      const list = contactsBySub.get(c.subCompanyId) ?? [];
      list.push(c);
      contactsBySub.set(c.subCompanyId, list);
    }

    const linksBySub = new Map<string, Array<typeof subCostCodes.$inferSelect>>();
    for (const l of costCodeLinks) {
      const list = linksBySub.get(l.subCompanyId) ?? [];
      list.push(l);
      linksBySub.set(l.subCompanyId, list);
    }

    const docsBySub = new Map<string, Array<typeof complianceDocuments.$inferSelect>>();
    for (const d of docs) {
      const list = docsBySub.get(d.subCompanyId) ?? [];
      list.push(d);
      docsBySub.set(d.subCompanyId, list);
    }

    const latestPricingBySub = new Map<string, string>();
    for (const ps of sheets) {
      if (!latestPricingBySub.has(ps.subCompanyId)) {
        latestPricingBySub.set(ps.subCompanyId, ps.effectiveFrom);
      }
    }

    return {
      subcontractors: companies.map((s) => {
        const subContactList = contactsBySub.get(s.id) ?? [];
        const primaryContact = subContactList.find((c) => c.isSigner) ?? subContactList[0];
        const links = linksBySub.get(s.id) ?? [];
        const subDocsRaw = docsBySub.get(s.id) ?? [];
        const mappedDocs = mapComplianceDocs(subDocsRaw);
        const w9Doc = subDocsRaw.find((d) => d.docType === 'w9' && d.w9TinLast4);

        const costCodesServed = Array.from(new Set(links.map((l) => l.costCode)));
        const subdivisionsServed = Array.from(
          new Set(links.map((l) => l.subdivisionCode ?? 'ALL'))
        );
        const preferredForCodes = Array.from(
          new Set(links.filter((l) => l.isPreferred).map((l) => l.costCode))
        );

        const complianceStatus = checkSubComplianceForPO(
          {
            status: s.status as 'active' | 'on_hold' | 'inactive',
            hasVehiclesOnSite: s.hasVehiclesOnSite,
          },
          mappedDocs,
          {
            poType: s.companyType === 'supplier' ? 'supplier' : 'subcontractor',
            requiresUtahLicense: subRequiresUtahLicense(s.companyType, costCodesServed),
            minGlLimitCents: settings.defaultGlMinLimitCents,
            minAutoLimitCents: settings.defaultAutoMinLimitCents,
            requireMasterAgreement: settings.requireMasterAgreement,
            currentMasterAgreementVersion: settings.currentMasterAgreementVersion,
          }
        );

        return {
          id: s.id,
          legalName: s.legalName,
          dbaName: s.dbaName,
          companyType: s.companyType,
          mainPhone: s.mainPhone ?? '',
          primaryContactName: primaryContact?.fullName ?? 'Primary Contact',
          primaryContactEmail: primaryContact?.email ?? '',
          hasVehiclesOnSite: s.hasVehiclesOnSite,
          status: s.status,
          costCodesServed,
          subdivisionsServed: subdivisionsServed.length > 0 ? subdivisionsServed : ['ALL'],
          preferredForCodes,
          paymentTermsNetDays: s.paymentTermsNetDays,
          w9TinMasked: w9Doc?.w9TinLast4 ? `***-**-${w9Doc.w9TinLast4}` : '***-**-****',
          lastPricingUpdatedAt:
            latestPricingBySub.get(s.id) ?? s.updatedAt.toISOString().slice(0, 10),
          complianceDocs: mappedDocs,
          complianceStatus,
        };
      }),
    };
  });

  app.get(
    '/api/subcontractors/:id/compliance-check',
    { schema: { tags: ['Subcontractors'] } },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      if (request.actor.role === 'homeowner') {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      if (
        request.actor.role === 'subcontractor' &&
        (!request.actor.subCompanyId || request.actor.subCompanyId !== id)
      ) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Subcontractors can only inspect their own compliance status.',
        });
      }

      const { costCode = '31', poType = 'subcontractor' } = request.query as {
        costCode?: string;
        poType?: 'subcontractor' | 'supplier';
      };

      const validCostCode = costCodeTextSchema.safeParse(costCode);
      if (!validCostCode.success) {
        return reply.status(400).send({
          error: 'ValidationError',
          details: validCostCode.error.flatten(),
        });
      }
      if (poType !== 'subcontractor' && poType !== 'supplier') {
        return reply.status(400).send({ error: 'ValidationError', message: 'Invalid poType.' });
      }

      if (isUsingDemoStore()) {
        const sub = demoStore.subcontractors.find((s) => s.id === id);
        if (!sub) return reply.status(404).send({ error: 'SubcontractorNotFound' });

        const cc = COST_CODE_MAP.get(validCostCode.data);
        const result = checkSubComplianceForPO(
          { status: sub.status, hasVehiclesOnSite: sub.hasVehiclesOnSite },
          sub.complianceDocs,
          {
            poType,
            requiresUtahLicense: cc?.requiresUtahLicense ?? false,
            minGlLimitCents: demoStore.settings.defaultGlMinLimitCents,
            minAutoLimitCents: demoStore.settings.defaultAutoMinLimitCents,
            requireMasterAgreement: demoStore.settings.requireMasterAgreement,
            currentMasterAgreementVersion: demoStore.settings.currentMasterAgreementVersion,
          }
        );

        return { subId: sub.id, legalName: sub.legalName, costCode: validCostCode.data, poType, ...result };
      }

      if (!isValidUuid(id)) {
        return reply.status(404).send({ error: 'SubcontractorNotFound' });
      }

      const db = getDb();
      const [[sub], docs, [dbCc], settings] = await Promise.all([
        db.select().from(subCompanies).where(eq(subCompanies.id, id)).limit(1),
        db
          .select()
          .from(complianceDocuments)
          .where(eq(complianceDocuments.subCompanyId, id))
          .orderBy(desc(complianceDocuments.receivedAt)),
        db.select().from(costCodes).where(eq(costCodes.code, validCostCode.data)).limit(1),
        getComplianceSettingsFromDb(),
      ]);

      if (!sub) return reply.status(404).send({ error: 'SubcontractorNotFound' });

      const requiresUtahLicense =
        dbCc?.requiresUtahLicense ?? COST_CODE_MAP.get(validCostCode.data)?.requiresUtahLicense ?? false;

      const result = checkSubComplianceForPO(
        {
          status: sub.status as 'active' | 'on_hold' | 'inactive',
          hasVehiclesOnSite: sub.hasVehiclesOnSite,
        },
        mapComplianceDocs(docs),
        {
          poType,
          requiresUtahLicense,
          minGlLimitCents: settings.defaultGlMinLimitCents,
          minAutoLimitCents: settings.defaultAutoMinLimitCents,
          requireMasterAgreement: settings.requireMasterAgreement,
          currentMasterAgreementVersion: settings.currentMasterAgreementVersion,
        }
      );

      return { subId: sub.id, legalName: sub.legalName, costCode: validCostCode.data, poType, ...result };
    }
  );

  app.post(
    '/api/subcontractors',
    {
      preHandler: [requirePermission('price_sheets:edit_any')],
      schema: { tags: ['Subcontractors'] },
    },
    async (request, reply) => {
      const parsed = createSubcontractorSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
      }
      const d = parsed.data;
      const contactName = d.primaryContactName?.trim() || 'Primary Contact';
      const contactEmail = d.primaryContactEmail?.trim().toLowerCase() || 'office@interstatehomes.com';

      if (isUsingDemoStore()) {
        const id = `sub-${Date.now().toString(36)}`;
        const newSub = {
          id,
          legalName: d.legalName,
          dbaName: d.dbaName ?? null,
          companyType: d.companyType,
          mainPhone: d.mainPhone ?? '',
          primaryContactName: contactName,
          primaryContactEmail: contactEmail,
          hasVehiclesOnSite: d.hasVehiclesOnSite,
          status: 'active' as const,
          costCodesServed: d.costCodesServed,
          subdivisionsServed: d.subdivisionsServed,
          preferredForCodes: [],
          paymentTermsNetDays: d.paymentTermsNetDays,
          w9TinMasked: '***-**-0000',
          lastPricingUpdatedAt: new Date().toISOString().slice(0, 10),
          complianceDocs: [],
        };
        demoStore.subcontractors.push(newSub);
        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'SUBCONTRACTOR_CREATED',
          entityType: 'subcontractor',
          entityId: id,
          ipAddress: request.ip,
          afterValues: { legalName: d.legalName, costCodesServed: d.costCodesServed },
        });
        return reply.status(201).send({ subcontractor: newSub });
      }

      const db = getDb();
      const subScopeList = d.subdivisionsServed.length > 0 ? d.subdivisionsServed : ['ALL'];
      const explicitSubs = subScopeList
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s !== 'ALL');

      if (explicitSubs.length > 0) {
        const validSubRows = await db.select({ code: subdivisions.code }).from(subdivisions);
        const validCodes = new Set(validSubRows.map((r) => r.code));
        const unknown = explicitSubs.filter((c) => !validCodes.has(c));
        if (unknown.length > 0) {
          return reply.status(400).send({
            error: 'InvalidSubdivision',
            message: `Unknown subdivision code(s): ${unknown.join(', ')}`,
          });
        }
      }

      const created = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(subCompanies)
          .values({
            legalName: d.legalName,
            dbaName: d.dbaName ?? null,
            companyType: d.companyType,
            address: d.address ?? null,
            mainPhone: d.mainPhone ?? null,
            website: d.website ?? null,
            hasVehiclesOnSite: d.hasVehiclesOnSite,
            status: 'active',
            paymentTermsNetDays: d.paymentTermsNetDays,
            retainagePercent: String(d.retainagePercent),
          })
          .returning();

        // Always persist a primary signer contact so DocuSeal envelopes target a real contact
        await tx.insert(subContacts).values({
          subCompanyId: inserted!.id,
          fullName: contactName,
          roleTitle: 'Primary Signer',
          email: contactEmail,
          mobile: d.primaryContactPhone ?? d.mainPhone ?? null,
          isSigner: true,
        });

        const linkValues: Array<{
          subCompanyId: string;
          costCode: string;
          subdivisionCode: string | null;
          isPreferred: boolean;
        }> = [];

        for (const code of d.costCodesServed) {
          for (const subDiv of subScopeList) {
            const norm = subDiv.trim().toUpperCase();
            linkValues.push({
              subCompanyId: inserted!.id,
              costCode: code,
              subdivisionCode: norm === 'ALL' ? null : norm,
              isPreferred: false,
            });
          }
        }

        if (linkValues.length > 0) {
          await tx.insert(subCostCodes).values(linkValues);
        }

        return inserted!;
      });

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'SUBCONTRACTOR_CREATED',
        entityType: 'subcontractor',
        entityId: created.id,
        ipAddress: request.ip,
        afterValues: { legalName: d.legalName, costCodesServed: d.costCodesServed },
      });

      return reply.status(201).send({
        subcontractor: {
          id: created.id,
          legalName: created.legalName,
          dbaName: created.dbaName,
          companyType: created.companyType,
          mainPhone: created.mainPhone ?? '',
          primaryContactName: contactName,
          primaryContactEmail: contactEmail,
          hasVehiclesOnSite: created.hasVehiclesOnSite,
          status: created.status,
          costCodesServed: d.costCodesServed,
          subdivisionsServed: d.subdivisionsServed,
          preferredForCodes: [],
          paymentTermsNetDays: created.paymentTermsNetDays,
          w9TinMasked: '***-**-****',
          lastPricingUpdatedAt: created.createdAt.toISOString().slice(0, 10),
          complianceDocs: [],
        },
      });
    }
  );

  // Compliance Document Upload (subcontractor for own company OR internal reviewer)
  app.post(
    '/api/subcontractors/:id/compliance-docs',
    {
      schema: {
        tags: ['Subcontractors'],
        summary: 'Upload compliance document metadata (W-9 TIN AES-256-GCM encrypted & masked)',
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const canReview = canAccess(request.actor.role, 'compliance:review');
      const canUploadOwn =
        canAccess(request.actor.role, 'compliance:upload_own') &&
        Boolean(request.actor.subCompanyId) &&
        request.actor.subCompanyId === id;

      if (!canReview && !canUploadOwn) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Not authorized to upload compliance documents for this vendor.',
        });
      }

      const parsed = uploadComplianceDocSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
      }
      const d = parsed.data;
      const w9MaskedInfo = d.docType === 'w9' && d.w9Tin ? maskTin(d.w9Tin) : null;
      const w9Encrypted = d.docType === 'w9' && d.w9Tin ? encryptSensitive(d.w9Tin) : null;
      const storageKey =
        d.storageKey?.trim() || `compliance/${id}/${d.docType}-${Date.now()}-${d.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      if (isUsingDemoStore()) {
        const sub = demoStore.subcontractors.find((s) => s.id === id);
        if (!sub) return reply.status(404).send({ error: 'SubcontractorNotFound' });

        const docId = `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const newDoc: ComplianceDocRecord = {
          id: docId,
          fileName: d.fileName,
          docType: d.docType,
          reviewStatus: 'pending',
          expiresAt: d.expiresAt ?? null,
          limitAmountCents: d.limitAmountCents ?? null,
          additionalInsured: d.additionalInsured ?? false,
          licenseClassification: d.licenseClassification ?? null,
          agreementVersion: d.agreementVersion ?? null,
        };
        sub.complianceDocs.unshift(newDoc);
        if (w9MaskedInfo) {
          sub.w9TinMasked = w9MaskedInfo.masked;
        }

        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'COMPLIANCE_DOC_UPLOADED',
          entityType: 'compliance_document',
          entityId: docId,
          ipAddress: request.ip,
          afterValues: { subCompanyId: id, docType: d.docType, fileName: d.fileName },
        });

        return reply.status(201).send({
          document: {
            ...newDoc,
            ...(w9MaskedInfo ? { w9TinMasked: w9MaskedInfo.masked } : {}),
          },
        });
      }

      if (!isValidUuid(id)) {
        return reply.status(404).send({ error: 'SubcontractorNotFound' });
      }
      const db = getDb();
      const [sub] = await db
        .select({ id: subCompanies.id })
        .from(subCompanies)
        .where(eq(subCompanies.id, id))
        .limit(1);
      if (!sub) return reply.status(404).send({ error: 'SubcontractorNotFound' });

      const [inserted] = await db
        .insert(complianceDocuments)
        .values({
          subCompanyId: id,
          docType: d.docType,
          storageKey,
          fileName: d.fileName,
          carrier: d.carrier ?? null,
          policyOrLicenseNumber: d.policyOrLicenseNumber ?? null,
          limitAmountCents: d.limitAmountCents ?? null,
          additionalInsured: d.additionalInsured ?? false,
          licenseClassification: d.licenseClassification ?? null,
          agreementVersion: d.agreementVersion ?? null,
          entityType: d.entityType ?? null,
          w9TinEncrypted: w9Encrypted,
          w9TinLast4: w9MaskedInfo?.last4 ?? null,
          expiresAt: d.expiresAt ?? null,
          reviewStatus: 'pending',
        })
        .returning();

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'COMPLIANCE_DOC_UPLOADED',
        entityType: 'compliance_document',
        entityId: inserted!.id,
        ipAddress: request.ip,
        afterValues: { subCompanyId: id, docType: d.docType, fileName: d.fileName },
      });

      return reply.status(201).send({
        document: {
          id: inserted!.id,
          docType: inserted!.docType,
          fileName: inserted!.fileName,
          reviewStatus: inserted!.reviewStatus,
          expiresAt: inserted!.expiresAt ?? null,
          limitAmountCents: inserted!.limitAmountCents ?? null,
          additionalInsured: inserted!.additionalInsured ?? false,
          licenseClassification: inserted!.licenseClassification ?? null,
          agreementVersion: inserted!.agreementVersion ?? null,
          ...(inserted!.w9TinLast4 ? { w9TinMasked: `***-**-${inserted!.w9TinLast4}` } : {}),
        },
      });
    }
  );

  // Compliance Document Review (Admin / Compliance Reviewer only)
  app.patch(
    '/api/subcontractors/:id/compliance-docs/:docId/review',
    {
      preHandler: [requirePermission('compliance:review')],
      schema: {
        tags: ['Subcontractors'],
        summary: 'Approve or reject a subcontractor compliance document',
      },
    },
    async (request, reply) => {
      const { id, docId } = request.params as { id: string; docId: string };
      const parsed = reviewComplianceDocSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
      }
      const nextStatus = (parsed.data.reviewStatus ?? parsed.data.status)!;

      if (isUsingDemoStore()) {
        const sub = demoStore.subcontractors.find((s) => s.id === id);
        if (!sub) return reply.status(404).send({ error: 'SubcontractorNotFound' });

        // Ensure demo docs have deterministic IDs so review works on both initial & uploaded docs
        sub.complianceDocs = enrichDemoComplianceDocs(sub.id, sub.complianceDocs);
        const doc = sub.complianceDocs.find((d) => d.id === docId);
        if (!doc) return reply.status(404).send({ error: 'ComplianceDocNotFound' });

        const prevStatus = doc.reviewStatus;
        doc.reviewStatus = nextStatus;

        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'COMPLIANCE_DOC_REVIEWED',
          entityType: 'compliance_document',
          entityId: docId,
          ipAddress: request.ip,
          beforeValues: { reviewStatus: prevStatus },
          afterValues: { reviewStatus: nextStatus, subCompanyId: id, docType: doc.docType },
        });

        return { document: doc };
      }

      if (!isValidUuid(id) || !isValidUuid(docId)) {
        return reply.status(404).send({ error: 'ComplianceDocNotFound' });
      }
      const db = getDb();
      const [existing] = await db
        .select()
        .from(complianceDocuments)
        .where(
          and(
            eq(complianceDocuments.id, docId),
            eq(complianceDocuments.subCompanyId, id)
          )
        )
        .limit(1);

      if (!existing) return reply.status(404).send({ error: 'ComplianceDocNotFound' });

      const [updated] = await db
        .update(complianceDocuments)
        .set({
          reviewStatus: nextStatus,
          reviewedBy: isValidUuid(request.actor.userId) ? request.actor.userId : null,
          reviewedAt: new Date(),
        })
        .where(eq(complianceDocuments.id, existing.id))
        .returning();

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'COMPLIANCE_DOC_REVIEWED',
        entityType: 'compliance_document',
        entityId: existing.id,
        ipAddress: request.ip,
        beforeValues: { reviewStatus: existing.reviewStatus },
        afterValues: { reviewStatus: nextStatus, subCompanyId: id, docType: existing.docType },
      });

      return {
        document: {
          id: updated!.id,
          docType: updated!.docType,
          fileName: updated!.fileName,
          reviewStatus: updated!.reviewStatus,
          expiresAt: updated!.expiresAt ?? null,
          limitAmountCents: updated!.limitAmountCents ?? null,
          additionalInsured: updated!.additionalInsured ?? false,
          licenseClassification: updated!.licenseClassification ?? null,
          agreementVersion: updated!.agreementVersion ?? null,
        },
      };
    }
  );

  app.get('/api/price-sheets', { schema: { tags: ['Price Sheets'] } }, async (request, reply) => {
    if (request.actor.role === 'homeowner') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    if (isUsingDemoStore()) {
      if (request.actor.role === 'subcontractor') {
        if (!request.actor.subCompanyId) return { priceSheets: [] };
        return {
          priceSheets: demoStore.priceSheets.filter(
            (p) => p.subCompanyId === request.actor.subCompanyId
          ),
        };
      }
      return { priceSheets: demoStore.priceSheets };
    }

    const db = getDb();
    const isSubRole = request.actor.role === 'subcontractor';
    const subFilterId =
      isSubRole && isValidUuid(request.actor.subCompanyId) ? request.actor.subCompanyId : null;

    if (isSubRole && !subFilterId) {
      return { priceSheets: [] };
    }

    const [sheetRows, itemRows, subRows, codeRows] = await Promise.all([
      subFilterId
        ? db
            .select()
            .from(priceSheets)
            .where(eq(priceSheets.subCompanyId, subFilterId))
            .orderBy(desc(priceSheets.createdAt))
        : db.select().from(priceSheets).orderBy(desc(priceSheets.createdAt)),
      db.select().from(priceSheetItems),
      db.select().from(subCompanies),
      db.select().from(costCodes),
    ]);

    const subMap = new Map(subRows.map((s) => [s.id, s.legalName]));
    const codeMap = new Map(codeRows.map((c) => [c.code, c.name]));
    const itemsBySheet = new Map<
      string,
      Array<{ id: string; subLineName: string; unit: string; unitPriceCents: number }>
    >();
    for (const item of itemRows) {
      const list = itemsBySheet.get(item.priceSheetId) ?? [];
      list.push({
        id: item.id,
        subLineName: item.subLineName,
        unit: item.unit,
        unitPriceCents: item.unitPriceCents,
      });
      itemsBySheet.set(item.priceSheetId, list);
    }

    return {
      priceSheets: sheetRows.map((ps) => ({
        id: ps.id,
        subCompanyId: ps.subCompanyId,
        subName: subMap.get(ps.subCompanyId) ?? ps.subCompanyId,
        costCode: ps.costCode,
        costCodeName: codeMap.get(ps.costCode) ?? ps.costCode,
        subdivisionScope: ps.subdivisionScope,
        effectiveFrom: ps.effectiveFrom,
        effectiveTo: ps.effectiveTo,
        inclusionsExclusions: ps.inclusionsExclusions ?? '',
        items: itemsBySheet.get(ps.id) ?? [],
      })),
    };
  });

  app.post('/api/price-sheets', { schema: { tags: ['Price Sheets'] } }, async (request, reply) => {
    const parsed = createPriceSheetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
    }
    const d = parsed.data;

    const canEditAny = canAccess(request.actor.role, 'price_sheets:edit_any');
    const canEditOwn =
      canAccess(request.actor.role, 'price_sheets:edit_own') &&
      Boolean(request.actor.subCompanyId) &&
      request.actor.subCompanyId === d.subCompanyId;
    if (!canEditAny && !canEditOwn) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    if (isUsingDemoStore()) {
      const sub = demoStore.subcontractors.find((s) => s.id === d.subCompanyId);
      const cc = COST_CODE_MAP.get(d.costCode);
      if (!sub || !cc) {
        return reply.status(404).send({ error: 'ReferencedEntityNotFound' });
      }
      const id = `ps-${Date.now().toString(36)}`;
      const sheet = {
        id,
        subCompanyId: sub.id,
        subName: sub.legalName,
        costCode: d.costCode,
        costCodeName: cc.name,
        subdivisionScope: d.subdivisionScope,
        effectiveFrom: d.effectiveFrom,
        effectiveTo: d.effectiveTo ?? null,
        inclusionsExclusions: d.inclusionsExclusions,
        items: d.items.map((item, idx) => ({
          id: `${id}-i${idx + 1}`,
          subLineName: item.subLineName,
          unit: item.unit,
          unitPriceCents: item.unitPriceCents,
        })),
      };
      demoStore.priceSheets.unshift(sheet);
      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'PRICE_SHEET_CREATED',
        entityType: 'price_sheet',
        entityId: id,
        ipAddress: request.ip,
        afterValues: { subCompanyId: sub.id, costCode: d.costCode, itemCount: d.items.length },
      });
      return reply.status(201).send({ priceSheet: sheet });
    }

    if (!isValidUuid(d.subCompanyId)) {
      return reply.status(404).send({ error: 'SubcontractorNotFound' });
    }
    const db = getDb();
    const [[sub], [cc]] = await Promise.all([
      db.select().from(subCompanies).where(eq(subCompanies.id, d.subCompanyId)).limit(1),
      db.select().from(costCodes).where(eq(costCodes.code, d.costCode)).limit(1),
    ]);
    if (!sub || !cc) {
      return reply.status(404).send({ error: 'ReferencedEntityNotFound' });
    }

    const result = await db.transaction(async (tx) => {
      const [sheet] = await tx
        .insert(priceSheets)
        .values({
          subCompanyId: sub.id,
          costCode: cc.code,
          subdivisionScope: d.subdivisionScope,
          effectiveFrom: d.effectiveFrom,
          effectiveTo: d.effectiveTo ?? null,
          minimumChargeCents: d.minimumChargeCents ?? null,
          inclusionsExclusions: d.inclusionsExclusions,
          updatedByUserId: isValidUuid(request.actor.userId) ? request.actor.userId : null,
        })
        .returning();

      const insertedItems = await tx
        .insert(priceSheetItems)
        .values(
          d.items.map((item) => ({
            priceSheetId: sheet!.id,
            subLineName: item.subLineName,
            unit: item.unit,
            unitPriceCents: item.unitPriceCents,
            notes: item.notes ?? null,
          }))
        )
        .returning();

      return { sheet: sheet!, items: insertedItems };
    });

    await writeAuditLog({
      actorUserId: request.actor.userId,
      actorEmail: request.actor.email,
      action: 'PRICE_SHEET_CREATED',
      entityType: 'price_sheet',
      entityId: result.sheet.id,
      ipAddress: request.ip,
      afterValues: { subCompanyId: sub.id, costCode: d.costCode, itemCount: result.items.length },
    });

    return reply.status(201).send({
      priceSheet: {
        id: result.sheet.id,
        subCompanyId: result.sheet.subCompanyId,
        subName: sub.legalName,
        costCode: result.sheet.costCode,
        costCodeName: cc.name,
        subdivisionScope: result.sheet.subdivisionScope,
        effectiveFrom: result.sheet.effectiveFrom,
        effectiveTo: result.sheet.effectiveTo,
        inclusionsExclusions: result.sheet.inclusionsExclusions ?? '',
        items: result.items.map((i) => ({
          id: i.id,
          subLineName: i.subLineName,
          unit: i.unit,
          unitPriceCents: i.unitPriceCents,
        })),
      },
    });
  });
}
