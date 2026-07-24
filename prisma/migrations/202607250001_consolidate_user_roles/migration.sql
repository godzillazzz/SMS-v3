-- Aligns SMS v3 roles with the legacy administration model.
-- Existing USER accounts become VIEWER; any legacy HR account becomes MANAGER.
ALTER TYPE "UserRole" RENAME TO "UserRole_legacy";
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'VIEWER');

ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "UserRole"
  USING (
    CASE "role"::text
      WHEN 'HR' THEN 'MANAGER'
      WHEN 'USER' THEN 'VIEWER'
      ELSE "role"::text
    END
  )::"UserRole";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'VIEWER';

DROP TYPE "UserRole_legacy";
