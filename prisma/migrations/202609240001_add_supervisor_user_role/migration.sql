-- Adds a first-class Supervisor account role without remapping existing users.
-- Existing MANAGER accounts remain MANAGER until an explicit governed data migration is authorized.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPERVISOR' BEFORE 'VIEWER';

-- SUPERVISOR inherits every configurable reviewer capability available to MANAGER.
-- Preserve each policy's current reviewer roles and append Supervisor once.
UPDATE "system_settings"
SET "value" = ("value"::jsonb || '["SUPERVISOR"]'::jsonb)::text,
    "description" = CASE "key"
      WHEN 'APPROVAL_POLICY.REGISTRATION_REQUEST.REVIEWER_ROLES' THEN 'CFG-06 reviewer roles for REGISTRATION_REQUEST'
      WHEN 'APPROVAL_POLICY.USER_ACCESS.REVIEWER_ROLES' THEN 'CFG-06 reviewer roles for USER_ACCESS'
      ELSE 'CFG-06 reviewer roles for LEAVE_REQUEST'
    END,
    "updated_at" = NOW()
WHERE "key" IN (
  'APPROVAL_POLICY.REGISTRATION_REQUEST.REVIEWER_ROLES',
  'APPROVAL_POLICY.USER_ACCESS.REVIEWER_ROLES',
  'APPROVAL_POLICY.LEAVE_REQUEST.REVIEWER_ROLES'
)
  AND NOT ("value"::jsonb ? 'SUPERVISOR');
