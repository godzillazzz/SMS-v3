-- Announcements (Owner batch 12 B). Additive only: creates one new table; no existing table,
-- column or row is changed. created_by/updated_by are set by the API and kept without foreign keys so
-- the migration never locks or alters users. Every signed-in user reads all announcements (no site scope).
--
-- ROLLBACK (manual, Owner approval only; see rollback.sql):
--   BEGIN;
--   DROP TABLE IF EXISTS "announcements";
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '202610310001_announcements';
--   COMMIT;
BEGIN;

CREATE TABLE "announcements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(150) NOT NULL,
    "body" TEXT NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "announcements_category_check" CHECK ("category" IN ('GENERAL', 'POLICY', 'EVENT'))
);

CREATE INDEX "announcements_deleted_at_pinned_created_at_idx" ON "announcements"("deleted_at", "pinned", "created_at");
CREATE INDEX "announcements_category_expires_at_idx" ON "announcements"("category", "expires_at");

COMMIT;
