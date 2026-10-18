-- OWNER policy (18 Oct 2026): multi-level attendance adjustment approval.
-- Employee submits -> any SUPERVISOR reviews -> any MANAGER reviews -> ADMIN approves.
-- Extends the status CHECK constraint with the three staged pending values; the legacy
-- PENDING_APPROVAL value is retained so existing rows stay valid.
ALTER TABLE "attendance_adjustment_requests"
  DROP CONSTRAINT IF EXISTS "attendance_adjustment_requests_status_check";

ALTER TABLE "attendance_adjustment_requests"
  ADD CONSTRAINT "attendance_adjustment_requests_status_check"
  CHECK ("status" IN (
    'DRAFT',
    'PENDING_APPROVAL',
    'PENDING_SUPERVISOR',
    'PENDING_MANAGER',
    'PENDING_ADMIN',
    'RETURNED_FOR_CORRECTION',
    'APPROVED',
    'REJECTED'
  ));

-- The audit trail needs a REVIEWED event for each stage hand-off.
ALTER TABLE "attendance_adjustment_events"
  DROP CONSTRAINT IF EXISTS "attendance_adjustment_events_type_check";

ALTER TABLE "attendance_adjustment_events"
  ADD CONSTRAINT "attendance_adjustment_events_type_check"
  CHECK ("event_type" IN (
    'CREATED',
    'REVISED',
    'SUBMITTED',
    'REVIEWED',
    'RETURNED',
    'REJECTED',
    'APPROVED',
    'CANCELLED'
  ));
