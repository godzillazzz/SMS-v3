-- PERF-05: additive indexes for approval/leave hot paths observed in current Production code.
-- This migration is a source candidate only until separately authorized for Production execution.

CREATE INDEX "users_account_status_requested_at_created_at_idx"
  ON "users"("account_status", "requested_at", "created_at");

CREATE INDEX "attendance_device_change_requests_status_created_at_idx"
  ON "attendance_device_change_requests"("status", "created_at");

CREATE INDEX "employee_reference_photos_status_uploaded_at_idx"
  ON "employee_reference_photos"("status", "uploaded_at");

CREATE INDEX "employee_license_documents_status_uploaded_at_idx"
  ON "employee_license_documents"("status", "uploaded_at");

CREATE INDEX "leave_requests_status_requested_at_idx"
  ON "leave_requests"("status", "requested_at");
