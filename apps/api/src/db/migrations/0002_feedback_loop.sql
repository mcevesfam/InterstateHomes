CREATE TABLE IF NOT EXISTS "feedback_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ticket_key" text NOT NULL UNIQUE,
  "category" text NOT NULL,
  "severity" text NOT NULL DEFAULT 'medium',
  "status" text NOT NULL DEFAULT 'plan_ready',
  "title" text NOT NULL,
  "description" text NOT NULL,
  "reporter_user_id" uuid,
  "reporter_email" text NOT NULL,
  "reporter_name" text NOT NULL,
  "reporter_role" text NOT NULL,
  "sub_company_id" uuid,
  "page_path" text NOT NULL,
  "page_title" text,
  "page_context_json" jsonb NOT NULL,
  "diagnostic_snapshot_json" jsonb NOT NULL,
  "screenshot_storage_key" text,
  "resolution_note" text,
  "admin_notes" text,
  "github_issue_number" integer,
  "github_issue_url" text,
  "github_dispatch_status" text NOT NULL DEFAULT 'not_dispatched',
  "approved_by_user_id" uuid,
  "approved_at" timestamp with time zone,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "feedback_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "feedback_item_id" uuid NOT NULL REFERENCES "feedback_items"("id") ON DELETE CASCADE,
  "sender_type" text NOT NULL,
  "sender_user_id" uuid,
  "sender_name" text NOT NULL,
  "body" text NOT NULL,
  "visible_to_reporter" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "feedback_fix_plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "feedback_item_id" uuid NOT NULL REFERENCES "feedback_items"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "model_name" text NOT NULL,
  "summary" text NOT NULL,
  "root_cause_or_goal" text NOT NULL,
  "affected_files_json" jsonb NOT NULL,
  "schema_changes_json" jsonb NOT NULL,
  "security_rbac_impact" text NOT NULL,
  "implementation_steps_json" jsonb NOT NULL,
  "verification_steps_json" jsonb NOT NULL,
  "risk_level" text NOT NULL DEFAULT 'low',
  "estimated_effort" text NOT NULL DEFAULT 's',
  "revision_feedback" text,
  "status" text NOT NULL DEFAULT 'pending_approval',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_feedback_items_status" ON "feedback_items" ("status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_feedback_items_reporter" ON "feedback_items" ("reporter_user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_feedback_messages_item" ON "feedback_messages" ("feedback_item_id", "created_at" ASC);
CREATE INDEX IF NOT EXISTS "idx_feedback_fix_plans_item_version" ON "feedback_fix_plans" ("feedback_item_id", "version" DESC);
