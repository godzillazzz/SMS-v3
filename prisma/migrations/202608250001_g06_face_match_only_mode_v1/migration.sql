CREATE TYPE "FaceVerificationMode" AS ENUM ('FACE_MATCH_ONLY', 'FACE_MATCH_WITH_LIVENESS');

ALTER TABLE "face_verification_sessions"
  ADD COLUMN "verification_mode" "FaceVerificationMode" NOT NULL DEFAULT 'FACE_MATCH_WITH_LIVENESS';

ALTER TABLE "face_verification_receipts"
  ADD COLUMN "verification_mode" "FaceVerificationMode" NOT NULL DEFAULT 'FACE_MATCH_WITH_LIVENESS';

ALTER TABLE "face_verification_sessions"
  DROP CONSTRAINT "face_verification_sessions_verified_state_check";

ALTER TABLE "face_verification_sessions"
  ADD CONSTRAINT "face_verification_sessions_verified_state_check" CHECK (
    "status" NOT IN ('VERIFIED','CONSUMED') OR (
      "device_proof_verified_at" IS NOT NULL AND
      "verified_at" IS NOT NULL AND
      "face_match_passed" IS TRUE AND
      (
        (
          "verification_mode" = 'FACE_MATCH_WITH_LIVENESS' AND
          "pad_passed" IS TRUE AND
          "injection_risk_detected" IS FALSE
        ) OR (
          "verification_mode" = 'FACE_MATCH_ONLY' AND
          "pad_passed" IS NULL AND
          "injection_risk_detected" IS NULL
        )
      )
    )
  );
