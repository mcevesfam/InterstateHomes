import { and, eq } from 'drizzle-orm';
import {
  COST_CLASSIFICATIONS,
  COST_CODES,
  DEFAULT_SYSTEM_SETTINGS,
} from '@interstate/shared';
import { closeDb, getDb, isDatabaseConfigured } from './client.js';
import {
  clarificationItems,
  clarificationMessages,
  complianceDocuments,
  costClassifications,
  costCodes,
  estimateLines,
  estimates,
  homes,
  purchaseOrders,
  quoteRounds,
  quotes,
  subCompanies,
  subContacts,
  subCostCodes,
  subdivisions,
  systemSettings,
  users,
} from './schema/index.js';
import { encryptSensitive, hashPassword, maskTin } from '../security/crypto.js';

const INITIAL_SUBDIVISIONS = [
  { code: 'CH', name: 'Cottonwood Hollow', city: 'La Verkin', jurisdiction: 'La Verkin City', defaultHoaFeeCents: 65000 },
  { code: 'LK', name: 'Lava Knolls', city: 'Hurricane', jurisdiction: 'Hurricane City', defaultHoaFeeCents: 120000 },
  { code: 'NS', name: 'North Slope at Copper Rock', city: 'Hurricane', jurisdiction: 'Hurricane City', defaultHoaFeeCents: 185000 },
  { code: 'PS', name: "Park Side at Grandpa's Pond", city: 'Hurricane', jurisdiction: 'Hurricane City', defaultHoaFeeCents: 95000 },
  { code: 'ZV', name: 'Zion Vista', city: 'Hurricane', jurisdiction: 'Hurricane City', defaultHoaFeeCents: 110000 },
  { code: 'SH', name: 'Sand Hollow', city: 'Hurricane', jurisdiction: 'Washington County', defaultHoaFeeCents: 140000 },
];

async function seedStagingQaData(db: ReturnType<typeof getDb>, initialAdminPassword: string) {
  // 1. Seed 2 Staging subcontractors (1 fully compliant on 31 Drywall, 1 expired COI on 19 Plumbing)
  let [redCliffs] = await db
    .select()
    .from(subCompanies)
    .where(eq(subCompanies.legalName, 'Red Cliffs Drywall LLC'))
    .limit(1);

  if (!redCliffs) {
    const [inserted] = await db
      .insert(subCompanies)
      .values({
        legalName: 'Red Cliffs Drywall LLC',
        dbaName: 'Red Cliffs Drywall',
        companyType: 'subcontractor',
        mainPhone: '435-555-0142',
        hasVehiclesOnSite: true,
        status: 'active',
        paymentTermsNetDays: 30,
      })
      .returning();
    redCliffs = inserted!;

    await db.insert(subContacts).values({
      subCompanyId: redCliffs.id,
      fullName: 'Tanner Wright',
      roleTitle: 'Owner / Signer',
      email: 'sub.staging@redcliffsdrywall.example',
      mobile: '435-555-0142',
      isSigner: true,
    });

    await db.insert(subCostCodes).values({
      subCompanyId: redCliffs.id,
      costCode: '31',
      subdivisionCode: null,
      isPreferred: true,
    });

    const w9Red = maskTin('87-1234821');
    await db.insert(complianceDocuments).values([
      {
        subCompanyId: redCliffs.id,
        docType: 'coi_gl',
        storageKey: 'staging/red-cliffs/coi-gl.pdf',
        fileName: 'RedCliffs-COI-GL-2027.pdf',
        carrier: 'Travelers',
        limitAmountCents: 200_000_000,
        additionalInsured: true,
        expiresAt: '2027-08-15',
        reviewStatus: 'approved',
      },
      {
        subCompanyId: redCliffs.id,
        docType: 'auto_liability',
        storageKey: 'staging/red-cliffs/auto.pdf',
        fileName: 'RedCliffs-Auto-2027.pdf',
        limitAmountCents: 100_000_000,
        expiresAt: '2027-08-15',
        reviewStatus: 'approved',
      },
      {
        subCompanyId: redCliffs.id,
        docType: 'workers_comp',
        storageKey: 'staging/red-cliffs/wc.pdf',
        fileName: 'RedCliffs-WC-2027.pdf',
        expiresAt: '2027-05-01',
        reviewStatus: 'approved',
      },
      {
        subCompanyId: redCliffs.id,
        docType: 'w9',
        storageKey: 'staging/red-cliffs/w9.pdf',
        fileName: 'RedCliffs-W9.pdf',
        w9TinEncrypted: encryptSensitive('87-1234821'),
        w9TinLast4: w9Red.last4,
        reviewStatus: 'approved',
      },
      {
        subCompanyId: redCliffs.id,
        docType: 'utah_license',
        storageKey: 'staging/red-cliffs/utah-lic.pdf',
        fileName: 'RedCliffs-Utah-S270.pdf',
        licenseClassification: 'S270',
        expiresAt: '2027-11-30',
        reviewStatus: 'approved',
      },
      {
        subCompanyId: redCliffs.id,
        docType: 'master_agreement',
        storageKey: 'staging/red-cliffs/msa-2026-1.pdf',
        fileName: 'RedCliffs-MSA-2026.1.pdf',
        agreementVersion: '2026.1',
        reviewStatus: 'approved',
      },
    ]);
  }

  let [hurricanePlumbing] = await db
    .select()
    .from(subCompanies)
    .where(eq(subCompanies.legalName, 'Hurricane Valley Plumbing LLC'))
    .limit(1);

  if (!hurricanePlumbing) {
    const [inserted] = await db
      .insert(subCompanies)
      .values({
        legalName: 'Hurricane Valley Plumbing LLC',
        dbaName: 'Hurricane Valley Plumbing',
        companyType: 'subcontractor',
        mainPhone: '435-555-0188',
        hasVehiclesOnSite: true,
        status: 'active',
        paymentTermsNetDays: 30,
      })
      .returning();
    hurricanePlumbing = inserted!;

    await db.insert(subContacts).values({
      subCompanyId: hurricanePlumbing.id,
      fullName: 'Brent Hafen',
      roleTitle: 'Owner / Signer',
      email: 'brent@hvplumbing.example',
      mobile: '435-555-0188',
      isSigner: true,
    });

    await db.insert(subCostCodes).values({
      subCompanyId: hurricanePlumbing.id,
      costCode: '19',
      subdivisionCode: null,
      isPreferred: true,
    });

    const w9Plumb = maskTin('87-9923104');
    await db.insert(complianceDocuments).values([
      {
        subCompanyId: hurricanePlumbing.id,
        docType: 'coi_gl',
        storageKey: 'staging/hv-plumbing/coi-gl-expired.pdf',
        fileName: 'HVPlumbing-COI-GL-Expired.pdf',
        carrier: 'Liberty Mutual',
        limitAmountCents: 200_000_000,
        additionalInsured: true,
        expiresAt: '2026-01-10', // Intentionally expired for Staging QA compliance blocking test
        reviewStatus: 'approved',
      },
      {
        subCompanyId: hurricanePlumbing.id,
        docType: 'auto_liability',
        storageKey: 'staging/hv-plumbing/auto.pdf',
        fileName: 'HVPlumbing-Auto-2027.pdf',
        limitAmountCents: 100_000_000,
        expiresAt: '2027-04-01',
        reviewStatus: 'approved',
      },
      {
        subCompanyId: hurricanePlumbing.id,
        docType: 'workers_comp',
        storageKey: 'staging/hv-plumbing/wc.pdf',
        fileName: 'HVPlumbing-WC-2027.pdf',
        expiresAt: '2027-06-01',
        reviewStatus: 'approved',
      },
      {
        subCompanyId: hurricanePlumbing.id,
        docType: 'w9',
        storageKey: 'staging/hv-plumbing/w9.pdf',
        fileName: 'HVPlumbing-W9.pdf',
        w9TinEncrypted: encryptSensitive('87-9923104'),
        w9TinLast4: w9Plumb.last4,
        reviewStatus: 'approved',
      },
      {
        subCompanyId: hurricanePlumbing.id,
        docType: 'utah_license',
        storageKey: 'staging/hv-plumbing/utah-lic.pdf',
        fileName: 'HVPlumbing-Utah-S210.pdf',
        licenseClassification: 'S210',
        expiresAt: '2027-11-30',
        reviewStatus: 'approved',
      },
      {
        subCompanyId: hurricanePlumbing.id,
        docType: 'master_agreement',
        storageKey: 'staging/hv-plumbing/msa-2026-1.pdf',
        fileName: 'HVPlumbing-MSA-2026.1.pdf',
        agreementVersion: '2026.1',
        reviewStatus: 'approved',
      },
    ]);
  }

  // 2. Seed 3 Staging QA role accounts (idempotent)
  const stagingRoleUsers = [
    {
      email: 'estimator.staging@interstatehomes.com',
      fullName: 'Amanda Miller (Staging QA)',
      role: 'estimator_approver',
      subCompanyId: null as string | null,
      approvalLimitCents: 15_000_000 as number | null,
    },
    {
      email: 'pm.staging@interstatehomes.com',
      fullName: 'Derek Bradshaw (Staging QA)',
      role: 'project_manager',
      subCompanyId: null as string | null,
      approvalLimitCents: null as number | null,
    },
    {
      email: 'sub.staging@redcliffsdrywall.example',
      fullName: 'Tanner Wright (Red Cliffs Drywall)',
      role: 'subcontractor',
      subCompanyId: redCliffs.id as string | null,
      approvalLimitCents: null as number | null,
    },
  ];

  for (const qaUser of stagingRoleUsers) {
    const pwdHash = await hashPassword(initialAdminPassword);
    await db
      .insert(users)
      .values({
        email: qaUser.email,
        fullName: qaUser.fullName,
        role: qaUser.role,
        subCompanyId: qaUser.subCompanyId,
        isSubCompanyAdmin: qaUser.role === 'subcontractor',
        passwordHash: pwdHash,
        mfaEnabled: false,
        approvalLimitCents: qaUser.approvalLimitCents,
        status: 'active',
        failedLoginAttempts: 0,
      })
      .onConflictDoNothing({ target: users.email });
  }

  const [pmUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'pm.staging@interstatehomes.com'))
    .limit(1);

  // 3. Seed Staging Home CH 14 + 81-line draft estimate
  let [homeCh14] = await db
    .select()
    .from(homes)
    .where(eq(homes.homeCode, 'CH 14'))
    .limit(1);

  let estId: string | null = null;
  if (!homeCh14) {
    const [insertedHome] = await db
      .insert(homes)
      .values({
        homeCode: 'CH 14',
        subdivisionCode: 'CH',
        lot: '14',
        address: '412 W Cottonwood Hollow Rd, La Verkin, UT 84745',
        planName: 'Zion 2450',
        elevation: 'Modern Desert',
        garageHanding: 'Right',
        finishedSqFt: 2450,
        garageSqFt: 720,
        bedrooms: 4,
        baths: '3.0',
        stories: 1,
        plateHeightFt: '9',
        roofPitch: '5:12',
        exteriorFinishMix: 'Stucco + Stone',
        stage: 'quotes_out',
        soldAmountCents: 68_500_000,
      })
      .returning();
    homeCh14 = insertedHome!;

    const [insertedEst] = await db
      .insert(estimates)
      .values({
        homeId: homeCh14.id,
        versionNumber: 1,
        status: 'draft',
      })
      .returning();
    estId = insertedEst!.id;

    const presets: Record<string, { qty: number; unit: string; unitPriceCents: number; subId?: string }> = {
      '00L': { qty: 1, unit: 'Lot', unitPriceCents: 14_500_000 },
      '03': { qty: 1, unit: 'LS', unitPriceCents: 1_850_000 },
      '19': { qty: 1, unit: 'LS', unitPriceCents: 2_150_000, subId: hurricanePlumbing.id },
      '31': { qty: 8800, unit: 'sq ft', unitPriceCents: 195, subId: redCliffs.id },
      '93': { qty: 1, unit: 'LS', unitPriceCents: 6_800_000 },
    };

    await db.insert(estimateLines).values(
      COST_CODES.map((cc) => {
        const p = presets[cc.code];
        const src = cc.pricingSources[0] ?? 'none';
        const qty = p ? p.qty : cc.isEstimateable ? 1 : 0;
        const unitPrice = p ? p.unitPriceCents : 0;
        return {
          estimateId: estId!,
          costCode: cc.code,
          quantity: String(qty),
          unit: p?.unit ?? 'LS',
          quantitySource: 'manual',
          pricingSource: src,
          selectedSubId: p?.subId ?? null,
          unitPriceCents: unitPrice,
          extendedCents: Math.round(qty * unitPrice),
          isAllowanceOrFixed: src === 'fixed' || src === 'allowance',
          showOnHomeownerPdf: !cc.isInternalOnly,
          notes: '',
        };
      })
    );
  } else {
    const [existingEst] = await db
      .select({ id: estimates.id })
      .from(estimates)
      .where(eq(estimates.homeId, homeCh14.id))
      .limit(1);
    estId = existingEst?.id ?? null;
  }

  // 4. Seed 1 active Quote (31 Drywall)
  if (estId) {
    const [existingQuote] = await db
      .select({ id: quotes.id })
      .from(quotes)
      .where(and(eq(quotes.homeId, homeCh14.id), eq(quotes.costCode, '31')))
      .limit(1);

    if (!existingQuote) {
      const [insertedQuote] = await db
        .insert(quotes)
        .values({
          homeId: homeCh14.id,
          estimateId: estId,
          subCompanyId: redCliffs.id,
          costCode: '31',
          status: 'sent',
          responseDeadline: '2027-01-15',
          quotedTotalCents: 1_716_000,
          snapshotJson: {
            homeCode: 'CH 14',
            costCode: '31',
            costCodeName: 'Drywall',
            quotedTotalCents: 1_716_000,
            proposedQuantity: 8800,
          },
        })
        .returning();

      await db.insert(quoteRounds).values({
        quoteId: insertedQuote!.id,
        roundNumber: 1,
        actorType: 'estimator',
        proposedTotalCents: 1_716_000,
        proposedQuantity: '8800',
        comment: 'Initial Zion 2450 drywall takeoff (8,800 sq ft @ $1.95/sf).',
      });
    }
  }

  // 5. Seed 1 PO awaiting sub signature (CH14-31-01)
  const [existingPo] = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.poNumber, 'CH14-31-01'))
    .limit(1);

  if (!existingPo) {
    await db.insert(purchaseOrders).values({
      poNumber: 'CH14-31-01',
      homeId: homeCh14.id,
      costCode: '31',
      subCompanyId: redCliffs.id,
      poType: 'subcontractor',
      scopeSummary: 'Zion 2450 Rev 1 drywall hang, tape, and level-4 knockdown texture.',
      planRevision: 'Rev 1',
      totalCents: 1_716_000,
      masterAgreementRef: 'MSA v2026.1',
      status: 'pending_sub_signature',
      docusealSubmissionId: 'ds-staging-ch14-31-01',
    });
  }

  // 6. Seed 1 open Clarification on CH 14 (code 31)
  const [existingClar] = await db
    .select({ id: clarificationItems.id })
    .from(clarificationItems)
    .where(and(eq(clarificationItems.homeId, homeCh14.id), eq(clarificationItems.costCode, '31')))
    .limit(1);

  if (!existingClar) {
    const [insertedClar] = await db
      .insert(clarificationItems)
      .values({
        homeId: homeCh14.id,
        costCode: '31',
        category: 'plan_conflict',
        title: 'Confirm 5/8" fire-rated garage lid height at mechanical alcove',
        status: 'open',
        ownerUserId: pmUser?.id ?? null,
        dueDate: '2027-01-15',
        createdBy: pmUser?.id ?? null,
      })
      .returning();

    await db.insert(clarificationMessages).values({
      clarificationId: insertedClar!.id,
      authorUserId: pmUser?.id ?? null,
      body: 'Framing shows 10ft plate in garage mechanical bay; confirm standard 5/8" board coverage prior to stocking.',
    });
  }

  console.log(
    'Seeded Staging QA role accounts (estimator.staging, pm.staging, sub.staging) and sample CH 14 workflow records.'
  );
}

async function seed() {
  if (!isDatabaseConfigured()) {
    console.error('DATABASE_URL must be set to seed the database.');
    process.exit(1);
  }

  const db = getDb();

  for (const cls of COST_CLASSIFICATIONS) {
    await db
      .insert(costClassifications)
      .values({
        code: cls.code,
        name: cls.name,
        sortOrder: cls.sortOrder,
      })
      .onConflictDoUpdate({
        target: costClassifications.code,
        set: { name: cls.name, sortOrder: cls.sortOrder },
      });
  }

  for (const cc of COST_CODES) {
    await db
      .insert(costCodes)
      .values({
        code: cc.code,
        name: cc.name,
        classificationCode: cc.classificationCode,
        sortOrder: cc.sortOrder,
        estimateBuiltFrom: cc.estimateBuiltFrom,
        pricingSourcesJson: cc.pricingSources,
        isInternalOnly: cc.isInternalOnly,
        isEstimateable: cc.isEstimateable,
        requiresUtahLicense: cc.requiresUtahLicense,
        allowedSubLinesJson: cc.allowedSubLines,
        active: true,
      })
      .onConflictDoUpdate({
        target: costCodes.code,
        set: {
          name: cc.name,
          classificationCode: cc.classificationCode,
          sortOrder: cc.sortOrder,
          estimateBuiltFrom: cc.estimateBuiltFrom,
          pricingSourcesJson: cc.pricingSources,
          isInternalOnly: cc.isInternalOnly,
          isEstimateable: cc.isEstimateable,
          requiresUtahLicense: cc.requiresUtahLicense,
          allowedSubLinesJson: cc.allowedSubLines,
        },
      });
  }

  for (const sub of INITIAL_SUBDIVISIONS) {
    await db
      .insert(subdivisions)
      .values(sub)
      .onConflictDoNothing({ target: subdivisions.code });
  }

  await db
    .insert(systemSettings)
    .values({
      id: 'default',
      minPasswordLength: DEFAULT_SYSTEM_SETTINGS.minPasswordLength,
      sessionTimeoutMinutes: DEFAULT_SYSTEM_SETTINGS.sessionTimeoutMinutes,
      inactiveDisableDays: DEFAULT_SYSTEM_SETTINGS.inactiveDisableDays,
      auditRetentionYears: DEFAULT_SYSTEM_SETTINGS.auditRetentionYears,
      breachNoticeHours: DEFAULT_SYSTEM_SETTINGS.breachNoticeHours,
      maxPlanUploadMb: DEFAULT_SYSTEM_SETTINGS.maxPlanUploadMb,
      warehouseRefreshSchedule: DEFAULT_SYSTEM_SETTINGS.warehouseRefreshSchedule,
      coiReminderDaysJson: DEFAULT_SYSTEM_SETTINGS.coiReminderDays,
      requireMasterAgreement: DEFAULT_SYSTEM_SETTINGS.requireMasterAgreement,
      currentMasterAgreementVersion: DEFAULT_SYSTEM_SETTINGS.currentMasterAgreementVersion,
      defaultGlMinLimitCents: DEFAULT_SYSTEM_SETTINGS.defaultGlMinLimitCents,
      defaultAutoMinLimitCents: DEFAULT_SYSTEM_SETTINGS.defaultAutoMinLimitCents,
      poNumberFormat: DEFAULT_SYSTEM_SETTINGS.poNumberFormat,
    })
    .onConflictDoNothing({ target: systemSettings.id });

  const initialAdminEmail = (
    process.env.INITIAL_ADMIN_EMAIL ?? 'chase@interstatehomes.com'
  )
    .trim()
    .toLowerCase();
  const initialAdminPassword =
    process.env.INITIAL_ADMIN_PASSWORD ?? 'ChangeMe-Interstate2026!';

  const initialAdmins = [
    { email: initialAdminEmail, fullName: 'Chase Stratton' },
    { email: 'michael@mcdesignco.com', fullName: 'Michael' },
  ];

  for (const admin of initialAdmins) {
    const passwordHash = await hashPassword(initialAdminPassword);
    await db
      .insert(users)
      .values({
        email: admin.email,
        fullName: admin.fullName,
        role: 'admin',
        subCompanyId: null,
        isSubCompanyAdmin: false,
        passwordHash,
        mfaEnabled: false,
        status: 'active',
        failedLoginAttempts: 0,
      })
      .onConflictDoNothing({ target: users.email });
  }

  console.log(
    `Seeded ${COST_CLASSIFICATIONS.length} classifications, ${COST_CODES.length} cost codes, ${INITIAL_SUBDIVISIONS.length} subdivisions, default system settings, and initial admins (${initialAdmins.map((a) => a.email).join(', ')}).`
  );

  // Opt-in Staging QA role accounts & sample workflow records (NEVER runs unless explicitly set)
  if (process.env.SEED_STAGING_ROLES === 'true') {
    await seedStagingQaData(db, initialAdminPassword);
  }

  await closeDb();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
