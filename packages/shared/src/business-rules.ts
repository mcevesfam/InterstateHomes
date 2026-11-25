import { INTERNAL_ONLY_COST_CODES } from './cost-codes.js';

export interface SystemSettingsConfig {
  minPasswordLength: number;
  sessionTimeoutMinutes: number;
  inactiveDisableDays: number;
  auditRetentionYears: number;
  breachNoticeHours: number;
  maxPlanUploadMb: number;
  warehouseRefreshSchedule: string;
  coiReminderDays: number[];
  requireMasterAgreement: boolean;
  currentMasterAgreementVersion: string;
  defaultGlMinLimitCents: number;
  defaultAutoMinLimitCents: number;
  poNumberFormat: string;
}

export const DEFAULT_SYSTEM_SETTINGS: SystemSettingsConfig = {
  minPasswordLength: 12,
  sessionTimeoutMinutes: 30,
  inactiveDisableDays: 90,
  auditRetentionYears: 7,
  breachNoticeHours: 24,
  maxPlanUploadMb: 250,
  warehouseRefreshSchedule: '0 2 * * *',
  coiReminderDays: [30, 15, 0],
  requireMasterAgreement: true,
  currentMasterAgreementVersion: '2026.1',
  defaultGlMinLimitCents: 100_000_000, // $1,000,000
  defaultAutoMinLimitCents: 100_000_000, // $1,000,000
  poNumberFormat: '{subdivisionCode}{lot}-{costCode}-{seq}',
};

/**
 * Formats a PO number preserving cost code as text (e.g. CH14-03-01, CH14-31-01).
 */
export function formatPoNumber(
  subdivisionCode: string,
  lot: string,
  costCode: string,
  sequence = 1
): string {
  const cleanSub = subdivisionCode.trim().toUpperCase();
  const cleanLot = lot.trim().toUpperCase();
  const cleanCode = costCode.trim();
  const seqStr = String(sequence).padStart(2, '0');
  return `${cleanSub}${cleanLot}-${cleanCode}-${seqStr}`;
}

export type ComplianceDocType =
  | 'coi_gl'
  | 'auto_liability'
  | 'workers_comp'
  | 'w9'
  | 'utah_license'
  | 'business_license'
  | 'master_agreement';

export interface ComplianceDocRecord {
  id?: string;
  fileName?: string;
  docType: ComplianceDocType;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  expiresAt?: string | null; // ISO date YYYY-MM-DD
  limitAmountCents?: number | null;
  additionalInsured?: boolean | null;
  licenseClassification?: string | null;
  agreementVersion?: string | null;
}

export interface SubComplianceSubject {
  status: 'active' | 'on_hold' | 'inactive';
  hasVehiclesOnSite: boolean;
}

export interface ComplianceCheckOptions {
  poType: 'subcontractor' | 'supplier';
  requiresUtahLicense: boolean;
  allowedLicenseClassifications?: string[];
  minGlLimitCents: number;
  minAutoLimitCents?: number;
  requireMasterAgreement: boolean;
  currentMasterAgreementVersion: string;
  asOfDate?: string; // ISO YYYY-MM-DD
}

export interface ComplianceBlockingReason {
  docType: ComplianceDocType | 'account_status';
  message: string;
}

export interface ComplianceCheckResult {
  eligible: boolean;
  blockingReasons: ComplianceBlockingReason[];
}

function isExpired(expiresAt: string | null | undefined, asOfDate: string): boolean {
  if (!expiresAt) return true;
  return expiresAt.slice(0, 10) < asOfDate.slice(0, 10);
}

/**
 * Enforces SOW Section 8.2 & Business Rule 4:
 * A PO can only be issued to an active sub/supplier with current approved compliance documents.
 */
export function checkSubComplianceForPO(
  sub: SubComplianceSubject,
  docs: ComplianceDocRecord[],
  options: ComplianceCheckOptions
): ComplianceCheckResult {
  const blockingReasons: ComplianceBlockingReason[] = [];
  const asOf = options.asOfDate ?? new Date().toISOString().slice(0, 10);

  if (sub.status !== 'active') {
    blockingReasons.push({
      docType: 'account_status',
      message: `Subcontractor/supplier status is "${sub.status}" (must be active to receive a PO).`,
    });
  }

  const latestApproved = (docType: ComplianceDocType): ComplianceDocRecord | undefined =>
    docs.find((d) => d.docType === docType && d.reviewStatus === 'approved');

  // W-9 is required for all subs AND suppliers
  const w9 = latestApproved('w9');
  if (!w9) {
    blockingReasons.push({
      docType: 'w9',
      message: 'W-9 is missing or not yet approved.',
    });
  }

  // Supplier-only POs only require active status + W-9
  if (options.poType === 'subcontractor') {
    // 1. Certificate of Insurance (General Liability)
    const coi = latestApproved('coi_gl');
    if (!coi) {
      blockingReasons.push({
        docType: 'coi_gl',
        message: 'Certificate of Insurance (General Liability) is missing or pending approval.',
      });
    } else {
      if (isExpired(coi.expiresAt, asOf)) {
        blockingReasons.push({
          docType: 'coi_gl',
          message: `Certificate of Insurance (General Liability) expired on ${coi.expiresAt ?? 'unknown date'}.`,
        });
      }
      if (!coi.additionalInsured) {
        blockingReasons.push({
          docType: 'coi_gl',
          message: 'Certificate of Insurance is missing the additional insured endorsement.',
        });
      }
      if ((coi.limitAmountCents ?? 0) < options.minGlLimitCents) {
        blockingReasons.push({
          docType: 'coi_gl',
          message: 'Certificate of Insurance general liability limit is below the required minimum.',
        });
      }
    }

    // 2. Auto Liability (subs with vehicles on site)
    if (sub.hasVehiclesOnSite) {
      const auto = latestApproved('auto_liability');
      if (!auto) {
        blockingReasons.push({
          docType: 'auto_liability',
          message: 'Auto Liability certificate is missing or pending approval.',
        });
      } else if (isExpired(auto.expiresAt, asOf)) {
        blockingReasons.push({
          docType: 'auto_liability',
          message: `Auto Liability certificate expired on ${auto.expiresAt ?? 'unknown date'}.`,
        });
      } else if (
        options.minAutoLimitCents &&
        (auto.limitAmountCents ?? 0) < options.minAutoLimitCents
      ) {
        blockingReasons.push({
          docType: 'auto_liability',
          message: 'Auto Liability limit is below the required minimum.',
        });
      }
    }

    // 3. Workers' Comp or State Exemption
    const wc = latestApproved('workers_comp');
    if (!wc) {
      blockingReasons.push({
        docType: 'workers_comp',
        message: "Workers' Compensation certificate or state exemption is missing or pending approval.",
      });
    } else if (isExpired(wc.expiresAt, asOf)) {
      blockingReasons.push({
        docType: 'workers_comp',
        message: `Workers' Compensation certificate expired on ${wc.expiresAt ?? 'unknown date'}.`,
      });
    }

    // 4. Utah Contractor License (for licensed trades)
    if (options.requiresUtahLicense) {
      const lic = latestApproved('utah_license');
      if (!lic) {
        blockingReasons.push({
          docType: 'utah_license',
          message: 'Utah Contractor License is missing or pending approval for this licensed trade.',
        });
      } else {
        if (isExpired(lic.expiresAt, asOf)) {
          blockingReasons.push({
            docType: 'utah_license',
            message: `Utah Contractor License expired on ${lic.expiresAt ?? 'unknown date'}.`,
          });
        }
        if (
          options.allowedLicenseClassifications &&
          options.allowedLicenseClassifications.length > 0 &&
          (!lic.licenseClassification ||
            !options.allowedLicenseClassifications.includes(lic.licenseClassification))
        ) {
          blockingReasons.push({
            docType: 'utah_license',
            message: `Utah Contractor License classification (${lic.licenseClassification ?? 'none'}) does not cover this cost code.`,
          });
        }
      }
    }

    // 5. Master Subcontract Agreement (confirmed used by Interstate Homes)
    if (options.requireMasterAgreement) {
      const msa = latestApproved('master_agreement');
      if (!msa) {
        blockingReasons.push({
          docType: 'master_agreement',
          message: 'Signed Master Subcontract Agreement is missing.',
        });
      } else if (msa.agreementVersion !== options.currentMasterAgreementVersion) {
        blockingReasons.push({
          docType: 'master_agreement',
          message: `Master Subcontract Agreement version (${msa.agreementVersion ?? 'none'}) is outdated; version ${options.currentMasterAgreementVersion} is required.`,
        });
      }
    }
  }

  return {
    eligible: blockingReasons.length === 0,
    blockingReasons,
  };
}

export interface BudgetEstimateLineInput {
  costCode: string;
  costCodeName: string;
  pricingSource: 'sub' | 'supplier' | 'fixed' | 'allowance' | 'none';
  estimatedAmountCents: number;
  isAllowanceOrFixed: boolean;
}

export interface SignedPoInput {
  costCode: string;
  totalCents: number;
  status: string; // must be 'fully_signed' to count
}

export interface FixedBudgetEntryInput {
  costCode: string;
  amountCents: number;
}

export interface BudgetLineSummary {
  costCode: string;
  costCodeName: string;
  estimatedCents: number;
  signedPoCents: number;
  fixedCents: number;
  finalBudgetCents: number;
  varianceCents: number;
}

export interface BudgetBuildResult {
  canApprove: boolean;
  blockingCostCodes: Array<{ costCode: string; reason: string }>;
  lines: BudgetLineSummary[];
  totalEstimatedCents: number;
  totalSignedPoCents: number;
  totalFixedCents: number;
  totalFinalBudgetCents: number;
  totalVarianceCents: number;
}

/**
 * Enforces SOW Section 9 Rules 7 & 8:
 * - Final budget per cost code = sum of fully signed POs + hand-entered fixed amounts. No other source.
 * - Cannot approve while any priced line lacks a signed PO unless marked fixed or allowance.
 */
export function calculateFinalBudget(
  estimateLines: BudgetEstimateLineInput[],
  pos: SignedPoInput[],
  fixedEntries: FixedBudgetEntryInput[]
): BudgetBuildResult {
  const poSums = new Map<string, number>();
  for (const po of pos) {
    if (po.status === 'fully_signed') {
      poSums.set(po.costCode, (poSums.get(po.costCode) ?? 0) + po.totalCents);
    }
  }

  const fixedSums = new Map<string, number>();
  for (const f of fixedEntries) {
    fixedSums.set(f.costCode, (fixedSums.get(f.costCode) ?? 0) + f.amountCents);
  }

  const blockingCostCodes: Array<{ costCode: string; reason: string }> = [];
  const lines: BudgetLineSummary[] = [];

  let totalEstimatedCents = 0;
  let totalSignedPoCents = 0;
  let totalFixedCents = 0;
  let totalFinalBudgetCents = 0;

  for (const line of estimateLines) {
    const signedPoCents = poSums.get(line.costCode) ?? 0;
    const fixedCents = fixedSums.get(line.costCode) ?? 0;
    const finalBudgetCents = signedPoCents + fixedCents;
    const varianceCents = finalBudgetCents - line.estimatedAmountCents;

    const requiresSignedPo =
      line.pricingSource !== 'none' &&
      line.pricingSource !== 'fixed' &&
      line.pricingSource !== 'allowance' &&
      !line.isAllowanceOrFixed &&
      line.estimatedAmountCents > 0;

    if (requiresSignedPo && signedPoCents === 0) {
      blockingCostCodes.push({
        costCode: line.costCode,
        reason: `Cost code ${line.costCode} (${line.costCodeName}) lacks a fully signed PO and is not marked fixed/allowance.`,
      });
    }

    lines.push({
      costCode: line.costCode,
      costCodeName: line.costCodeName,
      estimatedCents: line.estimatedAmountCents,
      signedPoCents,
      fixedCents,
      finalBudgetCents,
      varianceCents,
    });

    totalEstimatedCents += line.estimatedAmountCents;
    totalSignedPoCents += signedPoCents;
    totalFixedCents += fixedCents;
    totalFinalBudgetCents += finalBudgetCents;
  }

  return {
    canApprove: blockingCostCodes.length === 0,
    blockingCostCodes,
    lines,
    totalEstimatedCents,
    totalSignedPoCents,
    totalFixedCents,
    totalFinalBudgetCents,
    totalVarianceCents: totalFinalBudgetCents - totalEstimatedCents,
  };
}

export interface InternalEstimateLine {
  costCode: string;
  costCodeName: string;
  classificationCode: string;
  classificationName: string;
  pricingSource: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  extendedCents: number;
  selectedSubName?: string | null;
  showOnHomeownerPdf?: boolean;
}

export interface HomeownerEstimateLine {
  costCode: string;
  costCodeName: string;
  classificationCode: string;
  classificationName: string;
  pricingSource: string;
  extendedCents: number;
}

export interface HomeownerClassificationSummary {
  classificationCode: string;
  classificationName: string;
  totalCents: number;
  lines: HomeownerEstimateLine[];
}

export interface HomeownerEstimateProjection {
  homeCode: string;
  planName: string;
  subdivisionName: string;
  classifications: HomeownerClassificationSummary[];
  grandTotalCents: number;
}

/**
 * Enforces SOW Section 5.8 & Business Rule 10:
 * Homeowner estimates NEVER show vendor names, unit costs, profit (93), land (00L),
 * real estate fees (88), overhead (92), sold price, or margin.
 */
export function projectHomeownerEstimate(params: {
  homeCode: string;
  planName: string;
  subdivisionName: string;
  lines: InternalEstimateLine[];
  includeSelectedLines?: boolean;
}): HomeownerEstimateProjection {
  const byClassification = new Map<string, HomeownerClassificationSummary>();
  let grandTotalCents = 0;

  for (const line of params.lines) {
    if (INTERNAL_ONLY_COST_CODES.has(line.costCode)) {
      continue;
    }
    if (line.extendedCents === 0 && !line.showOnHomeownerPdf) {
      continue;
    }

    let bucket = byClassification.get(line.classificationCode);
    if (!bucket) {
      bucket = {
        classificationCode: line.classificationCode,
        classificationName: line.classificationName,
        totalCents: 0,
        lines: [],
      };
      byClassification.set(line.classificationCode, bucket);
    }

    bucket.totalCents += line.extendedCents;
    grandTotalCents += line.extendedCents;

    if (params.includeSelectedLines !== false && line.showOnHomeownerPdf !== false) {
      bucket.lines.push({
        costCode: line.costCode,
        costCodeName: line.costCodeName,
        classificationCode: line.classificationCode,
        classificationName: line.classificationName,
        pricingSource: line.pricingSource,
        extendedCents: line.extendedCents,
      });
    }
  }

  return {
    homeCode: params.homeCode,
    planName: params.planName,
    subdivisionName: params.subdivisionName,
    classifications: Array.from(byClassification.values()),
    grandTotalCents,
  };
}
