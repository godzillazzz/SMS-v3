-- CFG-07 Data Retention Center.
-- Additive governance tables and protected SystemSetting seeds only.
-- No existing data is deleted by this migration.

CREATE TABLE "retention_policy_changes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "status" VARCHAR(20) NOT NULL,
  "before_policy" JSONB NOT NULL,
  "proposed_policy" JSONB NOT NULL,
  "preview_snapshot" JSONB NOT NULL,
  "preview_digest" CHAR(64) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "requested_by_user_id" UUID NOT NULL,
  "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effective_at" TIMESTAMPTZ NOT NULL,
  "applied_at" TIMESTAMPTZ,
  "cancelled_at" TIMESTAMPTZ,
  "cancel_reason" VARCHAR(1000),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "retention_policy_changes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "retention_policy_changes_requester_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "retention_policy_changes_status_check"
    CHECK ("status" IN ('SCHEDULED', 'APPLIED', 'CANCELLED')),
  CONSTRAINT "retention_policy_changes_preview_digest_check"
    CHECK ("preview_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "retention_policy_changes_reason_check"
    CHECK (length(btrim("reason")) BETWEEN 5 AND 1000),
  CONSTRAINT "retention_policy_changes_state_shape" CHECK (
    ("status" = 'SCHEDULED' AND "applied_at" IS NULL AND "cancelled_at" IS NULL AND "cancel_reason" IS NULL)
    OR ("status" = 'APPLIED' AND "applied_at" IS NOT NULL AND "cancelled_at" IS NULL AND "cancel_reason" IS NULL)
    OR ("status" = 'CANCELLED' AND "applied_at" IS NULL AND "cancelled_at" IS NOT NULL AND length(btrim("cancel_reason")) BETWEEN 5 AND 1000)
  )
);

CREATE UNIQUE INDEX "retention_policy_changes_one_scheduled_key"
  ON "retention_policy_changes" ((1))
  WHERE "status" = 'SCHEDULED';
CREATE INDEX "retention_policy_changes_status_effective_idx"
  ON "retention_policy_changes"("status", "effective_at");
CREATE INDEX "retention_policy_changes_requester_requested_idx"
  ON "retention_policy_changes"("requested_by_user_id", "requested_at");

CREATE TABLE "retention_cleanup_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "trigger" VARCHAR(10) NOT NULL,
  "status" VARCHAR(20) NOT NULL,
  "policy_snapshot" JSONB NOT NULL,
  "result_snapshot" JSONB,
  "actor_user_id" UUID,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ,
  "error_code" VARCHAR(80),
  CONSTRAINT "retention_cleanup_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "retention_cleanup_runs_actor_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "retention_cleanup_runs_trigger_check" CHECK ("trigger" IN ('CRON', 'ADMIN')),
  CONSTRAINT "retention_cleanup_runs_status_check" CHECK ("status" IN ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED')),
  CONSTRAINT "retention_cleanup_runs_state_shape" CHECK (
    ("status" = 'RUNNING' AND "completed_at" IS NULL)
    OR ("status" <> 'RUNNING' AND "completed_at" IS NOT NULL)
  )
);
CREATE INDEX "retention_cleanup_runs_started_status_idx"
  ON "retention_cleanup_runs"("started_at", "status");
CREATE INDEX "retention_cleanup_runs_actor_started_idx"
  ON "retention_cleanup_runs"("actor_user_id", "started_at");

INSERT INTO "system_settings" ("key", "value", "description", "created_at", "updated_at")
VALUES
  ('RETENTION.OPERATIONAL_USAGE.MONTHS', '6', 'Operational/usage transient state retention ceiling in complete Asia/Bangkok calendar months.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('RETENTION.ATTENDANCE_RAW.MONTHS', '12', 'Attendance raw event retention in complete Asia/Bangkok calendar months.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('RETENTION.PATROL_RAW.MONTHS', '3', 'Patrol/checkpoint raw scan retention in complete Asia/Bangkok calendar months; adapter is inactive until Patrol exists.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('RETENTION.TIMEZONE', 'Asia/Bangkok', 'Protected retention timezone authority.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- Retention governance is server-only authority.
DO $$
DECLARE
  table_name text;
  target_tables text[] := ARRAY['retention_policy_changes', 'retention_cleanup_runs'];
BEGIN
  FOREACH table_name IN ARRAY target_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', table_name);
    END IF;
  END LOOP;
END
$$;
