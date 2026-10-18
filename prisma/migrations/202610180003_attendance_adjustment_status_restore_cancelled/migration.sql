-- Restores the CANCELLED status that 202610180002 dropped from the status CHECK constraint.
-- additive: widens the accepted value set, touches no rows.
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
    'REJECTED',
    'CANCELLED'
  ));
