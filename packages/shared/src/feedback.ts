import { z } from 'zod';

export const feedbackCategorySchema = z.enum(['bug', 'feature', 'question']);
export type FeedbackCategory = z.infer<typeof feedbackCategorySchema>;

export const feedbackSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type FeedbackSeverity = z.infer<typeof feedbackSeveritySchema>;

export const feedbackStatusSchema = z.enum([
  'triage',
  'plan_generating',
  'plan_ready',
  'approved',
  'in_progress',
  'deployed',
  'rejected',
]);
export type FeedbackStatus = z.infer<typeof feedbackStatusSchema>;

export const feedbackPlanStatusSchema = z.enum([
  'pending_approval',
  'approved',
  'superseded',
  'rejected',
]);
export type FeedbackPlanStatus = z.infer<typeof feedbackPlanStatusSchema>;

export const githubDispatchStatusSchema = z.enum([
  'not_dispatched',
  'created',
  'not_configured',
  'failed',
]);
export type GithubDispatchStatus = z.infer<typeof githubDispatchStatusSchema>;

export const clientLogEntrySchema = z.object({
  timestamp: z.string(),
  level: z.enum(['warn', 'error', 'react_error', 'window_error', 'unhandled_rejection']),
  message: z.string(),
  stack: z.string().optional(),
});
export type ClientLogEntry = z.infer<typeof clientLogEntrySchema>;

export const networkEventSchema = z.object({
  timestamp: z.string(),
  requestId: z.string(),
  method: z.string(),
  path: z.string(),
  status: z.number(),
  durationMs: z.number(),
  ok: z.boolean(),
  errorMessage: z.string().optional(),
});
export type NetworkEventEntry = z.infer<typeof networkEventSchema>;

export const breadcrumbSchema = z.object({
  timestamp: z.string(),
  type: z.enum(['navigation', 'click', 'action']),
  label: z.string(),
  path: z.string().optional(),
});
export type BreadcrumbEntry = z.infer<typeof breadcrumbSchema>;

export const serverLogEntrySchema = z.object({
  timestamp: z.string(),
  requestId: z.string(),
  method: z.string(),
  route: z.string(),
  statusCode: z.number(),
  durationMs: z.number(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  stackPreview: z.string().optional(),
});
export type ServerLogEntry = z.infer<typeof serverLogEntrySchema>;

export const pageContextSchema = z.object({
  pathname: z.string().max(300),
  search: z.string().max(500).optional(),
  pageTitle: z.string().max(200).optional(),
  section: z.string().max(100).optional(),
  entityType: z.string().max(80).optional(),
  entityId: z.string().max(120).optional(),
  entityLabel: z.string().max(200).optional(),
  summary: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
  viewport: z
    .object({
      width: z.number().int().nonnegative(),
      height: z.number().int().nonnegative(),
    })
    .optional(),
  userAgent: z.string().max(400).optional(),
  appRole: z.string().max(60).optional(),
  authMode: z.string().max(40).optional(),
});
export type PageContext = z.infer<typeof pageContextSchema>;

export const diagnosticSnapshotSchema = z.object({
  clientLogs: z.array(clientLogEntrySchema).default([]),
  networkEvents: z.array(networkEventSchema).default([]),
  breadcrumbs: z.array(breadcrumbSchema).default([]),
  requestIds: z.array(z.string()).default([]),
  serverLogs: z.array(serverLogEntrySchema).default([]),
  capturedAt: z.string().default(() => new Date().toISOString()),
});
export type DiagnosticSnapshot = z.infer<typeof diagnosticSnapshotSchema>;

export const fixPlanAffectedFileSchema = z.object({
  path: z.string().min(1).max(300),
  reason: z.string().min(1).max(600),
  changeType: z.enum(['modify', 'create', 'delete']),
});
export type FixPlanAffectedFile = z.infer<typeof fixPlanAffectedFileSchema>;

export const fixPlanStepSchema = z.object({
  order: z.number().int().positive(),
  title: z.string().min(1).max(200),
  details: z.string().min(1).max(1500),
});
export type FixPlanStep = z.infer<typeof fixPlanStepSchema>;

export const fixPlanDraftSchema = z.object({
  summary: z.string().min(5).max(2000),
  rootCauseOrGoal: z.string().min(5).max(3000),
  affectedFiles: z.array(fixPlanAffectedFileSchema).min(1).max(25),
  schemaChanges: z.array(z.string().max(500)).max(15).default([]),
  securityRbacImpact: z.string().min(3).max(1500),
  implementationSteps: z.array(fixPlanStepSchema).min(1).max(20),
  verificationSteps: z.array(z.string().max(600)).min(1).max(15),
  riskLevel: z.enum(['low', 'medium', 'high']),
  estimatedEffort: z.enum(['xs', 's', 'm', 'l']),
});
export type FixPlanDraft = z.infer<typeof fixPlanDraftSchema>;

export const feedbackChatMessageInputSchema = z.object({
  senderType: z.enum(['user', 'assistant']),
  body: z.string().min(1).max(4000),
});

export const feedbackChatRequestSchema = z.object({
  messages: z.array(feedbackChatMessageInputSchema).min(1).max(30),
  pageContext: pageContextSchema,
  recentErrorsSummary: z.string().max(3000).optional(),
  screenshotStorageKey: z.string().max(400).optional(),
});
export type FeedbackChatRequest = z.infer<typeof feedbackChatRequestSchema>;

export interface FeedbackChatResponse {
  reply: string;
  suggestedCategory: FeedbackCategory;
  suggestedSeverity: FeedbackSeverity;
  suggestedTitle: string;
  readyToSubmit: boolean;
  draftSummary: string;
  modelName: string;
}

export const createFeedbackSchema = z.object({
  category: feedbackCategorySchema,
  severity: feedbackSeveritySchema.default('medium'),
  title: z.string().min(3).max(200),
  description: z.string().min(3).max(8000),
  pageContext: pageContextSchema,
  diagnosticSnapshot: diagnosticSnapshotSchema.default({
    clientLogs: [],
    networkEvents: [],
    breadcrumbs: [],
    requestIds: [],
    serverLogs: [],
    capturedAt: new Date().toISOString(),
  }),
  screenshotStorageKey: z.string().max(400).nullable().optional(),
  transcript: z.array(feedbackChatMessageInputSchema).max(40).default([]),
});
export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;

export const screenshotUploadSchema = z.object({
  dataUrl: z.string().min(20).max(8_000_000),
  filename: z.string().max(120).optional(),
});
export type ScreenshotUploadInput = z.infer<typeof screenshotUploadSchema>;

export const feedbackMessageCreateSchema = z.object({
  body: z.string().min(1).max(4000),
  visibleToReporter: z.boolean().default(true),
});

export const revisePlanSchema = z.object({
  feedback: z.string().min(3).max(3000),
});

export const approveFeedbackSchema = z.object({
  adminNotes: z.string().max(2000).optional(),
  createGithubIssue: z.boolean().default(true),
});

export const rejectFeedbackSchema = z.object({
  resolutionNote: z.string().min(3).max(2000),
  adminNotes: z.string().max(2000).optional(),
});

export const updateFeedbackStatusSchema = z.object({
  status: z.enum(['in_progress', 'deployed']),
  resolutionNote: z.string().max(2000).optional(),
});

export interface FeedbackMessageDTO {
  id: string;
  feedbackItemId: string;
  senderType: 'user' | 'assistant' | 'admin' | 'system';
  senderUserId: string | null;
  senderName: string;
  body: string;
  visibleToReporter: boolean;
  createdAt: string;
}

export interface FeedbackFixPlanDTO extends FixPlanDraft {
  id: string;
  feedbackItemId: string;
  version: number;
  modelName: string;
  revisionFeedback: string | null;
  status: FeedbackPlanStatus;
  createdAt: string;
}

export interface FeedbackItemReporterDTO {
  id: string;
  ticketKey: string;
  category: FeedbackCategory;
  severity: FeedbackSeverity;
  status: FeedbackStatus;
  title: string;
  description: string;
  pagePath: string;
  pageTitle: string | null;
  pageContext?: Pick<PageContext, 'section' | 'entityType' | 'entityLabel'>;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  messages?: FeedbackMessageDTO[];
}

export interface FeedbackItemAdminDTO extends FeedbackItemReporterDTO {
  reporterUserId: string | null;
  reporterEmail: string;
  reporterName: string;
  reporterRole: string;
  subCompanyId: string | null;
  pageContext: PageContext;
  diagnosticSnapshot: DiagnosticSnapshot;
  screenshotStorageKey: string | null;
  screenshotUrl?: string | null;
  adminNotes: string | null;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  githubDispatchStatus: GithubDispatchStatus;
  approvedByUserId: string | null;
  approvedAt: string | null;
  latestPlan?: FeedbackFixPlanDTO | null;
  fixPlans?: FeedbackFixPlanDTO[];
  agentBriefMarkdown?: string | null;
}
