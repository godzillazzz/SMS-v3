ALTER TABLE "attendance_events"
  ALTER COLUMN "face_verification_session_id" DROP NOT NULL;

ALTER TABLE "attendance_events"
  ADD CONSTRAINT "attendance_events_verification_provenance_check"
  CHECK (
    ("provenance" = 'ONLINE' AND "face_verification_session_id" IS NOT NULL)
    OR
    ("provenance" = 'GPS_ONLY_UAT' AND "face_verification_session_id" IS NULL)
  );