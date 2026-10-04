ALTER TABLE public."attendance_events"
  ADD COLUMN "punctuality" VARCHAR(16),
  ADD COLUMN "checkout_condition" VARCHAR(24),
  ADD COLUMN "time_policy_snapshot" JSONB,
  ADD CONSTRAINT "attendance_events_punctuality_check"
    CHECK ("punctuality" IS NULL OR "punctuality" IN ('ON_TIME', 'LATE')),
  ADD CONSTRAINT "attendance_events_checkout_condition_check"
    CHECK ("checkout_condition" IS NULL OR "checkout_condition" IN ('NORMAL', 'EARLY_LEAVE'));

ALTER TABLE public."attendance_pending_events"
  ADD COLUMN "time_policy_snapshot" JSONB;

CREATE TABLE public."attendance_time_policies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scope_type" VARCHAR(20) NOT NULL,
  "site_id" UUID,
  "shift_type_id" UUID,
  "policy" JSONB NOT NULL,
  "effective_from" TIMESTAMPTZ NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_time_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_time_policies_scope_check" CHECK (
    ("scope_type" = 'COMPANY' AND "site_id" IS NULL AND "shift_type_id" IS NULL)
    OR ("scope_type" = 'SITE' AND "site_id" IS NOT NULL AND "shift_type_id" IS NULL)
    OR ("scope_type" = 'SHIFT_TYPE' AND "site_id" IS NULL AND "shift_type_id" IS NOT NULL)
  ),
  CONSTRAINT "attendance_time_policies_values_check" CHECK (
    CASE
      WHEN jsonb_typeof("policy") <> 'object'
        OR NOT ("policy" ?& ARRAY[
          'lateGraceMinutes', 'earliestCheckInEnabled', 'earliestCheckInMinutesBeforeStart',
          'latestCheckInEnabled', 'latestCheckInMinutesAfterStart', 'earliestCheckOutEnabled',
          'earliestCheckOutMinutesAfterStart', 'latestCheckOutEnabled', 'latestCheckOutMinutesAfterEnd',
          'earlyLeaveEnabled', 'earlyCheckoutToleranceMinutes', 'missingCheckoutEnabled',
          'missingCheckoutAfterMinutes', 'maxShiftDurationEnabled', 'maxShiftDurationMinutes'
        ])
      THEN false
      ELSE
        jsonb_typeof("policy"->'lateGraceMinutes') = 'number'
        AND ("policy"->>'lateGraceMinutes')::numeric = trunc(("policy"->>'lateGraceMinutes')::numeric)
        AND ("policy"->>'lateGraceMinutes')::numeric BETWEEN 0 AND 360
        AND jsonb_typeof("policy"->'earliestCheckInEnabled') = 'boolean'
        AND jsonb_typeof("policy"->'earliestCheckInMinutesBeforeStart') = 'number'
        AND ("policy"->>'earliestCheckInMinutesBeforeStart')::numeric = trunc(("policy"->>'earliestCheckInMinutesBeforeStart')::numeric)
        AND ("policy"->>'earliestCheckInMinutesBeforeStart')::numeric BETWEEN 0 AND 720
        AND jsonb_typeof("policy"->'latestCheckInEnabled') = 'boolean'
        AND jsonb_typeof("policy"->'earliestCheckOutEnabled') = 'boolean'
        AND jsonb_typeof("policy"->'earliestCheckOutMinutesAfterStart') = 'number'
        AND ("policy"->>'earliestCheckOutMinutesAfterStart')::numeric = trunc(("policy"->>'earliestCheckOutMinutesAfterStart')::numeric)
        AND ("policy"->>'earliestCheckOutMinutesAfterStart')::numeric BETWEEN 0 AND 2880
        AND jsonb_typeof("policy"->'latestCheckOutEnabled') = 'boolean'
        AND jsonb_typeof("policy"->'earlyLeaveEnabled') = 'boolean'
        AND jsonb_typeof("policy"->'earlyCheckoutToleranceMinutes') = 'number'
        AND ("policy"->>'earlyCheckoutToleranceMinutes')::numeric = trunc(("policy"->>'earlyCheckoutToleranceMinutes')::numeric)
        AND ("policy"->>'earlyCheckoutToleranceMinutes')::numeric BETWEEN 0 AND 720
        AND jsonb_typeof("policy"->'missingCheckoutEnabled') = 'boolean'
        AND jsonb_typeof("policy"->'missingCheckoutAfterMinutes') = 'number'
        AND ("policy"->>'missingCheckoutAfterMinutes')::numeric = trunc(("policy"->>'missingCheckoutAfterMinutes')::numeric)
        AND ("policy"->>'missingCheckoutAfterMinutes')::numeric BETWEEN 0 AND 1440
        AND jsonb_typeof("policy"->'maxShiftDurationEnabled') = 'boolean'
        AND (
          (jsonb_typeof("policy"->'latestCheckInMinutesAfterStart') = 'null'
            AND "policy"->>'latestCheckInEnabled' = 'false')
          OR (jsonb_typeof("policy"->'latestCheckInMinutesAfterStart') = 'number'
            AND ("policy"->>'latestCheckInMinutesAfterStart')::numeric = trunc(("policy"->>'latestCheckInMinutesAfterStart')::numeric)
            AND ("policy"->>'latestCheckInMinutesAfterStart')::numeric BETWEEN 0 AND 1440)
        )
        AND (
          (jsonb_typeof("policy"->'latestCheckOutMinutesAfterEnd') = 'null'
            AND "policy"->>'latestCheckOutEnabled' = 'false')
          OR (jsonb_typeof("policy"->'latestCheckOutMinutesAfterEnd') = 'number'
            AND ("policy"->>'latestCheckOutMinutesAfterEnd')::numeric = trunc(("policy"->>'latestCheckOutMinutesAfterEnd')::numeric)
            AND ("policy"->>'latestCheckOutMinutesAfterEnd')::numeric BETWEEN 0 AND 1440)
        )
        AND (
          (jsonb_typeof("policy"->'maxShiftDurationMinutes') = 'null'
            AND "policy"->>'maxShiftDurationEnabled' = 'false')
          OR (jsonb_typeof("policy"->'maxShiftDurationMinutes') = 'number'
            AND ("policy"->>'maxShiftDurationMinutes')::numeric = trunc(("policy"->>'maxShiftDurationMinutes')::numeric)
            AND ("policy"->>'maxShiftDurationMinutes')::numeric BETWEEN 60 AND 2880)
        )
        AND NOT (
          "policy"->>'latestCheckInEnabled' = 'true'
          AND ("policy"->>'latestCheckInMinutesAfterStart')::numeric < ("policy"->>'lateGraceMinutes')::numeric
        )
        AND NOT (
          "policy"->>'maxShiftDurationEnabled' = 'true'
          AND "policy"->>'earliestCheckOutEnabled' = 'true'
          AND ("policy"->>'earliestCheckOutMinutesAfterStart')::numeric >= ("policy"->>'maxShiftDurationMinutes')::numeric
        )
    END
  ),
  CONSTRAINT "attendance_time_policies_site_fkey"
    FOREIGN KEY ("site_id") REFERENCES public."security_sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_time_policies_shift_type_fkey"
    FOREIGN KEY ("shift_type_id") REFERENCES public."shift_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_time_policies_created_by_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES public."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "attendance_time_policies_company_effective_idx"
  ON public."attendance_time_policies"("effective_from" DESC)
  WHERE "scope_type" = 'COMPANY' AND "site_id" IS NULL AND "shift_type_id" IS NULL;
CREATE UNIQUE INDEX "attendance_time_policies_company_effective_key"
  ON public."attendance_time_policies"("effective_from")
  WHERE "scope_type" = 'COMPANY' AND "site_id" IS NULL AND "shift_type_id" IS NULL;
CREATE INDEX "attendance_time_policies_site_effective_idx"
  ON public."attendance_time_policies"("site_id", "effective_from" DESC)
  WHERE "scope_type" = 'SITE';
CREATE UNIQUE INDEX "attendance_time_policies_site_effective_key"
  ON public."attendance_time_policies"("site_id", "effective_from")
  WHERE "scope_type" = 'SITE';
CREATE INDEX "attendance_time_policies_shift_effective_idx"
  ON public."attendance_time_policies"("shift_type_id", "effective_from" DESC)
  WHERE "scope_type" = 'SHIFT_TYPE';
CREATE UNIQUE INDEX "attendance_time_policies_shift_effective_key"
  ON public."attendance_time_policies"("shift_type_id", "effective_from")
  WHERE "scope_type" = 'SHIFT_TYPE';
CREATE INDEX "attendance_time_policies_created_by_created_idx"
  ON public."attendance_time_policies"("created_by_user_id", "created_at");

ALTER TABLE public."attendance_time_policies" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public."attendance_time_policies" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public."attendance_time_policies" FROM authenticated';
  END IF;
END;
$$;
