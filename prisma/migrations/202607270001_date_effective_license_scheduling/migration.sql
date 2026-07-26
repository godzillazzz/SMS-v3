ALTER TABLE "shift_assignments"
  ADD COLUMN "license_blocked_from_shift_type_id" UUID,
  ADD COLUMN "license_blocked_from_remark" VARCHAR(2000),
  ADD COLUMN "license_blocked_at" TIMESTAMP(3);

CREATE INDEX "shift_assignments_license_blocked_from_shift_type_id_idx"
  ON "shift_assignments"("license_blocked_from_shift_type_id");
