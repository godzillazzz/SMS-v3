-- SMS Signature Experience V1.2 — additive WebAuthn / Passkey storage only.
-- Production execution is NOT authorized in this phase.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSKEY_REGISTERED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSKEY_LOGIN_SUCCESS';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSKEY_LOGIN_FAILED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSKEY_REVOKED';

CREATE TYPE "WebAuthnChallengePurpose" AS ENUM ('REGISTRATION', 'AUTHENTICATION');

CREATE TABLE "webauthn_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "credential_id" VARCHAR(512) NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" JSONB,
    "device_type" VARCHAR(32),
    "backed_up" BOOLEAN NOT NULL DEFAULT false,
    "display_name" VARCHAR(120) NOT NULL DEFAULT 'Passkey',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webauthn_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purpose" "WebAuthnChallengePurpose" NOT NULL,
    "user_id" UUID,
    "challenge_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webauthn_challenges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webauthn_credentials_credential_id_key" ON "webauthn_credentials"("credential_id");
CREATE INDEX "webauthn_credentials_user_id_revoked_at_idx" ON "webauthn_credentials"("user_id", "revoked_at");
CREATE UNIQUE INDEX "webauthn_challenges_challenge_hash_key" ON "webauthn_challenges"("challenge_hash");
CREATE INDEX "webauthn_challenges_purpose_expires_at_consumed_at_idx" ON "webauthn_challenges"("purpose", "expires_at", "consumed_at");
CREATE INDEX "webauthn_challenges_user_id_purpose_expires_at_idx" ON "webauthn_challenges"("user_id", "purpose", "expires_at");

ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
