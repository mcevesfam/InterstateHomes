import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
} from 'drizzle-orm/pg-core';
import type {
  DiagnosticSnapshot,
  FixPlanAffectedFile,
  FixPlanStep,
  PageContext,
} from '@interstate/shared';

export const feedbackItems = pgTable('feedback_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  ticketKey: text('ticket_key').notNull().unique(),
  category: text('category').notNull(), // bug | feature | question
  severity: text('severity').notNull().default('medium'), // low | medium | high | critical
  status: text('status').notNull().default('plan_ready'), // triage | plan_generating | plan_ready | approved | in_progress | deployed | rejected
  title: text('title').notNull(),
  description: text('description').notNull(),
  reporterUserId: uuid('reporter_user_id'),
  reporterEmail: text('reporter_email').notNull(),
  reporterName: text('reporter_name').notNull(),
  reporterRole: text('reporter_role').notNull(),
  subCompanyId: uuid('sub_company_id'),
  pagePath: text('page_path').notNull(),
  pageTitle: text('page_title'),
  pageContextJson: jsonb('page_context_json').$type<PageContext>().notNull(),
  diagnosticSnapshotJson: jsonb('diagnostic_snapshot_json').$type<DiagnosticSnapshot>().notNull(),
  screenshotStorageKey: text('screenshot_storage_key'),
  resolutionNote: text('resolution_note'),
  adminNotes: text('admin_notes'),
  githubIssueNumber: integer('github_issue_number'),
  githubIssueUrl: text('github_issue_url'),
  githubDispatchStatus: text('github_dispatch_status').notNull().default('not_dispatched'),
  approvedByUserId: uuid('approved_by_user_id'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const feedbackMessages = pgTable('feedback_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  feedbackItemId: uuid('feedback_item_id')
    .notNull()
    .references(() => feedbackItems.id, { onDelete: 'cascade' }),
  senderType: text('sender_type').notNull(), // user | assistant | admin | system
  senderUserId: uuid('sender_user_id'),
  senderName: text('sender_name').notNull(),
  body: text('body').notNull(),
  visibleToReporter: boolean('visible_to_reporter').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const feedbackFixPlans = pgTable('feedback_fix_plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  feedbackItemId: uuid('feedback_item_id')
    .notNull()
    .references(() => feedbackItems.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  modelName: text('model_name').notNull(),
  summary: text('summary').notNull(),
  rootCauseOrGoal: text('root_cause_or_goal').notNull(),
  affectedFilesJson: jsonb('affected_files_json').$type<FixPlanAffectedFile[]>().notNull(),
  schemaChangesJson: jsonb('schema_changes_json').$type<string[]>().notNull(),
  securityRbacImpact: text('security_rbac_impact').notNull(),
  implementationStepsJson: jsonb('implementation_steps_json').$type<FixPlanStep[]>().notNull(),
  verificationStepsJson: jsonb('verification_steps_json').$type<string[]>().notNull(),
  riskLevel: text('risk_level').notNull().default('low'),
  estimatedEffort: text('estimated_effort').notNull().default('s'),
  revisionFeedback: text('revision_feedback'),
  status: text('status').notNull().default('pending_approval'), // pending_approval | approved | superseded | rejected
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
