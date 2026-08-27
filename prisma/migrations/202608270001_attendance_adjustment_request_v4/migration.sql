-- Attendance Adjustment Request V4
-- Pending requests are governance records only. They MUST NOT alter authoritative Attendance.
-- Effective changes continue to live in attendance_corrections and are inserted only by ADMIN approval.

CREATE TABLE "attendance_adjustment_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "shift_assignment_id" UUID NOT NULL,
  "attendance_session_id" UUID,
  "request_type" VARCHAR(40) NOT NULL,
  "status" VARCHAR(40) NOT NULL DEFAULT 'DRAFT',
  "maker_user_id" UUID NOT NULL,
  "maker_role_snapshot" VARCHAR(50) NOT NULL,
  "current_revision" INTEGER NOT NULL DEFAULT 1,
  "approved_revision" INTEGER,
  "before_snapshot" JSONB NOT NULL,
  "before_digest" CHAR(64) NOT NULL,
  "current_proposal" JSONB NOT NULL,
  "current_proposal_digest" CHAR(64) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "last_reviewer_comment" VARCHAR(1000),
  "approver_user_id" UUID,
  "approved_at" TIMESTAMPTZ,
  "rejected_by_user_id" UUID,
  "rejected_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_adjustment_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_adjustment_requests_assignment_fkey" FOREIGN KEY ("shift_assignment_id") REFERENCES "shift_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_adjustment_requests_session_fkey" FOREIGN KEY ("attendance_session_id") REFERENCES "attendance_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_adjustment_requests_maker_fkey" FOREIGN KEY ("maker_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_adjustment_requests_approver_fkey" FOREIGN KEY ("approver_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_adjustment_requests_rejector_fkey" FOREIGN KEY ("rejected_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_adjustment_requests_type_check" CHECK ("request_type" IN ('CONFIRM_WORK_PERFORMED', 'ADJUST_WORK_TIME')),
  CONSTRAINT "attendance_adjustment_requests_status_check" CHECK ("status" IN ('DRAFT', 'PENDING_APPROVAL', 'RETURNED_FOR_CORRECTION', 'APPROVED', 'REJECTED', 'CANCELLED')),
  CONSTRAINT "attendance_adjustment_requests_revision_positive" CHECK ("current_revision" > 0),
  CONSTRAINT "attendance_adjustment_requests_approved_revision_shape" CHECK ("approved_revision" IS NULL OR "approved_revision" > 0),
  CONSTRAINT "attendance_adjustment_requests_reason_nonempty" CHECK (length(btrim("reason")) >= 5),
  CONSTRAINT "attendance_adjustment_requests_before_digest_check" CHECK ("before_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "attendance_adjustment_requests_proposal_digest_check" CHECK ("current_proposal_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "attendance_adjustment_requests_approval_shape" CHECK (
    ("status" = 'APPROVED' AND "approver_user_id" IS NOT NULL AND "approved_at" IS NOT NULL AND "approved_revision" IS NOT NULL)
    OR
    ("status" <> 'APPROVED' AND "approved_at" IS NULL)
  ),
  CONSTRAINT "attendance_adjustment_requests_rejection_shape" CHECK (
    ("status" = 'REJECTED' AND "rejected_by_user_id" IS NOT NULL AND "rejected_at" IS NOT NULL)
    OR
    ("status" <> 'REJECTED' AND "rejected_at" IS NULL)
  )
);

CREATE INDEX "attendance_adjustment_requests_assignment_created_idx"
  ON "attendance_adjustment_requests"("shift_assignment_id", "created_at" DESC);
CREATE INDEX "attendance_adjustment_requests_status_created_idx"
  ON "attendance_adjustment_requests"("status", "created_at" DESC);
CREATE INDEX "attendance_adjustment_requests_maker_created_idx"
  ON "attendance_adjustment_requests"("maker_user_id", "created_at" DESC);

CREATE TABLE "attendance_adjustment_revisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "request_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "before_snapshot" JSONB NOT NULL,
  "before_digest" CHAR(64) NOT NULL,
  "proposal" JSONB NOT NULL,
  "proposal_digest" CHAR(64) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "submitted_by_user_id" UUID NOT NULL,
  "submitted_by_role_snapshot" VARCHAR(50) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_adjustment_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_adjustment_revisions_request_fkey" FOREIGN KEY ("request_id") REFERENCES "attendance_adjustment_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_adjustment_revisions_submitter_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_adjustment_revisions_request_revision_key" UNIQUE ("request_id", "revision"),
  CONSTRAINT "attendance_adjustment_revisions_revision_positive" CHECK ("revision" > 0),
  CONSTRAINT "attendance_adjustment_revisions_reason_nonempty" CHECK (length(btrim("reason")) >= 5),
  CONSTRAINT "attendance_adjustment_revisions_before_digest_check" CHECK ("before_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "attendance_adjustment_revisions_proposal_digest_check" CHECK ("proposal_digest" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "attendance_adjustment_revisions_request_created_idx"
  ON "attendance_adjustment_revisions"("request_id", "created_at");

CREATE TABLE "attendance_adjustment_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "request_id" UUID NOT NULL,
  "event_type" VARCHAR(40) NOT NULL,
  "revision" INTEGER NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "actor_role_snapshot" VARCHAR(50) NOT NULL,
  "comment" VARCHAR(1000),
  "before_snapshot" JSONB,
  "after_snapshot" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_adjustment_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_adjustment_events_request_fkey" FOREIGN KEY ("request_id") REFERENCES "attendance_adjustment_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_adjustment_events_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_adjustment_events_type_check" CHECK ("event_type" IN ('CREATED', 'REVISED', 'SUBMITTED', 'RETURNED', 'REJECTED', 'APPROVED', 'CANCELLED')),
  CONSTRAINT "attendance_adjustment_events_revision_positive" CHECK ("revision" > 0)
);

CREATE INDEX "attendance_adjustment_events_request_created_idx"
  ON "attendance_adjustment_events"("request_id", "created_at");

ALTER TABLE "attendance_corrections"
  ADD COLUMN "source_adjustment_request_id" UUID,
  ADD COLUMN "source_adjustment_revision" INTEGER,
  ADD COLUMN "approved_by_user_id" UUID,
  ADD COLUMN "approved_at" TIMESTAMPTZ,
  ADD CONSTRAINT "attendance_corrections_adjustment_request_fkey" FOREIGN KEY ("source_adjustment_request_id") REFERENCES "attendance_adjustment_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_corrections_approver_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_corrections_adjustment_revision_positive" CHECK ("source_adjustment_revision" IS NULL OR "source_adjustment_revision" > 0),
  ADD CONSTRAINT "attendance_corrections_adjustment_approval_shape" CHECK (
    ("source_adjustment_request_id" IS NULL AND "source_adjustment_revision" IS NULL AND "approved_by_user_id" IS NULL AND "approved_at" IS NULL)
    OR
    ("source_adjustment_request_id" IS NOT NULL AND "source_adjustment_revision" IS NOT NULL AND "approved_by_user_id" IS NOT NULL AND "approved_at" IS NOT NULL)
  );

CREATE UNIQUE INDEX "attendance_corrections_adjustment_request_event_key"
  ON "attendance_corrections"("source_adjustment_request_id", "event_type")
  WHERE "source_adjustment_request_id" IS NOT NULL;
