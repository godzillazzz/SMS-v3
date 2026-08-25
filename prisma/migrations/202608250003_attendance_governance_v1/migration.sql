-- Attendance governance is additive: raw AttendanceEvent rows remain immutable.
CREATE TABLE "attendance_corrections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "attendance_session_id" UUID NOT NULL,
  "event_type" "AttendanceEventType" NOT NULL,
  "original_event_id" UUID,
  "original_effective_event_at" TIMESTAMPTZ,
  "corrected_effective_event_at" TIMESTAMPTZ NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "actor_role_snapshot" VARCHAR(50) NOT NULL,
  "is_current" BOOLEAN NOT NULL DEFAULT TRUE,
  "superseded_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_corrections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_corrections_session_fkey" FOREIGN KEY ("attendance_session_id") REFERENCES "attendance_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_corrections_original_event_fkey" FOREIGN KEY ("original_event_id") REFERENCES "attendance_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_corrections_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_corrections_reason_nonempty" CHECK (length(btrim("reason")) >= 5),
  CONSTRAINT "attendance_corrections_current_shape" CHECK (("is_current" = TRUE AND "superseded_at" IS NULL) OR ("is_current" = FALSE AND "superseded_at" IS NOT NULL))
);

CREATE UNIQUE INDEX "attendance_corrections_current_event_key"
  ON "attendance_corrections"("attendance_session_id", "event_type")
  WHERE "is_current" = TRUE;
CREATE INDEX "attendance_corrections_session_created_idx" ON "attendance_corrections"("attendance_session_id", "created_at");
CREATE INDEX "attendance_corrections_actor_created_idx" ON "attendance_corrections"("actor_user_id", "created_at");

CREATE TABLE "attendance_month_certifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "month" DATE NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" VARCHAR(30) NOT NULL,
  "summary_snapshot" JSONB NOT NULL,
  "summary_digest" CHAR(64) NOT NULL,
  "certified_by_user_id" UUID NOT NULL,
  "certified_at" TIMESTAMPTZ NOT NULL,
  "unlocked_by_user_id" UUID,
  "unlocked_at" TIMESTAMPTZ,
  "unlock_reason" VARCHAR(1000),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_month_certifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_month_certifications_month_revision_key" UNIQUE ("month", "revision"),
  CONSTRAINT "attendance_month_certifications_certifier_fkey" FOREIGN KEY ("certified_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_month_certifications_unlocker_fkey" FOREIGN KEY ("unlocked_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_month_certifications_revision_positive" CHECK ("revision" > 0),
  CONSTRAINT "attendance_month_certifications_status_check" CHECK ("status" IN ('CERTIFIED', 'UNLOCKED')),
  CONSTRAINT "attendance_month_certifications_digest_check" CHECK ("summary_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "attendance_month_certifications_unlock_shape" CHECK (
    ("status" = 'CERTIFIED' AND "unlocked_by_user_id" IS NULL AND "unlocked_at" IS NULL AND "unlock_reason" IS NULL)
    OR
    ("status" = 'UNLOCKED' AND "unlocked_by_user_id" IS NOT NULL AND "unlocked_at" IS NOT NULL AND length(btrim("unlock_reason")) >= 5)
  )
);

CREATE UNIQUE INDEX "attendance_month_certifications_current_key"
  ON "attendance_month_certifications"("month")
  WHERE "status" = 'CERTIFIED';
CREATE INDEX "attendance_month_certifications_month_created_idx" ON "attendance_month_certifications"("month", "created_at");
