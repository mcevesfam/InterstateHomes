import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  bigint,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  fullName: text('full_name').notNull(),
  role: text('role').notNull(), // admin | estimator_approver | project_manager | subcontractor | homeowner
  subCompanyId: uuid('sub_company_id'),
  isSubCompanyAdmin: boolean('is_sub_company_admin').notNull().default(false),
  passwordHash: text('password_hash'),
  mfaSecretEncrypted: text('mfa_secret_encrypted'),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  approvalLimitCents: bigint('approval_limit_cents', { mode: 'number' }),
  status: text('status').notNull().default('active'), // active | disabled | locked
  failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  lastReauthAt: timestamp('last_reauth_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const systemSettings = pgTable('system_settings', {
  id: text('id').primaryKey().default('default'),
  minPasswordLength: integer('min_password_length').notNull().default(12),
  sessionTimeoutMinutes: integer('session_timeout_minutes').notNull().default(30),
  inactiveDisableDays: integer('inactive_disable_days').notNull().default(90),
  auditRetentionYears: integer('audit_retention_years').notNull().default(7),
  breachNoticeHours: integer('breach_notice_hours').notNull().default(24),
  maxPlanUploadMb: integer('max_plan_upload_mb').notNull().default(250),
  warehouseRefreshSchedule: text('warehouse_refresh_schedule').notNull().default('0 2 * * *'),
  coiReminderDaysJson: jsonb('coi_reminder_days_json').$type<number[]>().notNull().default([30, 15, 0]),
  requireMasterAgreement: boolean('require_master_agreement').notNull().default(true),
  currentMasterAgreementVersion: text('current_master_agreement_version').notNull().default('2026.1'),
  defaultGlMinLimitCents: bigint('default_gl_min_limit_cents', { mode: 'number' })
    .notNull()
    .default(100_000_000),
  defaultAutoMinLimitCents: bigint('default_auto_min_limit_cents', { mode: 'number' })
    .notNull()
    .default(100_000_000),
  poNumberFormat: text('po_number_format').notNull().default('{subdivisionCode}{lot}-{costCode}-{seq}'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorUserId: uuid('actor_user_id'),
  actorEmail: text('actor_email'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  homeId: uuid('home_id'),
  ipAddress: text('ip_address'),
  beforeValues: jsonb('before_values').$type<Record<string, unknown> | null>(),
  afterValues: jsonb('after_values').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
