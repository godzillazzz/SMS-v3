-- Manual rollback for 202610310001_announcements (run only with Owner approval).
-- Drops only the announcements table; no other table is touched.
BEGIN;
DROP TABLE IF EXISTS "announcements";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '202610310001_announcements';
COMMIT;
