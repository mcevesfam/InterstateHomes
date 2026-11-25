import { z } from 'zod';
import { isCostCodeTextValid } from './cost-codes.js';

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.');

export const costCodeTextSchema = z
  .string()
  .min(2)
  .max(8)
  .refine((val) => isCostCodeTextValid(val), {
    message: 'Cost code must be a valid Section 7 cost code stored as text (e.g. "03", "00L").',
  });

export const createHomeSchema = z.object({
  subdivisionCode: z.string().min(2).max(10),
  lot: z.string().min(1).max(20),
  address: z.string().min(3).max(200),
  planName: z.string().min(1).max(120),
  elevation: z.string().min(1).max(60).default('Standard'),
  garageHanding: z.enum(['Left', 'Right', 'Detached', 'N/A']).default('Right'),
  optionsSelected: z.array(z.string()).default([]),
  finishedSqFt: z.number().int().positive(),
  garageSqFt: z.number().int().nonnegative().default(0),
  bedrooms: z.number().int().positive().default(3),
  baths: z.number().positive().default(2.5),
  stories: z.number().int().positive().default(1),
  plateHeightFt: z.number().positive().default(9),
  roofPitch: z.string().min(1).max(20).default('6:12'),
  exteriorFinishMix: z.string().max(200).default('Stucco + Stone'),
  planLibraryId: z.string().optional(),
});

export const updateEstimateLineSchema = z.object({
  quantity: z.number().nonnegative().optional(),
  unit: z.string().min(1).max(32).optional(),
  pricingSource: z.enum(['sub', 'supplier', 'fixed', 'allowance', 'none']).optional(),
  selectedSubId: z.string().nullable().optional(),
  unitPriceCents: z.number().int().nonnegative().optional(),
  fixedAmountCents: z.number().int().nonnegative().optional(),
  isAllowanceOrFixed: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
  showOnHomeownerPdf: z.boolean().optional(),
});

export const createSubcontractorSchema = z.object({
  legalName: z.string().min(2).max(200),
  dbaName: z.string().max(200).optional(),
  companyType: z.enum(['subcontractor', 'supplier', 'both']),
  address: z.string().max(300).optional(),
  mainPhone: z.string().max(30).optional(),
  website: z.string().max(200).optional(),
  primaryContactName: z.string().min(1).max(120).optional(),
  primaryContactEmail: z.string().email().max(200).optional(),
  primaryContactPhone: z.string().max(30).optional(),
  hasVehiclesOnSite: z.boolean().default(true),
  costCodesServed: z.array(costCodeTextSchema).min(1),
  subdivisionsServed: z.array(z.string()).default(['ALL']),
  paymentTermsNetDays: z.number().int().nonnegative().default(30),
  retainagePercent: z.number().min(0).max(20).default(0),
});

export const createPurchaseOrderSchema = z.object({
  homeId: z.string().min(1),
  costCode: costCodeTextSchema,
  subId: z.string().min(1),
  poType: z.enum(['subcontractor', 'supplier']),
  scopeSummary: z.string().min(3).max(2000),
  totalCents: z.number().int().nonnegative(),
  planRevision: z.string().min(1).max(40).default('Rev 1'),
  splitScopeOverrideReason: z.string().max(500).optional(),
});

export const quoteCounterSchema = z.object({
  proposedTotalCents: z.number().int().nonnegative(),
  proposedQuantity: z.number().nonnegative().optional(),
  comment: z.string().min(2).max(1000),
});

export const quoteDecisionSchema = z.object({
  decision: z.enum(['accept', 'reject', 'renegotiate']),
  note: z.string().max(1000).optional(),
});

export const createClarificationSchema = z.object({
  homeId: z.string().min(1),
  costCode: costCodeTextSchema,
  category: z.enum(['question', 'scope_gap', 'plan_conflict', 'price_dispute']),
  title: z.string().min(3).max(200),
  description: z.string().min(3).max(2000),
  dueDate: isoDateSchema.optional(),
});

export const updateSystemSettingsSchema = z.object({
  minPasswordLength: z.number().int().min(8).max(64).optional(),
  sessionTimeoutMinutes: z.number().int().min(5).max(480).optional(),
  inactiveDisableDays: z.number().int().min(7).max(365).optional(),
  auditRetentionYears: z.number().int().min(1).max(25).optional(),
  breachNoticeHours: z.number().int().min(1).max(168).optional(),
  maxPlanUploadMb: z.number().int().min(10).max(2048).optional(),
  warehouseRefreshSchedule: z.string().min(5).max(64).optional(),
  requireMasterAgreement: z.boolean().optional(),
  currentMasterAgreementVersion: z.string().min(1).max(32).optional(),
  defaultGlMinLimitCents: z.number().int().nonnegative().optional(),
  defaultAutoMinLimitCents: z.number().int().nonnegative().optional(),
  poNumberFormat: z.string().min(3).max(64).optional(),
});
