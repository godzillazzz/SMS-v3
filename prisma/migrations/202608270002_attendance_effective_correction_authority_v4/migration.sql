-- Attendance effective-correction authority V4.
-- Defense in depth: a row may be current/effective only when it came from a
-- governed adjustment request and carries explicit ADMIN approval provenance.
-- Historical/superseded rows may remain readable for audit/history.

ALTER TABLE "attendance_corrections"
  ADD CONSTRAINT "attendance_corrections_current_requires_approval" CHECK (
    "is_current" = FALSE
    OR (
      "source_adjustment_request_id" IS NOT NULL
      AND "source_adjustment_revision" IS NOT NULL
      AND "approved_by_user_id" IS NOT NULL
      AND "approved_at" IS NOT NULL
    )
  );
