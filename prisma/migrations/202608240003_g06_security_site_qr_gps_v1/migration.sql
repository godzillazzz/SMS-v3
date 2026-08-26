CREATE TABLE "security_sites" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "latitude" DECIMAL(10,7) NOT NULL,
  "longitude" DECIMAL(10,7) NOT NULL,
  "geofence_radius_meters" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "security_sites_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "security_sites"
  ADD CONSTRAINT "security_sites_latitude_range" CHECK ("latitude" >= -90 AND "latitude" <= 90),
  ADD CONSTRAINT "security_sites_longitude_range" CHECK ("longitude" >= -180 AND "longitude" <= 180),
  ADD CONSTRAINT "security_sites_geofence_radius_positive" CHECK ("geofence_radius_meters" > 0);

CREATE UNIQUE INDEX "security_sites_code_key" ON "security_sites"("code");
CREATE INDEX "security_sites_is_active_code_idx" ON "security_sites"("is_active", "code");

CREATE TABLE "security_site_qr_credentials" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "security_site_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "version" INTEGER NOT NULL,
  "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "valid_until" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_site_qr_credentials_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "security_site_qr_credentials"
  ADD CONSTRAINT "security_site_qr_credentials_token_hash_format" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "security_site_qr_credentials_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "security_site_qr_credentials_valid_window" CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from");

CREATE UNIQUE INDEX "security_site_qr_credentials_token_hash_key" ON "security_site_qr_credentials"("token_hash");
CREATE UNIQUE INDEX "security_site_qr_credentials_security_site_id_version_key" ON "security_site_qr_credentials"("security_site_id", "version");
CREATE INDEX "security_site_qr_credentials_site_validity_idx" ON "security_site_qr_credentials"("security_site_id", "revoked_at", "valid_from", "valid_until");

ALTER TABLE "shift_assignments" ADD COLUMN "security_site_id" UUID;
CREATE INDEX "shift_assignments_security_site_id_work_date_idx" ON "shift_assignments"("security_site_id", "work_date");

ALTER TABLE "security_site_qr_credentials"
  ADD CONSTRAINT "security_site_qr_credentials_security_site_id_fkey"
  FOREIGN KEY ("security_site_id") REFERENCES "security_sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shift_assignments"
  ADD CONSTRAINT "shift_assignments_security_site_id_fkey"
  FOREIGN KEY ("security_site_id") REFERENCES "security_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
