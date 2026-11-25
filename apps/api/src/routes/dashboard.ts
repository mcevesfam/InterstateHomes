import type { FastifyInstance } from 'fastify';
import { asc, desc, eq } from 'drizzle-orm';
import {
  COST_CODE_MAP,
  DEFAULT_SYSTEM_SETTINGS,
  INTERNAL_ONLY_COST_CODES,
  canAccess,
  checkSubComplianceForPO,
  type ComplianceDocRecord,
  type ComplianceDocType,
} from '@interstate/shared';
import { demoStore } from '../data/demo-store.js';
import { getDb } from '../db/client.js';
import {
  clarificationItems,
  complianceDocuments,
  costCodes,
  estimateLines,
  estimates,
  homePlanRevisions,
  homes,
  purchaseOrders,
  quoteRounds,
  quotes,
  subCompanies,
  subCostCodes,
  subdivisions,
  systemSettings,
  users,
} from '../db/schema/index.js';
import { isUsingDemoStore } from '../security/auth-plugin.js';
import { isValidUuid } from '../security/audit.js';

function subRequiresUtahLicense(companyType: string, codesServed: string[]): boolean {
  if (companyType === 'supplier') return false;
  if (codesServed.length === 0) return false;
  return codesServed.some((code) => COST_CODE_MAP.get(code)?.requiresUtahLicense === true);
}

function emptySubDashboard(role: string) {
  return {
    role,
    kpis: {
      activeHomes: 0,
      quotesOut: 0,
      countersToReview: 0,
      posAwaitingSign: 0,
      complianceAlerts: 0,
      openClarifications: 0,
    },
    needsAttention: [],
    activeHomes: [],
    pipeline: [],
  };
}

export async function registerDashboardRoutes(app: FastifyInstance) {
  app.get(
    '/api/dashboard/summary',
    {
      schema: {
        tags: ['Dashboard'],
        summary: 'Role-scoped KPIs, Needs Attention feed, Active Homes, and Homes Pipeline',
      },
    },
    async (request, reply) => {
      const role = request.actor.role;
      if (role === 'homeowner') {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      const canSeeInternal = canAccess(role, 'financials:view_internal');

      if (isUsingDemoStore()) {
        if (role === 'subcontractor') {
          const subId = request.actor.subCompanyId;
          if (!subId) return emptySubDashboard(role);

          const myQuotes = demoStore.quotes.filter(
            (q) => q.subCompanyId === subId && !INTERNAL_ONLY_COST_CODES.has(q.costCode)
          );
          const myPos = demoStore.purchaseOrders.filter(
            (p) => p.subCompanyId === subId && !INTERNAL_ONLY_COST_CODES.has(p.costCode)
          );
          const mySub = demoStore.subcontractors.find((s) => s.id === subId);
          const assignedPairs = new Set<string>([
            ...myQuotes.map((q) => `${q.homeId}:${q.costCode}`),
            ...myPos.map((p) => `${p.homeId}:${p.costCode}`),
          ]);
          const myOpenClars = demoStore.clarifications.filter(
            (c) =>
              c.status === 'open' &&
              !INTERNAL_ONLY_COST_CODES.has(c.costCode) &&
              assignedPairs.has(`${c.homeId}:${c.costCode}`)
          );

          const compliance = mySub
            ? checkSubComplianceForPO(
                { status: mySub.status, hasVehiclesOnSite: mySub.hasVehiclesOnSite },
                mySub.complianceDocs,
                {
                  poType: mySub.companyType === 'supplier' ? 'supplier' : 'subcontractor',
                  requiresUtahLicense: subRequiresUtahLicense(
                    mySub.companyType,
                    mySub.costCodesServed
                  ),
                  minGlLimitCents: demoStore.settings.defaultGlMinLimitCents,
                  minAutoLimitCents: demoStore.settings.defaultAutoMinLimitCents,
                  requireMasterAgreement: demoStore.settings.requireMasterAgreement,
                  currentMasterAgreementVersion:
                    demoStore.settings.currentMasterAgreementVersion,
                }
              )
            : { eligible: true, blockingReasons: [] };

          return {
            role,
            kpis: {
              activeHomes: new Set([...myQuotes.map((q) => q.homeId), ...myPos.map((p) => p.homeId)]).size,
              quotesOut: myQuotes.filter((q) => q.status === 'sent').length,
              countersToReview: myQuotes.filter((q) => q.status === 'sub_adjusted').length,
              posAwaitingSign: myPos.filter((p) => p.status === 'pending_sub_signature').length,
              complianceAlerts: compliance.blockingReasons.length,
              openClarifications: myOpenClars.length,
            },
            needsAttention: [
              ...myQuotes
                .filter((q) => q.status === 'sent')
                .map((q) => ({
                  id: q.id,
                  badge: 'QUOTE',
                  severity: 'blue',
                  title: `${q.homeCode} — ${q.costCode} ${q.costCodeName} quote awaiting response`,
                  subtitle: `Deadline ${q.responseDeadline} · $${(q.quotedTotalCents / 100).toLocaleString()}`,
                  href: '/quotes',
                })),
              ...myPos
                .filter((p) => p.status === 'pending_sub_signature')
                .map((p) => ({
                  id: p.id,
                  badge: 'SIGN PO',
                  severity: 'amber',
                  title: `${p.poNumber} ready for subcontractor e-signature`,
                  subtitle: `${p.homeCode} · ${p.scopeSummary}`,
                  href: '/purchase-orders',
                })),
            ],
            activeHomes: [],
            pipeline: [],
          };
        }

        const complianceAlerts: Array<{
          id: string;
          badge: string;
          severity: string;
          title: string;
          subtitle: string;
          href: string;
        }> = [];

        for (const sub of demoStore.subcontractors) {
          const res = checkSubComplianceForPO(
            { status: sub.status, hasVehiclesOnSite: sub.hasVehiclesOnSite },
            sub.complianceDocs,
            {
              poType: sub.companyType === 'supplier' ? 'supplier' : 'subcontractor',
              requiresUtahLicense: subRequiresUtahLicense(sub.companyType, sub.costCodesServed),
              minGlLimitCents: demoStore.settings.defaultGlMinLimitCents,
              minAutoLimitCents: demoStore.settings.defaultAutoMinLimitCents,
              requireMasterAgreement: demoStore.settings.requireMasterAgreement,
              currentMasterAgreementVersion: demoStore.settings.currentMasterAgreementVersion,
            }
          );
          if (!res.eligible) {
            complianceAlerts.push({
              id: `comp-${sub.id}`,
              badge: 'COMPLIANCE',
              severity: 'red',
              title: `${sub.legalName} blocked from new POs`,
              subtitle: res.blockingReasons[0]?.message ?? 'Missing or expired document',
              href: '/compliance',
            });
          }
        }

        const counterAlerts = demoStore.quotes
          .filter(
            (q) =>
              q.status === 'sub_adjusted' &&
              (canSeeInternal || !INTERNAL_ONLY_COST_CODES.has(q.costCode))
          )
          .map((q) => {
            const latest = q.rounds[q.rounds.length - 1];
            return {
              id: `counter-${q.id}`,
              badge: 'COUNTER',
              severity: 'blue',
              title: `${q.homeCode} · ${q.subName} adjusted quote (${q.costCode} ${q.costCodeName})`,
              subtitle: latest?.comment ?? 'Subcontractor counter-offer awaiting estimator review',
              href: '/quotes',
            };
          });

        const poAlerts = demoStore.purchaseOrders
          .filter(
            (p) =>
              p.status === 'pending_approver_signature' &&
              (canSeeInternal || !INTERNAL_ONLY_COST_CODES.has(p.costCode))
          )
          .map((p) => ({
            id: `po-${p.id}`,
            badge: 'SIGN PO',
            severity: 'amber',
            title: `${p.poNumber} signed by ${p.subName} — awaiting approver signature`,
            subtitle: `$${(p.totalCents / 100).toLocaleString()} · ${p.masterAgreementRef ?? 'Supplier PO'}`,
            href: '/purchase-orders',
          }));

        const clarAlerts = demoStore.clarifications
          .filter(
            (c) =>
              c.status === 'open' &&
              (canSeeInternal || !INTERNAL_ONLY_COST_CODES.has(c.costCode))
          )
          .map((c) => ({
            id: `clr-${c.id}`,
            badge: 'CLARIFY',
            severity: 'neutral',
            title: `${c.homeCode} (${c.costCode} ${c.costCodeName}): ${c.title}`,
            subtitle: `Owner: ${c.ownerName} · Due ${c.dueDate}`,
            href: '/clarifications',
          }));

        const stageOrder: Array<{
          key: (typeof demoStore.homes)[number]['stage'];
          label: string;
        }> = [
          { key: 'plan_intake', label: 'Plan Intake' },
          { key: 'estimating', label: 'Estimating' },
          { key: 'quotes_out', label: 'Quotes Out' },
          { key: 'pos_esign', label: 'POs / E-Sign' },
          { key: 'live_budget', label: 'Live Budget' },
        ];

        const pipeline = stageOrder.map((st) => {
          const homesInStage = demoStore.homes.filter((h) => h.stage === st.key);
          const totalEstimateCents = homesInStage.reduce((acc, h) => {
            const est = demoStore.estimates.get(h.id);
            if (!est) return acc;
            const sum = est.lines
              .filter((l) => canSeeInternal || !INTERNAL_ONLY_COST_CODES.has(l.costCode))
              .reduce((s, l) => s + l.extendedCents, 0);
            return acc + sum;
          }, 0);
          return {
            stage: st.key,
            label: st.label,
            count: homesInStage.length,
            totalEstimateCents,
          };
        });

        const activeHomes = demoStore.homes.map((h) => {
          const homePos = demoStore.purchaseOrders.filter((p) => p.homeId === h.id);
          const signedCount = homePos.filter((p) => p.status === 'fully_signed').length;
          return {
            id: h.id,
            homeCode: h.homeCode,
            subdivisionName: h.subdivisionName,
            planName: h.planName,
            stage: h.stage,
            planRevision: h.planRevision,
            posSignedLabel: `${signedCount}/${homePos.length || 0}`,
            soldAmountCents: canSeeInternal ? h.soldAmountCents : null,
          };
        });

        return {
          role,
          kpis: {
            activeHomes: demoStore.homes.length,
            quotesOut: demoStore.quotes.filter((q) => q.status === 'sent').length,
            countersToReview: counterAlerts.length,
            posAwaitingSign: demoStore.purchaseOrders.filter((p) => p.status !== 'fully_signed').length,
            complianceAlerts: complianceAlerts.length,
            openClarifications: clarAlerts.length,
          },
          needsAttention: [...complianceAlerts, ...counterAlerts, ...poAlerts, ...clarAlerts],
          activeHomes,
          pipeline,
        };
      }

      // Postgres mode
      const db = getDb();

      // Subcontractor role NEVER falls through to internal executive dashboard
      if (role === 'subcontractor') {
        if (!isValidUuid(request.actor.subCompanyId)) {
          return emptySubDashboard(role);
        }
        const subId = request.actor.subCompanyId;
        const [
          [mySub],
          myDocs,
          mySubCodes,
          myQuotes,
          myPos,
          clarRows,
          homeRows,
          codeRows,
          [settingsRow],
        ] = await Promise.all([
          db.select().from(subCompanies).where(eq(subCompanies.id, subId)).limit(1),
          db
            .select()
            .from(complianceDocuments)
            .where(eq(complianceDocuments.subCompanyId, subId))
            .orderBy(desc(complianceDocuments.receivedAt)),
          db.select().from(subCostCodes).where(eq(subCostCodes.subCompanyId, subId)),
          db
            .select()
            .from(quotes)
            .where(eq(quotes.subCompanyId, subId))
            .orderBy(desc(quotes.sentAt)),
          db
            .select()
            .from(purchaseOrders)
            .where(eq(purchaseOrders.subCompanyId, subId))
            .orderBy(desc(purchaseOrders.createdAt)),
          db.select().from(clarificationItems),
          db.select({ id: homes.id, homeCode: homes.homeCode }).from(homes),
          db.select({ code: costCodes.code, name: costCodes.name }).from(costCodes),
          db.select().from(systemSettings).where(eq(systemSettings.id, 'default')).limit(1),
        ]);

        const minGlLimitCents =
          settingsRow?.defaultGlMinLimitCents ?? DEFAULT_SYSTEM_SETTINGS.defaultGlMinLimitCents;
        const minAutoLimitCents =
          settingsRow?.defaultAutoMinLimitCents ?? DEFAULT_SYSTEM_SETTINGS.defaultAutoMinLimitCents;
        const requireMasterAgreement =
          settingsRow?.requireMasterAgreement ?? DEFAULT_SYSTEM_SETTINGS.requireMasterAgreement;
        const currentMasterAgreementVersion =
          settingsRow?.currentMasterAgreementVersion ??
          DEFAULT_SYSTEM_SETTINGS.currentMasterAgreementVersion;

        const homeCodeMap = new Map(homeRows.map((h) => [h.id, h.homeCode]));
        const codeNameMap = new Map(codeRows.map((c) => [c.code, c.name]));

        const visibleQuotes = myQuotes.filter((q) => !INTERNAL_ONLY_COST_CODES.has(q.costCode));
        const visiblePos = myPos.filter((p) => !INTERNAL_ONLY_COST_CODES.has(p.costCode));
        const assignedPairs = new Set<string>([
          ...visibleQuotes.map((q) => `${q.homeId}:${q.costCode}`),
          ...visiblePos.map((p) => `${p.homeId}:${p.costCode}`),
        ]);
        const myOpenClars = clarRows.filter(
          (c) =>
            c.status === 'open' &&
            !INTERNAL_ONLY_COST_CODES.has(c.costCode) &&
            assignedPairs.has(`${c.homeId}:${c.costCode}`)
        );

        const mappedDocs: ComplianceDocRecord[] = myDocs.map((doc) => ({
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

        const compliance = mySub
          ? checkSubComplianceForPO(
              {
                status: mySub.status as 'active' | 'on_hold' | 'inactive',
                hasVehiclesOnSite: mySub.hasVehiclesOnSite,
              },
              mappedDocs,
              {
                poType: mySub.companyType === 'supplier' ? 'supplier' : 'subcontractor',
                requiresUtahLicense: subRequiresUtahLicense(
                  mySub.companyType,
                  mySubCodes.map((sc) => sc.costCode)
                ),
                minGlLimitCents,
                minAutoLimitCents,
                requireMasterAgreement,
                currentMasterAgreementVersion,
              }
            )
          : { eligible: true, blockingReasons: [] };

        return {
          role,
          kpis: {
            activeHomes: new Set([
              ...visibleQuotes.map((q) => q.homeId),
              ...visiblePos.map((p) => p.homeId),
            ]).size,
            quotesOut: visibleQuotes.filter((q) => q.status === 'sent').length,
            countersToReview: visibleQuotes.filter((q) => q.status === 'sub_adjusted').length,
            posAwaitingSign: visiblePos.filter((p) => p.status === 'pending_sub_signature').length,
            complianceAlerts: compliance.blockingReasons.length,
            openClarifications: myOpenClars.length,
          },
          needsAttention: [
            ...visibleQuotes
              .filter((q) => q.status === 'sent')
              .map((q) => ({
                id: q.id,
                badge: 'QUOTE',
                severity: 'blue',
                title: `${homeCodeMap.get(q.homeId) ?? q.homeId} — ${q.costCode} ${codeNameMap.get(q.costCode) ?? q.costCode} quote awaiting response`,
                subtitle: `Deadline ${q.responseDeadline} · $${(q.quotedTotalCents / 100).toLocaleString()}`,
                href: '/quotes',
              })),
            ...visiblePos
              .filter((p) => p.status === 'pending_sub_signature')
              .map((p) => ({
                id: p.id,
                badge: 'SIGN PO',
                severity: 'amber',
                title: `${p.poNumber} ready for subcontractor e-signature`,
                subtitle: `${homeCodeMap.get(p.homeId) ?? p.homeId} · ${p.scopeSummary}`,
                href: '/purchase-orders',
              })),
          ],
          activeHomes: [],
          pipeline: [],
        };
      }

      const [
        homeRows,
        subdivisionRows,
        revRows,
        subRows,
        subCodeRows,
        docRows,
        quoteRows,
        roundRows,
        poRows,
        clarRows,
        estRows,
        estLineRows,
        codeRows,
        userRows,
        [settingsRow],
      ] = await Promise.all([
        db.select().from(homes).orderBy(desc(homes.createdAt)),
        db.select().from(subdivisions),
        db.select().from(homePlanRevisions).orderBy(desc(homePlanRevisions.uploadedAt)),
        db.select().from(subCompanies),
        db.select().from(subCostCodes),
        db.select().from(complianceDocuments).orderBy(desc(complianceDocuments.receivedAt)),
        db.select().from(quotes).orderBy(desc(quotes.sentAt)),
        db.select().from(quoteRounds).orderBy(asc(quoteRounds.roundNumber)),
        db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.createdAt)),
        db.select().from(clarificationItems).orderBy(desc(clarificationItems.createdAt)),
        db.select().from(estimates).orderBy(desc(estimates.versionNumber)),
        db.select().from(estimateLines),
        db.select({ code: costCodes.code, name: costCodes.name }).from(costCodes),
        db.select({ id: users.id, fullName: users.fullName }).from(users),
        db.select().from(systemSettings).where(eq(systemSettings.id, 'default')).limit(1),
      ]);

      const minGlLimitCents =
        settingsRow?.defaultGlMinLimitCents ?? DEFAULT_SYSTEM_SETTINGS.defaultGlMinLimitCents;
      const minAutoLimitCents =
        settingsRow?.defaultAutoMinLimitCents ?? DEFAULT_SYSTEM_SETTINGS.defaultAutoMinLimitCents;
      const requireMasterAgreement =
        settingsRow?.requireMasterAgreement ?? DEFAULT_SYSTEM_SETTINGS.requireMasterAgreement;
      const currentMasterAgreementVersion =
        settingsRow?.currentMasterAgreementVersion ??
        DEFAULT_SYSTEM_SETTINGS.currentMasterAgreementVersion;

      const subDivMap = new Map(subdivisionRows.map((s) => [s.code, s.name]));
      const homeCodeMap = new Map(homeRows.map((h) => [h.id, h.homeCode]));
      const subNameMap = new Map(subRows.map((s) => [s.id, s.legalName]));
      const codeNameMap = new Map(codeRows.map((c) => [c.code, c.name]));
      const userNameMap = new Map(userRows.map((u) => [u.id, u.fullName]));

      const codesBySub = new Map<string, string[]>();
      for (const link of subCodeRows) {
        const list = codesBySub.get(link.subCompanyId) ?? [];
        list.push(link.costCode);
        codesBySub.set(link.subCompanyId, list);
      }

      const docsBySub = new Map<string, ComplianceDocRecord[]>();
      for (const doc of docRows) {
        const list = docsBySub.get(doc.subCompanyId) ?? [];
        list.push({
          id: doc.id,
          fileName: doc.fileName,
          docType: doc.docType as ComplianceDocType,
          reviewStatus: doc.reviewStatus as 'pending' | 'approved' | 'rejected',
          expiresAt: doc.expiresAt ?? null,
          limitAmountCents: doc.limitAmountCents ?? null,
          additionalInsured: doc.additionalInsured ?? false,
          licenseClassification: doc.licenseClassification ?? null,
          agreementVersion: doc.agreementVersion ?? null,
        });
        docsBySub.set(doc.subCompanyId, list);
      }

      const complianceAlerts: Array<{
        id: string;
        badge: string;
        severity: string;
        title: string;
        subtitle: string;
        href: string;
      }> = [];

      for (const sub of subRows) {
        const res = checkSubComplianceForPO(
          {
            status: sub.status as 'active' | 'on_hold' | 'inactive',
            hasVehiclesOnSite: sub.hasVehiclesOnSite,
          },
          docsBySub.get(sub.id) ?? [],
          {
            poType: sub.companyType === 'supplier' ? 'supplier' : 'subcontractor',
            requiresUtahLicense: subRequiresUtahLicense(
              sub.companyType,
              codesBySub.get(sub.id) ?? []
            ),
            minGlLimitCents,
            minAutoLimitCents,
            requireMasterAgreement,
            currentMasterAgreementVersion,
          }
        );
        if (!res.eligible) {
          complianceAlerts.push({
            id: `comp-${sub.id}`,
            badge: 'COMPLIANCE',
            severity: 'red',
            title: `${sub.legalName} blocked from new POs`,
            subtitle: res.blockingReasons[0]?.message ?? 'Missing or expired document',
            href: '/compliance',
          });
        }
      }

      const latestRoundByQuote = new Map<string, typeof quoteRounds.$inferSelect>();
      for (const r of roundRows) {
        latestRoundByQuote.set(r.quoteId, r);
      }

      const counterAlerts = quoteRows
        .filter(
          (q) =>
            q.status === 'sub_adjusted' &&
            (canSeeInternal || !INTERNAL_ONLY_COST_CODES.has(q.costCode))
        )
        .map((q) => {
          const latest = latestRoundByQuote.get(q.id);
          return {
            id: `counter-${q.id}`,
            badge: 'COUNTER',
            severity: 'blue',
            title: `${homeCodeMap.get(q.homeId) ?? q.homeId} · ${subNameMap.get(q.subCompanyId) ?? q.subCompanyId} adjusted quote (${q.costCode} ${codeNameMap.get(q.costCode) ?? q.costCode})`,
            subtitle: latest?.comment ?? 'Subcontractor counter-offer awaiting estimator review',
            href: '/quotes',
          };
        });

      const poAlerts = poRows
        .filter(
          (p) =>
            p.status === 'pending_approver_signature' &&
            (canSeeInternal || !INTERNAL_ONLY_COST_CODES.has(p.costCode))
        )
        .map((p) => ({
          id: `po-${p.id}`,
          badge: 'SIGN PO',
          severity: 'amber',
          title: `${p.poNumber} signed by ${subNameMap.get(p.subCompanyId) ?? p.subCompanyId} — awaiting approver signature`,
          subtitle: `$${(p.totalCents / 100).toLocaleString()} · ${p.masterAgreementRef ?? 'Supplier PO'}`,
          href: '/purchase-orders',
        }));

      const clarAlerts = clarRows
        .filter(
          (c) =>
            c.status === 'open' && (canSeeInternal || !INTERNAL_ONLY_COST_CODES.has(c.costCode))
        )
        .map((c) => ({
          id: `clr-${c.id}`,
          badge: 'CLARIFY',
          severity: 'neutral',
          title: `${homeCodeMap.get(c.homeId) ?? c.homeId} (${c.costCode} ${codeNameMap.get(c.costCode) ?? c.costCode}): ${c.title}`,
          subtitle: `Owner: ${c.ownerUserId ? (userNameMap.get(c.ownerUserId) ?? 'Unassigned') : 'Unassigned'} · Due ${c.dueDate ?? 'TBD'}`,
          href: '/clarifications',
        }));

      const latestRevByHome = new Map<string, string>();
      for (const r of revRows) {
        if (!latestRevByHome.has(r.homeId)) {
          latestRevByHome.set(r.homeId, r.revisionLabel);
        }
      }

      const latestEstByHome = new Map<string, string>();
      for (const e of estRows) {
        if (!latestEstByHome.has(e.homeId)) {
          latestEstByHome.set(e.homeId, e.id);
        }
      }

      const linesByEst = new Map<string, Array<typeof estimateLines.$inferSelect>>();
      for (const l of estLineRows) {
        const list = linesByEst.get(l.estimateId) ?? [];
        list.push(l);
        linesByEst.set(l.estimateId, list);
      }

      const stageOrder = [
        { key: 'plan_intake', label: 'Plan Intake' },
        { key: 'estimating', label: 'Estimating' },
        { key: 'quotes_out', label: 'Quotes Out' },
        { key: 'pos_esign', label: 'POs / E-Sign' },
        { key: 'live_budget', label: 'Live Budget' },
      ];

      const pipeline = stageOrder.map((st) => {
        const homesInStage = homeRows.filter((h) => h.stage === st.key);
        const totalEstimateCents = homesInStage.reduce((acc, h) => {
          const estId = latestEstByHome.get(h.id);
          if (!estId) return acc;
          const lines = linesByEst.get(estId) ?? [];
          const sum = lines
            .filter((l) => canSeeInternal || !INTERNAL_ONLY_COST_CODES.has(l.costCode))
            .reduce((s, l) => s + l.extendedCents, 0);
          return acc + sum;
        }, 0);
        return {
          stage: st.key,
          label: st.label,
          count: homesInStage.length,
          totalEstimateCents,
        };
      });

      const activeHomes = homeRows.map((h) => {
        const homePos = poRows.filter((p) => p.homeId === h.id);
        const signedCount = homePos.filter((p) => p.status === 'fully_signed').length;
        return {
          id: h.id,
          homeCode: h.homeCode,
          subdivisionName: subDivMap.get(h.subdivisionCode) ?? h.subdivisionCode,
          planName: h.planName,
          stage: h.stage,
          planRevision: latestRevByHome.get(h.id) ?? 'Rev 1',
          posSignedLabel: `${signedCount}/${homePos.length || 0}`,
          soldAmountCents: canSeeInternal ? h.soldAmountCents : null,
        };
      });

      return {
        role,
        kpis: {
          activeHomes: homeRows.length,
          quotesOut: quoteRows.filter((q) => q.status === 'sent').length,
          countersToReview: counterAlerts.length,
          posAwaitingSign: poRows.filter((p) => p.status !== 'fully_signed').length,
          complianceAlerts: complianceAlerts.length,
          openClarifications: clarAlerts.length,
        },
        needsAttention: [...complianceAlerts, ...counterAlerts, ...poAlerts, ...clarAlerts],
        activeHomes,
        pipeline,
      };
    }
  );
}
