-- Manual rollback for 202610300001_patrol_checkpoints (run only with Owner approval).
-- Drops only the two Patrol tables. Patrol photos in object storage must be handled separately.
BEGIN;
DROP TABLE IF EXISTS "patrol_scans";
DROP TABLE IF EXISTS "patrol_checkpoints";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '202610300001_patrol_checkpoints';
COMMIT;
