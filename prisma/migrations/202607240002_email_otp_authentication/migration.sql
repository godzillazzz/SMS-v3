-- Stores only hashed OTP values and hashed email lookup keys. Raw OTPs are never persisted.
CREATE TYPE "AuthOtpPurpose" AS ENUM ('REGISTRATION', 'PASSWORD_RESET');

CREATE TABLE "auth_otp_challenges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "email_hash" CHAR(64) NOT NULL,
  "purpose" "AuthOtpPurpose" NOT NULL,
  "code_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "consumed_at" TIMESTAMP(3),
  "delivery_state" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_otp_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_otp_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "auth_otp_challenges_email_hash_purpose_created_at_idx" ON "auth_otp_challenges"("email_hash", "purpose", "created_at");
CREATE INDEX "auth_otp_challenges_expires_at_idx" ON "auth_otp_challenges"("expires_at");
