-- Adds a first-class Supervisor account role without remapping existing users.
-- Existing MANAGER accounts remain MANAGER until an explicit governed data migration is authorized.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPERVISOR' BEFORE 'VIEWER';

-- Preserve the currently governed LEAVE_REQUEST reviewer roles and append Supervisor once.
-- CFG-06 validates this setting as a JSON array and still requires ADMIN to remain present.
UPDATE "system_settings"
SET "value" = ("value"::jsonb || '["SUPERVISOR"]'::jsonb)::text,
    "description" = 'CFG-06 reviewer roles for LEAVE_REQUEST',
    "updated_at" = NOW()
WHERE "key" = 'APPROVAL_POLICY.LEAVE_REQUEST.REVIEWER_ROLES'
  AND NOT ("value"::jsonb ? 'SUPERVISOR');
