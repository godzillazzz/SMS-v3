-- Attendance Shift runtime settings extend ShiftType without rewriting historical assignments.
CREATE TABLE "attendance_shift_type_settings" (
  "shift_type_id" UUID NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_shift_type_settings_pkey" PRIMARY KEY ("shift_type_id"),
  CONSTRAINT "attendance_shift_type_settings_shift_type_fkey" FOREIGN KEY ("shift_type_id") REFERENCES "shift_types"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "attendance_shift_type_settings" ("shift_type_id", "is_active")
SELECT "id", TRUE FROM "shift_types"
ON CONFLICT ("shift_type_id") DO NOTHING;

CREATE INDEX "attendance_shift_type_settings_active_idx"
  ON "attendance_shift_type_settings"("is_active", "shift_type_id");
