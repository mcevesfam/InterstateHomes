import {
  COST_CODES,
  DEFAULT_SYSTEM_SETTINGS,
  type ComplianceDocRecord,
  type DiagnosticSnapshot,
  type FeedbackCategory,
  type FeedbackFixPlanDTO,
  type FeedbackMessageDTO,
  type FeedbackSeverity,
  type FeedbackStatus,
  type GithubDispatchStatus,
  type PageContext,
  type SystemSettingsConfig,
  type UserRole,
} from '@interstate/shared';

export interface DemoUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  subCompanyId: string | null;
  status: 'active' | 'disabled';
  approvalLimitCents: number | null;
  lastLoginAt: string;
}

export interface DemoHome {
  id: string;
  homeCode: string;
  subdivisionCode: string;
  subdivisionName: string;
  lot: string;
  address: string;
  planName: string;
  elevation: string;
  garageHanding: string;
  finishedSqFt: number;
  garageSqFt: number;
  bedrooms: number;
  baths: number;
  stories: number;
  roofPitch: string;
  exteriorFinishMix: string;
  stage: 'plan_intake' | 'estimating' | 'quotes_out' | 'pos_esign' | 'live_budget';
  soldAmountCents: number | null;
  planRevision: string;
  createdAt: string;
}

export interface DemoSubcontractor {
  id: string;
  legalName: string;
  dbaName: string | null;
  companyType: 'subcontractor' | 'supplier' | 'both';
  mainPhone: string;
  primaryContactName: string;
  primaryContactEmail: string;
  hasVehiclesOnSite: boolean;
  status: 'active' | 'on_hold' | 'inactive';
  costCodesServed: string[];
  subdivisionsServed: string[];
  preferredForCodes: string[];
  paymentTermsNetDays: number;
  w9TinMasked: string;
  complianceDocs: ComplianceDocRecord[];
  lastPricingUpdatedAt: string;
}

export interface DemoPriceSheet {
  id: string;
  subCompanyId: string;
  subName: string;
  costCode: string;
  costCodeName: string;
  subdivisionScope: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  inclusionsExclusions: string;
  items: Array<{
    id: string;
    subLineName: string;
    unit: string;
    unitPriceCents: number;
  }>;
}

export interface DemoEstimateLine {
  costCode: string;
  costCodeName: string;
  classificationCode: string;
  classificationName: string;
  quantity: number;
  unit: string;
  quantitySource: 'plan_library' | 'manual' | 'ai_takeoff';
  pricingSource: 'sub' | 'supplier' | 'fixed' | 'allowance' | 'none';
  selectedSubId: string | null;
  selectedSubName: string | null;
  unitPriceCents: number;
  extendedCents: number;
  isAllowanceOrFixed: boolean;
  showOnHomeownerPdf: boolean;
  notes: string;
  competingSubQuotes: Array<{ subId: string; subName: string; totalCents: number; isPreferred: boolean }>;
}

export interface DemoEstimate {
  id: string;
  homeId: string;
  versionNumber: number;
  status: 'draft' | 'submitted' | 'approved';
  lines: DemoEstimateLine[];
}

export interface DemoQuote {
  id: string;
  homeId: string;
  homeCode: string;
  subCompanyId: string;
  subName: string;
  costCode: string;
  costCodeName: string;
  status: 'sent' | 'sub_adjusted' | 'accepted' | 'rejected';
  responseDeadline: string;
  quotedTotalCents: number;
  rounds: Array<{
    roundNumber: number;
    actorType: 'estimator' | 'subcontractor';
    proposedTotalCents: number;
    proposedQuantity?: number;
    comment: string;
    createdAt: string;
  }>;
}

export interface DemoPurchaseOrder {
  id: string;
  poNumber: string;
  homeId: string;
  homeCode: string;
  costCode: string;
  costCodeName: string;
  subCompanyId: string;
  subName: string;
  poType: 'subcontractor' | 'supplier';
  scopeSummary: string;
  planRevision: string;
  totalCents: number;
  masterAgreementRef: string | null;
  status: 'pending_sub_signature' | 'pending_approver_signature' | 'fully_signed';
  docusealSubmissionId: string;
  subSignedAt: string | null;
  approverSignedAt: string | null;
}

export interface DemoClarification {
  id: string;
  homeId: string;
  homeCode: string;
  costCode: string;
  costCodeName: string;
  category: 'question' | 'scope_gap' | 'plan_conflict' | 'price_dispute';
  title: string;
  status: 'open' | 'answered' | 'closed';
  ownerName: string;
  dueDate: string;
  messages: Array<{ author: string; body: string; createdAt: string }>;
}

export interface DemoAuditLog {
  id: string;
  actorUserId: string | null;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  homeId: string | null;
  ipAddress: string;
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  createdAt: string;
}

export interface DemoFeedbackItem {
  id: string;
  ticketKey: string;
  category: FeedbackCategory;
  severity: FeedbackSeverity;
  status: FeedbackStatus;
  title: string;
  description: string;
  reporterUserId: string | null;
  reporterEmail: string;
  reporterName: string;
  reporterRole: string;
  subCompanyId: string | null;
  pagePath: string;
  pageTitle: string | null;
  pageContext: PageContext;
  diagnosticSnapshot: DiagnosticSnapshot;
  screenshotStorageKey: string | null;
  resolutionNote: string | null;
  adminNotes: string | null;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  githubDispatchStatus: GithubDispatchStatus;
  approvedByUserId: string | null;
  approvedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const SUBDIVISION_NAMES: Record<string, string> = {
  CH: 'Cottonwood Hollow',
  LK: 'Lava Knolls',
  NS: 'North Slope at Copper Rock',
  PS: "Park Side at Grandpa's Pond",
  ZV: 'Zion Vista',
  SH: 'Sand Hollow',
};

function buildInitialEstimateLinesForHome(home: DemoHome): DemoEstimateLine[] {
  const sampleAmounts: Record<
    string,
    { qty: number; unit: string; src: DemoEstimateLine['pricingSource']; unitPrice: number; subId?: string; subName?: string }
  > = {
    '00L': { qty: 1, unit: 'Lot', src: 'fixed', unitPrice: 14_500_000 },
    '01': { qty: 1, unit: 'LS', src: 'fixed', unitPrice: 450_000 },
    '02': { qty: 1, unit: 'LS', src: 'fixed', unitPrice: 320_000 },
    '03': { qty: 1, unit: 'LS', src: 'fixed', unitPrice: 1_850_000 },
    '04': { qty: 1, unit: 'LS', src: 'fixed', unitPrice: 240_000 },
    '08': { qty: 1, unit: 'LS', src: 'fixed', unitPrice: 180_000 },
    '12': { qty: 1, unit: 'LS', src: 'sub', unitPrice: 1_450_000, subId: 'sub-dixie-excavation', subName: 'Dixie Excavation & Grading' },
    '18': { qty: 112, unit: 'CY', src: 'supplier', unitPrice: 16_800, subId: 'sub-interstate-rock', subName: 'Interstate Rock Products' },
    '19': { qty: 1, unit: 'LS', src: 'sub', unitPrice: 2_150_000, subId: 'sub-hurricane-plumbing', subName: 'Hurricane Valley Plumbing' },
    '20': { qty: home.finishedSqFt, unit: 'sq ft', src: 'sub', unitPrice: 780, subId: 'sub-zion-electric', subName: 'Zion Ridge Electric' },
    '21': { qty: 1, unit: 'LS', src: 'sub', unitPrice: 1_920_000, subId: 'sub-desert-air', subName: 'Desert Air HVAC' },
    '22': { qty: home.finishedSqFt + home.garageSqFt, unit: 'sq ft', src: 'sub', unitPrice: 1_050, subId: 'sub-red-rock-framing', subName: 'Red Rock Framing LLC' },
    '23': { qty: 1, unit: 'Pkg', src: 'supplier', unitPrice: 4_850_000, subId: 'sub-sunrock-lumber', subName: 'SunRock Lumber Supply' },
    '31': { qty: 8800, unit: 'sq ft', src: 'sub', unitPrice: 195, subId: 'sub-red-cliffs', subName: 'Red Cliffs Drywall LLC' },
    '40': { qty: 1, unit: 'Allow', src: 'allowance', unitPrice: 420_000 },
    '41': { qty: 1, unit: 'Allow', src: 'allowance', unitPrice: 680_000 },
    '50': { qty: 34, unit: 'sq', src: 'sub', unitPrice: 48_500, subId: 'sub-sandstone-roof', subName: 'Sandstone Roofing' },
    '51': { qty: 360, unit: 'sq yd', src: 'sub', unitPrice: 5_200, subId: 'sub-canyon-stucco', subName: 'Canyon Stucco & Stone' },
    '59': { qty: 1850, unit: 'sq ft', src: 'sub', unitPrice: 925, subId: 'sub-interstate-concrete', subName: 'Southern Utah Flatwork' },
    '90': { qty: 1, unit: 'LS', src: 'fixed', unitPrice: 1_200_000 },
    '91': { qty: 1, unit: 'LS', src: 'fixed', unitPrice: 850_000 },
    '92': { qty: 1, unit: 'LS', src: 'fixed', unitPrice: 950_000 },
    '93': { qty: 1, unit: 'LS', src: 'fixed', unitPrice: 6_800_000 },
    '99': { qty: 1, unit: 'LS', src: 'fixed', unitPrice: 350_000 },
  };

  return COST_CODES.map((cc) => {
    const preset = sampleAmounts[cc.code];
    const defaultSource = cc.pricingSources[0] ?? 'none';
    const pricingSource = preset?.src ?? defaultSource;
    const quantity = preset?.qty ?? (cc.isEstimateable ? 1 : 0);
    const unit = preset?.unit ?? 'LS';
    const unitPriceCents = preset?.unitPrice ?? 0;
    const extendedCents = Math.round(quantity * unitPriceCents);

    const competingSubQuotes =
      cc.code === '31'
        ? [
            { subId: 'sub-red-cliffs', subName: 'Red Cliffs Drywall LLC', totalCents: 1_716_000, isPreferred: true },
            { subId: 'sub-virgin-drywall', subName: 'Virgin River Drywall', totalCents: 1_795_000, isPreferred: false },
          ]
        : preset?.subId && preset?.subName
          ? [{ subId: preset.subId, subName: preset.subName, totalCents: extendedCents, isPreferred: true }]
          : [];

    return {
      costCode: cc.code,
      costCodeName: cc.name,
      classificationCode: cc.classificationCode,
      classificationName: cc.classificationName,
      quantity,
      unit,
      quantitySource: cc.code === '00' ? 'manual' : 'plan_library',
      pricingSource,
      selectedSubId: preset?.subId ?? null,
      selectedSubName: preset?.subName ?? null,
      unitPriceCents,
      extendedCents,
      isAllowanceOrFixed: pricingSource === 'fixed' || pricingSource === 'allowance',
      showOnHomeownerPdf: !cc.isInternalOnly && extendedCents > 0,
      notes: '',
      competingSubQuotes,
    };
  });
}

const initialHomes: DemoHome[] = [
  {
    id: 'home-ch-14',
    homeCode: 'CH 14',
    subdivisionCode: 'CH',
    subdivisionName: SUBDIVISION_NAMES.CH,
    lot: '14',
    address: '412 W Cottonwood Hollow Rd, La Verkin, UT 84745',
    planName: 'Zion 2450',
    elevation: 'Modern Desert',
    garageHanding: 'Right',
    finishedSqFt: 2450,
    garageSqFt: 720,
    bedrooms: 4,
    baths: 3,
    stories: 1,
    roofPitch: '5:12',
    exteriorFinishMix: 'Stucco + Stone',
    stage: 'pos_esign',
    soldAmountCents: 68_500_000,
    planRevision: 'Rev 2',
    createdAt: '2026-11-10T15:30:00Z',
  },
  {
    id: 'home-lk-22',
    homeCode: 'LK 22',
    subdivisionCode: 'LK',
    subdivisionName: SUBDIVISION_NAMES.LK,
    lot: '22',
    address: '1184 S Lava Knolls Dr, Hurricane, UT 84737',
    planName: 'Coral 2120',
    elevation: 'Prairie',
    garageHanding: 'Left',
    finishedSqFt: 2120,
    garageSqFt: 640,
    bedrooms: 3,
    baths: 2.5,
    stories: 1,
    roofPitch: '6:12',
    exteriorFinishMix: 'Stucco + Hardie Siding',
    stage: 'quotes_out',
    soldAmountCents: 59_900_000,
    planRevision: 'Rev 1',
    createdAt: '2026-11-14T18:10:00Z',
  },
  {
    id: 'home-ns-08',
    homeCode: 'NS 08',
    subdivisionCode: 'NS',
    subdivisionName: SUBDIVISION_NAMES.NS,
    lot: '08',
    address: '842 W Copper Ridge Pkwy, Hurricane, UT 84737',
    planName: 'Copper View 3180 + Casita',
    elevation: 'Contemporary',
    garageHanding: 'Right',
    finishedSqFt: 3180,
    garageSqFt: 940,
    bedrooms: 5,
    baths: 4.5,
    stories: 2,
    roofPitch: '4:12',
    exteriorFinishMix: 'Stucco + Architectural Stone',
    stage: 'estimating',
    soldAmountCents: 92_400_000,
    planRevision: 'Rev 1',
    createdAt: '2026-11-18T11:00:00Z',
  },
  {
    id: 'home-ps-11',
    homeCode: 'PS 11',
    subdivisionCode: 'PS',
    subdivisionName: SUBDIVISION_NAMES.PS,
    lot: '11',
    address: '219 N Pond View Ln, Hurricane, UT 84737',
    planName: 'Willow 1890',
    elevation: 'Craftsman',
    garageHanding: 'Left',
    finishedSqFt: 1890,
    garageSqFt: 520,
    bedrooms: 3,
    baths: 2,
    stories: 1,
    roofPitch: '6:12',
    exteriorFinishMix: 'Stucco + Brick Accent',
    stage: 'live_budget',
    soldAmountCents: 54_200_000,
    planRevision: 'Rev 3',
    createdAt: '2026-11-02T09:15:00Z',
  },
  {
    id: 'home-ch-19',
    homeCode: 'CH 19',
    subdivisionCode: 'CH',
    subdivisionName: SUBDIVISION_NAMES.CH,
    lot: '19',
    address: '458 W Cottonwood Hollow Rd, La Verkin, UT 84745',
    planName: 'Zion 2450',
    elevation: 'Modern Desert',
    garageHanding: 'Left',
    finishedSqFt: 2450,
    garageSqFt: 720,
    bedrooms: 4,
    baths: 3,
    stories: 1,
    roofPitch: '5:12',
    exteriorFinishMix: 'Stucco + Stone',
    stage: 'plan_intake',
    soldAmountCents: null,
    planRevision: 'Rev 1',
    createdAt: '2026-11-23T16:40:00Z',
  },
];

const initialSubcontractors: DemoSubcontractor[] = [
  {
    id: 'sub-red-cliffs',
    legalName: 'Red Cliffs Drywall LLC',
    dbaName: 'Red Cliffs Drywall',
    companyType: 'subcontractor',
    mainPhone: '435-555-0142',
    primaryContactName: 'Tanner Wright',
    primaryContactEmail: 'tanner@redcliffsdrywall.example',
    hasVehiclesOnSite: true,
    status: 'active',
    costCodesServed: ['31'],
    subdivisionsServed: ['ALL'],
    preferredForCodes: ['31'],
    paymentTermsNetDays: 30,
    w9TinMasked: '***-**-4821',
    lastPricingUpdatedAt: '2026-11-01',
    complianceDocs: [
      { docType: 'coi_gl', reviewStatus: 'approved', expiresAt: '2027-08-15', limitAmountCents: 200_000_000, additionalInsured: true },
      { docType: 'auto_liability', reviewStatus: 'approved', expiresAt: '2027-08-15', limitAmountCents: 100_000_000 },
      { docType: 'workers_comp', reviewStatus: 'approved', expiresAt: '2027-05-01' },
      { docType: 'w9', reviewStatus: 'approved' },
      { docType: 'utah_license', reviewStatus: 'approved', expiresAt: '2027-11-30', licenseClassification: 'S270' },
      { docType: 'master_agreement', reviewStatus: 'approved', agreementVersion: '2026.1' },
    ],
  },
  {
    id: 'sub-interstate-rock',
    legalName: 'Interstate Rock Products, Inc.',
    dbaName: 'Interstate Rock Ready-Mix',
    companyType: 'supplier',
    mainPhone: '435-635-2900',
    primaryContactName: 'Dispatch Desk',
    primaryContactEmail: 'dispatch@interstaterock.example',
    hasVehiclesOnSite: false,
    status: 'active',
    costCodesServed: ['18', '59'],
    subdivisionsServed: ['ALL'],
    preferredForCodes: ['18'],
    paymentTermsNetDays: 30,
    w9TinMasked: '***-**-9910',
    lastPricingUpdatedAt: '2026-11-12',
    complianceDocs: [{ docType: 'w9', reviewStatus: 'approved' }],
  },
  {
    id: 'sub-hurricane-plumbing',
    legalName: 'Hurricane Valley Plumbing & Mechanical LLC',
    dbaName: null,
    companyType: 'subcontractor',
    mainPhone: '435-555-0188',
    primaryContactName: 'Brent Hafen',
    primaryContactEmail: 'brent@hvplumbing.example',
    hasVehiclesOnSite: true,
    status: 'active',
    costCodesServed: ['19'],
    subdivisionsServed: ['CH', 'LK', 'PS'],
    preferredForCodes: ['19'],
    paymentTermsNetDays: 30,
    w9TinMasked: '***-**-3104',
    lastPricingUpdatedAt: '2026-10-15',
    complianceDocs: [
      // Intentionally expired COI to demonstrate Section 8.2 / Acceptance Scenario 5 PO blocking!
      { docType: 'coi_gl', reviewStatus: 'approved', expiresAt: '2026-11-10', limitAmountCents: 200_000_000, additionalInsured: true },
      { docType: 'auto_liability', reviewStatus: 'approved', expiresAt: '2027-04-01', limitAmountCents: 100_000_000 },
      { docType: 'workers_comp', reviewStatus: 'approved', expiresAt: '2027-06-01' },
      { docType: 'w9', reviewStatus: 'approved' },
      { docType: 'utah_license', reviewStatus: 'approved', expiresAt: '2027-11-30', licenseClassification: 'S210' },
      { docType: 'master_agreement', reviewStatus: 'approved', agreementVersion: '2026.1' },
    ],
  },
  {
    id: 'sub-zion-electric',
    legalName: 'Zion Ridge Electric Inc.',
    dbaName: null,
    companyType: 'subcontractor',
    mainPhone: '435-555-0199',
    primaryContactName: 'Colby Snow',
    primaryContactEmail: 'colby@zionridgeelectric.example',
    hasVehiclesOnSite: true,
    status: 'active',
    costCodesServed: ['20'],
    subdivisionsServed: ['ALL'],
    preferredForCodes: ['20'],
    paymentTermsNetDays: 30,
    w9TinMasked: '***-**-7723',
    lastPricingUpdatedAt: '2026-11-05',
    complianceDocs: [
      { docType: 'coi_gl', reviewStatus: 'approved', expiresAt: '2026-12-12', limitAmountCents: 200_000_000, additionalInsured: true },
      { docType: 'auto_liability', reviewStatus: 'approved', expiresAt: '2027-03-01', limitAmountCents: 100_000_000 },
      { docType: 'workers_comp', reviewStatus: 'approved', expiresAt: '2027-07-01' },
      { docType: 'w9', reviewStatus: 'approved' },
      { docType: 'utah_license', reviewStatus: 'approved', expiresAt: '2027-11-30', licenseClassification: 'S200' },
      { docType: 'master_agreement', reviewStatus: 'approved', agreementVersion: '2026.1' },
    ],
  },
  {
    id: 'sub-red-rock-framing',
    legalName: 'Red Rock Framing LLC',
    dbaName: null,
    companyType: 'subcontractor',
    mainPhone: '435-555-0164',
    primaryContactName: 'Marco Chavez',
    primaryContactEmail: 'marco@redrockframing.example',
    hasVehiclesOnSite: true,
    status: 'active',
    costCodesServed: ['22'],
    subdivisionsServed: ['ALL'],
    preferredForCodes: ['22'],
    paymentTermsNetDays: 15,
    w9TinMasked: '***-**-5519',
    lastPricingUpdatedAt: '2026-11-09',
    complianceDocs: [
      { docType: 'coi_gl', reviewStatus: 'approved', expiresAt: '2027-09-01', limitAmountCents: 200_000_000, additionalInsured: true },
      { docType: 'auto_liability', reviewStatus: 'approved', expiresAt: '2027-09-01', limitAmountCents: 100_000_000 },
      { docType: 'workers_comp', reviewStatus: 'approved', expiresAt: '2027-09-01' },
      { docType: 'w9', reviewStatus: 'approved' },
      { docType: 'utah_license', reviewStatus: 'approved', expiresAt: '2027-11-30', licenseClassification: 'B100' },
      { docType: 'master_agreement', reviewStatus: 'approved', agreementVersion: '2026.1' },
    ],
  },
];

export interface DemoStore {
  settings: SystemSettingsConfig;
  users: DemoUser[];
  homes: DemoHome[];
  subcontractors: DemoSubcontractor[];
  priceSheets: DemoPriceSheet[];
  estimates: Map<string, DemoEstimate>;
  quotes: DemoQuote[];
  purchaseOrders: DemoPurchaseOrder[];
  fixedBudgetEntries: Array<{ homeId: string; costCode: string; amountCents: number; note: string }>;
  jobCostBudgets: Array<{
    homeId: string;
    homeCode: string;
    costCode: string;
    costCodeName: string;
    budgetCents: number;
    source: string;
    loadedAt: string;
    estimateVersion: number;
  }>;
  clarifications: DemoClarification[];
  auditLogs: DemoAuditLog[];
  feedbackItems: DemoFeedbackItem[];
  feedbackMessages: FeedbackMessageDTO[];
  feedbackFixPlans: FeedbackFixPlanDTO[];
  feedbackScreenshots: Map<string, { contentType: string; buffer: Buffer }>;
  nextFeedbackSeq: number;
  helper: {
    getSubdivisionName: (code: string) => string;
  };
}

export const demoStore: DemoStore = {
  settings: { ...DEFAULT_SYSTEM_SETTINGS },
  users: [
    {
      id: 'usr-chase',
      email: 'chase@interstatehomes.com',
      fullName: 'Chase Stratton',
      role: 'admin' as UserRole,
      subCompanyId: null,
      status: 'active' as const,
      approvalLimitCents: null,
      lastLoginAt: '2026-11-24T11:45:00Z',
    },
    {
      id: 'usr-amanda',
      email: 'amanda@interstatehomes.com',
      fullName: 'Amanda Miller',
      role: 'estimator_approver' as UserRole,
      subCompanyId: null,
      status: 'active' as const,
      approvalLimitCents: 15_000_000,
      lastLoginAt: '2026-11-24T12:10:00Z',
    },
    {
      id: 'usr-super',
      email: 'super@interstatehomes.com',
      fullName: 'Derek Bradshaw',
      role: 'project_manager' as UserRole,
      subCompanyId: null,
      status: 'active' as const,
      approvalLimitCents: null,
      lastLoginAt: '2026-11-24T08:30:00Z',
    },
    {
      id: 'usr-tanner',
      email: 'tanner@redcliffsdrywall.example',
      fullName: 'Tanner Wright (Red Cliffs Drywall)',
      role: 'subcontractor' as UserRole,
      subCompanyId: 'sub-red-cliffs',
      status: 'active' as const,
      approvalLimitCents: null,
      lastLoginAt: '2026-11-23T17:20:00Z',
    },
  ],
  homes: initialHomes,
  subcontractors: initialSubcontractors,
  priceSheets: [
    {
      id: 'ps-red-cliffs-31',
      subCompanyId: 'sub-red-cliffs',
      subName: 'Red Cliffs Drywall LLC',
      costCode: '31',
      costCodeName: 'Drywall',
      subdivisionScope: 'ALL',
      effectiveFrom: '2026-11-01',
      effectiveTo: null,
      inclusionsExclusions: 'Includes 5/8" fire-rated garage lid, level 4 knockdown texture. Excludes scaffolding over 14 ft.',
      items: [
        { id: 'psi-1', subLineName: 'Hang and finish, standard board', unit: 'sq ft', unitPriceCents: 195 },
        { id: 'psi-2', subLineName: 'Moisture resistant board (baths)', unit: 'sq ft', unitPriceCents: 220 },
        { id: 'psi-3', subLineName: 'Garage 5/8" fire-rated lid', unit: 'sq ft', unitPriceCents: 210 },
      ],
    },
    {
      id: 'ps-interstate-rock-18',
      subCompanyId: 'sub-interstate-rock',
      subName: 'Interstate Rock Products, Inc.',
      costCode: '18',
      costCodeName: 'Concrete - Foundation',
      subdivisionScope: 'ALL',
      effectiveFrom: '2026-11-12',
      effectiveTo: null,
      inclusionsExclusions: 'Ready-mix 3000/4000 PSI delivered within Hurricane Valley. Winter hot-water surcharge Nov-Feb.',
      items: [
        { id: 'psi-4', subLineName: 'Concrete per CY (4000 PSI footings/walls)', unit: 'CY', unitPriceCents: 16_800 },
        { id: 'psi-5', subLineName: 'Concrete per CY (3500 PSI flatwork/slab)', unit: 'CY', unitPriceCents: 15_900 },
      ],
    },
    {
      id: 'ps-zion-electric-20',
      subCompanyId: 'sub-zion-electric',
      subName: 'Zion Ridge Electric Inc.',
      costCode: '20',
      costCodeName: 'Electrical',
      subdivisionScope: 'ALL',
      effectiveFrom: '2026-11-05',
      effectiveTo: null,
      inclusionsExclusions: '200A panel, standard recessed cans, 1 EV rough-in. Fixture hang billed per count.',
      items: [
        { id: 'psi-6', subLineName: 'Base per sq ft', unit: 'sq ft', unitPriceCents: 780 },
        { id: 'psi-7', subLineName: 'EV outlet (50A NEMA 14-50)', unit: 'each', unitPriceCents: 65_000 },
      ],
    },
  ],
  estimates: new Map<string, DemoEstimate>(
    initialHomes.map((h, idx) => [
      h.id,
      {
        id: `est-${h.id}`,
        homeId: h.id,
        versionNumber: idx === 3 ? 2 : 1,
        status: h.stage === 'estimating' ? 'draft' : 'approved',
        lines: buildInitialEstimateLinesForHome(h),
      },
    ])
  ),
  quotes: [
    {
      id: 'q-ch14-31',
      homeId: 'home-ch-14',
      homeCode: 'CH 14',
      subCompanyId: 'sub-red-cliffs',
      subName: 'Red Cliffs Drywall LLC',
      costCode: '31',
      costCodeName: 'Drywall',
      status: 'sub_adjusted',
      responseDeadline: '2026-11-27',
      quotedTotalCents: 1_716_000,
      rounds: [
        {
          roundNumber: 1,
          actorType: 'estimator',
          proposedTotalCents: 1_716_000,
          proposedQuantity: 8800,
          comment: 'Initial quote from Zion 2450 Rev 2 plan takeoff (8,800 sq ft @ $1.95).',
          createdAt: '2026-11-20T14:00:00Z',
        },
        {
          roundNumber: 2,
          actorType: 'subcontractor',
          proposedTotalCents: 1_814_000,
          proposedQuantity: 9200,
          comment: 'Great room coffered ceiling adds ~400 sq ft board + scaffolding.',
          createdAt: '2026-11-23T09:15:00Z',
        },
      ],
    },
    {
      id: 'q-lk22-20',
      homeId: 'home-lk-22',
      homeCode: 'LK 22',
      subCompanyId: 'sub-zion-electric',
      subName: 'Zion Ridge Electric Inc.',
      costCode: '20',
      costCodeName: 'Electrical',
      status: 'sent',
      responseDeadline: '2026-11-28',
      quotedTotalCents: 1_653_600,
      rounds: [
        {
          roundNumber: 1,
          actorType: 'estimator',
          proposedTotalCents: 1_653_600,
          proposedQuantity: 2120,
          comment: 'Coral 2120 Rev 1 electrical scope + 200A service.',
          createdAt: '2026-11-22T10:30:00Z',
        },
      ],
    },
  ],
  purchaseOrders: [
    {
      id: 'po-ch14-18-01',
      poNumber: 'CH14-18-01',
      homeId: 'home-ch-14',
      homeCode: 'CH 14',
      costCode: '18',
      costCodeName: 'Concrete - Foundation',
      subCompanyId: 'sub-interstate-rock',
      subName: 'Interstate Rock Products, Inc.',
      poType: 'supplier',
      scopeSummary: '112 CY 4000 PSI foundation ready-mix per Rev 2.',
      planRevision: 'Rev 2',
      totalCents: 1_881_600,
      masterAgreementRef: null,
      status: 'fully_signed',
      docusealSubmissionId: 'ds-ch14-18-01',
      subSignedAt: '2026-11-18T15:00:00Z',
      approverSignedAt: '2026-11-18T16:10:00Z',
    },
    {
      id: 'po-ch14-22-01',
      poNumber: 'CH14-22-01',
      homeId: 'home-ch-14',
      homeCode: 'CH 14',
      costCode: '22',
      costCodeName: 'Framing - Labor',
      subCompanyId: 'sub-red-rock-framing',
      subName: 'Red Rock Framing LLC',
      poType: 'subcontractor',
      scopeSummary: 'Zion 2450 Rev 2 framing labor (3,170 total sq ft).',
      planRevision: 'Rev 2',
      totalCents: 3_328_500,
      masterAgreementRef: 'MSA v2026.1',
      status: 'pending_approver_signature',
      docusealSubmissionId: 'ds-ch14-22-01',
      subSignedAt: '2026-11-23T17:45:00Z',
      approverSignedAt: null,
    },
    {
      id: 'po-ch14-20-01',
      poNumber: 'CH14-20-01',
      homeId: 'home-ch-14',
      homeCode: 'CH 14',
      costCode: '20',
      costCodeName: 'Electrical',
      subCompanyId: 'sub-zion-electric',
      subName: 'Zion Ridge Electric Inc.',
      poType: 'subcontractor',
      scopeSummary: 'Full rough-in & trim electrical package per Rev 2.',
      planRevision: 'Rev 2',
      totalCents: 1_911_000,
      masterAgreementRef: 'MSA v2026.1',
      status: 'pending_sub_signature',
      docusealSubmissionId: 'ds-ch14-20-01',
      subSignedAt: null,
      approverSignedAt: null,
    },
  ],
  fixedBudgetEntries: [
    { homeId: 'home-ch-14', costCode: '03', amountCents: 1_850_000, note: 'La Verkin building & impact fees' },
    { homeId: 'home-ch-14', costCode: '04', amountCents: 240_000, note: "Builder's risk policy" },
    { homeId: 'home-ch-14', costCode: '08', amountCents: 180_000, note: 'Estimated property tax' },
    { homeId: 'home-ch-14', costCode: '90', amountCents: 1_200_000, note: 'Supervision fixed fee' },
    { homeId: 'home-ch-14', costCode: '91', amountCents: 850_000, note: 'Contingency reserve' },
    { homeId: 'home-ch-14', costCode: '99', amountCents: 350_000, note: 'Warranty reserve' },
  ],
  jobCostBudgets: [
    {
      homeId: 'home-ps-11',
      homeCode: 'PS 11',
      costCode: '03',
      costCodeName: 'Building Permit and Impact Fees',
      budgetCents: 1_720_000,
      source: 'Estimating system v2',
      loadedAt: '2026-11-15T14:22:00Z',
      estimateVersion: 2,
    },
    {
      homeId: 'home-ps-11',
      homeCode: 'PS 11',
      costCode: '22',
      costCodeName: 'Framing - Labor',
      budgetCents: 2_530_500,
      source: 'Estimating system v2',
      loadedAt: '2026-11-15T14:22:00Z',
      estimateVersion: 2,
    },
    {
      homeId: 'home-ps-11',
      homeCode: 'PS 11',
      costCode: '31',
      costCodeName: 'Drywall',
      budgetCents: 1_410_000,
      source: 'Estimating system v2',
      loadedAt: '2026-11-15T14:22:00Z',
      estimateVersion: 2,
    },
  ],
  clarifications: [
    {
      id: 'clr-1',
      homeId: 'home-ps-11',
      homeCode: 'PS 11',
      costCode: '20',
      costCodeName: 'Electrical',
      category: 'plan_conflict' as const,
      title: 'Island pendant rough-in spacing vs. cabinet layout',
      status: 'open' as const,
      ownerName: 'Derek Bradshaw',
      dueDate: '2026-11-27',
      messages: [
        {
          author: 'Derek Bradshaw (PM)',
          body: 'Kitchen island shifted 6" south on cabinet shop drawing; confirm electrician boxes move before drywall.',
          createdAt: '2026-11-22T15:10:00Z',
        },
      ],
    },
    {
      id: 'clr-2',
      homeId: 'home-ch-14',
      homeCode: 'CH 14',
      costCode: '51',
      costCodeName: 'Stucco',
      category: 'scope_gap' as const,
      title: 'Pop-out foam trim detail on rear patio columns',
      status: 'answered' as const,
      ownerName: 'Amanda Miller',
      dueDate: '2026-11-26',
      messages: [
        {
          author: 'Amanda Miller (Estimator)',
          body: 'Included 48 LF foam trim under Canyon Stucco quote; match elevation sheet A4.1.',
          createdAt: '2026-11-23T11:05:00Z',
        },
      ],
    },
  ],
  auditLogs: [
    {
      id: 'aud-1',
      actorUserId: 'usr-amanda',
      actorEmail: 'amanda@interstatehomes.com',
      action: 'PO_ISSUED',
      entityType: 'purchase_order',
      entityId: 'CH14-22-01',
      homeId: 'home-ch-14',
      ipAddress: '10.0.14.22',
      beforeValues: null,
      afterValues: { poNumber: 'CH14-22-01', totalCents: 3328500, poType: 'subcontractor' },
      createdAt: '2026-11-23T14:20:00Z',
    },
    {
      id: 'aud-2',
      actorUserId: 'usr-tanner',
      actorEmail: 'tanner@redcliffsdrywall.example',
      action: 'QUOTE_COUNTER_SUBMITTED',
      entityType: 'quote',
      entityId: 'q-ch14-31',
      homeId: 'home-ch-14',
      ipAddress: '172.56.21.9',
      beforeValues: { quotedTotalCents: 1716000 },
      afterValues: { proposedTotalCents: 1814000, proposedQuantity: 9200 },
      createdAt: '2026-11-23T09:15:00Z',
    },
    {
      id: 'aud-3',
      actorUserId: 'usr-chase',
      actorEmail: 'chase@interstatehomes.com',
      action: 'BUDGET_APPROVED_LIVE',
      entityType: 'job_cost_budget',
      entityId: 'PS 11',
      homeId: 'home-ps-11',
      ipAddress: '10.0.14.5',
      beforeValues: { stage: 'pos_esign' },
      afterValues: { stage: 'live_budget', estimateVersion: 2 },
      createdAt: '2026-11-15T14:22:00Z',
    },
  ],
  feedbackItems: [
    {
      id: 'fb-demo-101',
      ticketKey: 'FB-101',
      category: 'bug',
      severity: 'high',
      status: 'plan_ready',
      title: 'PO compliance block banner lacks direct link to expired COI upload',
      description:
        'When issuing a Purchase Order for Hurricane Valley Plumbing on CH 14 (cost code 19), the 422 compliance error explains the expired COI but does not link directly to the Compliance review row for that subcontractor.',
      reporterUserId: 'usr-amanda',
      reporterEmail: 'amanda@interstatehomes.com',
      reporterName: 'Amanda Miller',
      reporterRole: 'estimator_approver',
      subCompanyId: null,
      pagePath: '/purchase-orders',
      pageTitle: 'Purchase Orders | Interstate Homes',
      pageContext: {
        pathname: '/purchase-orders',
        section: 'Purchase Orders',
        entityType: 'subcontractor',
        entityId: 'sub-hurricane-plumbing',
        entityLabel: 'Hurricane Valley Plumbing & Mechanical LLC',
        summary: {
          homeCode: 'CH 14',
          costCode: '19',
          poCount: 2,
          lastErrorStatus: 422,
        },
        appRole: 'estimator_approver',
        authMode: 'demo',
      },
      diagnosticSnapshot: {
        clientLogs: [
          {
            timestamp: '2026-11-24T15:12:04Z',
            level: 'warn',
            message: 'POST /api/purchase-orders returned 422 ComplianceBlocked for sub-hurricane-plumbing',
          },
        ],
        networkEvents: [
          {
            timestamp: '2026-11-24T15:12:04Z',
            requestId: 'demo-req-po-422',
            method: 'POST',
            path: '/api/purchase-orders',
            status: 422,
            durationMs: 18,
            ok: false,
            errorMessage: 'General Liability COI expired 2026-11-10',
          },
        ],
        breadcrumbs: [
          { timestamp: '2026-11-24T15:11:40Z', type: 'navigation', label: 'Navigated to /purchase-orders', path: '/purchase-orders' },
          { timestamp: '2026-11-24T15:12:02Z', type: 'click', label: 'Issue PO (Cost Code 19)' },
        ],
        requestIds: ['demo-req-po-422'],
        serverLogs: [
          {
            timestamp: '2026-11-24T15:12:04Z',
            requestId: 'demo-req-po-422',
            method: 'POST',
            route: '/api/purchase-orders',
            statusCode: 422,
            durationMs: 14,
            errorCode: 'ComplianceBlocked',
            errorMessage: 'PO blocked: COI expired 2026-11-10 for sub-hurricane-plumbing',
          },
        ],
        capturedAt: '2026-11-24T15:12:18Z',
      },
      screenshotStorageKey: null,
      resolutionNote: null,
      adminNotes: null,
      githubIssueNumber: null,
      githubIssueUrl: null,
      githubDispatchStatus: 'not_dispatched',
      approvedByUserId: null,
      approvedAt: null,
      resolvedAt: null,
      createdAt: '2026-11-24T15:12:30Z',
      updatedAt: '2026-11-24T15:12:35Z',
    },
    {
      id: 'fb-demo-102',
      ticketKey: 'FB-102',
      category: 'feature',
      severity: 'medium',
      status: 'deployed',
      title: 'Export visible job cost budget lines to CSV from /budgets',
      description:
        'Field Project Managers need a quick CSV export of the visible cost code budget rows on /budgets without exposing internal land/margin lines.',
      reporterUserId: 'usr-super',
      reporterEmail: 'super@interstatehomes.com',
      reporterName: 'Derek Bradshaw',
      reporterRole: 'project_manager',
      subCompanyId: null,
      pagePath: '/budgets',
      pageTitle: 'Budgets | Interstate Homes',
      pageContext: {
        pathname: '/budgets',
        section: 'Budgets',
        entityType: 'home',
        entityId: 'home-ps-11',
        entityLabel: 'PS 11',
        summary: { stage: 'live_budget', visibleRows: 3 },
        appRole: 'project_manager',
        authMode: 'demo',
      },
      diagnosticSnapshot: {
        clientLogs: [],
        networkEvents: [
          {
            timestamp: '2026-11-22T17:04:11Z',
            requestId: 'demo-req-budget-get',
            method: 'GET',
            path: '/api/budgets/home-ps-11',
            status: 200,
            durationMs: 11,
            ok: true,
          },
        ],
        breadcrumbs: [
          { timestamp: '2026-11-22T17:04:10Z', type: 'navigation', label: 'Navigated to /budgets', path: '/budgets' },
        ],
        requestIds: ['demo-req-budget-get'],
        serverLogs: [],
        capturedAt: '2026-11-22T17:05:00Z',
      },
      screenshotStorageKey: null,
      resolutionNote:
        'Shipped CSV export scoped strictly to server-projected visible budget rows so PM financial redaction rules remain intact.',
      adminNotes: 'Approved & verified against PM financial redaction test.',
      githubIssueNumber: null,
      githubIssueUrl: null,
      githubDispatchStatus: 'not_configured',
      approvedByUserId: 'usr-chase',
      approvedAt: '2026-11-22T18:10:00Z',
      resolvedAt: '2026-11-23T10:30:00Z',
      createdAt: '2026-11-22T17:05:10Z',
      updatedAt: '2026-11-23T10:30:00Z',
    },
  ],
  feedbackMessages: [
    {
      id: 'fbm-demo-1',
      feedbackItemId: 'fb-demo-101',
      senderType: 'user',
      senderUserId: 'usr-amanda',
      senderName: 'Amanda Miller',
      body: 'Issuing a PO for Hurricane Valley Plumbing gave a 422 COI error, but there is no link to jump straight to their compliance record.',
      visibleToReporter: true,
      createdAt: '2026-11-24T15:12:30Z',
    },
    {
      id: 'fbm-demo-2',
      feedbackItemId: 'fb-demo-101',
      senderType: 'assistant',
      senderUserId: null,
      senderName: 'Interstate Feedback Assistant',
      body: 'Captured your /purchase-orders context and correlated the 422 ComplianceBlocked response for Hurricane Valley Plumbing. An AI fix plan is ready for Admin review.',
      visibleToReporter: true,
      createdAt: '2026-11-24T15:12:35Z',
    },
    {
      id: 'fbm-demo-3',
      feedbackItemId: 'fb-demo-102',
      senderType: 'user',
      senderUserId: 'usr-super',
      senderName: 'Derek Bradshaw',
      body: 'Can we add a CSV download button on the Budgets page for field tracking?',
      visibleToReporter: true,
      createdAt: '2026-11-22T17:05:10Z',
    },
    {
      id: 'fbm-demo-4',
      feedbackItemId: 'fb-demo-102',
      senderType: 'admin',
      senderUserId: 'usr-chase',
      senderName: 'Chase Stratton',
      body: 'Shipped CSV export scoped strictly to server-projected visible budget rows so PM financial redaction rules remain intact.',
      visibleToReporter: true,
      createdAt: '2026-11-23T10:30:00Z',
    },
  ],
  feedbackFixPlans: [
    {
      id: 'fbp-demo-101-v1',
      feedbackItemId: 'fb-demo-101',
      version: 1,
      modelName: 'gemini-2.5-flash',
      summary:
        'Add a contextual "Open Compliance Record" link inside the Purchase Orders compliance-blocked alert banner using the blocked subCompanyId returned by POST /api/purchase-orders.',
      rootCauseOrGoal:
        'The 422 ComplianceBlocked response already identifies the failing subcontractor, but apps/web/src/app/purchase-orders/page.tsx renders only a plain text error banner without a deep link to /compliance?subId=...',
      affectedFiles: [
        {
          path: 'apps/web/src/app/purchase-orders/page.tsx',
          reason: 'Render a Link to /compliance?subId=<id> inside the 422 compliance error banner.',
          changeType: 'modify',
        },
        {
          path: 'apps/web/src/app/compliance/page.tsx',
          reason: 'Read optional subId query param on mount to highlight/filter the target subcontractor row.',
          changeType: 'modify',
        },
        {
          path: 'apps/api/src/routes/purchase-orders.ts',
          reason: 'Include subCompanyId in 422 ComplianceBlocked error payload for deterministic UI linking.',
          changeType: 'modify',
        },
      ],
      schemaChanges: [],
      securityRbacImpact:
        'No RBAC relaxation: /compliance remains gated by existing subcontractor scoping, and PO issuance still enforces compliance server-side.',
      implementationSteps: [
        {
          order: 1,
          title: 'Include subCompanyId in 422 error payload',
          details: 'Return subCompanyId alongside blockers in apps/api/src/routes/purchase-orders.ts when COI/W-9/MSA gating fails.',
        },
        {
          order: 2,
          title: 'Add deep link in PO alert banner',
          details: 'In apps/web/src/app/purchase-orders/page.tsx, show a Next.js Link to /compliance?subId=... when err.data?.subCompanyId is present.',
        },
        {
          order: 3,
          title: 'Support ?subId filter on Compliance page',
          details: 'Read searchParams.get("subId") in apps/web/src/app/compliance/page.tsx and highlight the matching vendor.',
        },
      ],
      verificationSteps: [
        'Run npm run test --workspace=@interstate/api to verify existing Scenario 5 COI PO blocking tests pass.',
        'Trigger Scenario 5 on /purchase-orders in browser and click the Compliance link to verify it lands on Hurricane Valley Plumbing.',
      ],
      riskLevel: 'low',
      estimatedEffort: 'xs',
      revisionFeedback: null,
      status: 'pending_approval',
      createdAt: '2026-11-24T15:12:35Z',
    },
    {
      id: 'fbp-demo-102-v1',
      feedbackItemId: 'fb-demo-102',
      version: 1,
      modelName: 'gemini-2.5-flash',
      summary: 'Generate CSV client-side exclusively from the server-redacted /api/budgets/:homeId payload.',
      rootCauseOrGoal: 'Field PMs need offline CSV snapshots without bypassing server-side internal financial redaction.',
      affectedFiles: [
        {
          path: 'apps/web/src/app/budgets/page.tsx',
          reason: 'Add Export CSV button iterating over already-projected rows.',
          changeType: 'modify',
        },
      ],
      schemaChanges: [],
      securityRbacImpact: 'Preserves PM financial redaction because 00L/88/92/93 and soldAmountCents are absent from API output.',
      implementationSteps: [
        {
          order: 1,
          title: 'Add CSV serializer helper',
          details: 'Escape CSV cells and download visible rows for the active home.',
        },
      ],
      verificationSteps: ['Verify exported CSV as project_manager excludes internal profit/land codes.'],
      riskLevel: 'low',
      estimatedEffort: 'xs',
      revisionFeedback: null,
      status: 'approved',
      createdAt: '2026-11-22T17:06:00Z',
    },
  ],
  feedbackScreenshots: new Map(),
  nextFeedbackSeq: 103,
  helper: {
    getSubdivisionName: (code: string) => SUBDIVISION_NAMES[code] ?? code,
  },
};
