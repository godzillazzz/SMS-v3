# Legacy SMS data migration

## Status

The migration implementation is prepared, the source-only dry run passes, and a complete rehearsal against a disposable local PostgreSQL 16 container passes. The rehearsal applied all six migrations, imported the approved export, verified aggregate counts and foreign keys, ran seven PostgreSQL integration tests, confirmed source counts were unchanged after the tests, and removed the container. No Supabase or other persistent database migration/data import has been executed by this work. Applying the schema and importing personal data require a separate, explicit approval for the named target database.

The source CSV directory must remain outside the Git repository. The importer refuses a source directory inside the repository and never copies source files into the project.

## Dry-run inventory

| Dataset | Rows | Destination |
| --- | ---: | --- |
| Employees | 63 | `employees` |
| Users | 39 | `users` |
| Shift types | 6 | `shift_types` |
| Schedule history | 2,193 | `shift_assignments` |
| Employee licenses | 63 | `employee_licenses` |
| Leave history | 1 | `leave_requests` |
| Leave quotas | 68 | `leave_quotas` |
| Schedule approvals | 4 | `schedule_approvals` |
| Schedule approval events | 224 | `schedule_approval_events` |
| User audit events | 70 | `legacy_user_audit_events` |
| License audit events | 83 | `legacy_license_audit_events` |
| Scheduling rules | 9 | `scheduling_rules` |
| Safe settings | 4 | `system_settings` |

Dashboard rows are derived metrics and are intentionally recalculated rather than imported.

One external-URL setting is excluded so a legacy endpoint is not activated in the new runtime. All 63 license document references point to Google-hosted files; the references are preserved with `LEGACY_REFERENCE_PENDING`, but no new workflow consumes them. The linked documents must be copied into approved non-Google storage and verified before that migration status can be cleared. The one leave attachment reference is handled with the same pending status.

## Identity and role mapping

- Legacy employee IDs are preserved in `legacy_employee_id` and are also used as the initial employee code.
- The exact legacy display name is preserved. `first_name` and `last_name` are derived only for compatibility with the current Employee API.
- Legacy user IDs, account status, department, approval metadata, employee link, last-login timestamp and original role label are preserved.
- `Admin` maps to `ADMIN`, `Manager` to `MANAGER`, and `Viewer` to `VIEWER`.
- A blank role is allowed only for a `Pending` account. It maps to inactive `USER` while preserving the blank legacy role and `PENDING` account status.
- `MANAGER` receives the current employee create/update capability and safe user-list access. Destructive employee deletion remains Admin-only.
- `VIEWER` receives the same redacted employee representation as a basic `USER` account.

## Password safety

The legacy password hashes are SHA-256 values created with a system-specific pepper. They are not suitable for direct use by the bcrypt-based backend and are deliberately not imported.

Every imported user receives an unusable random bcrypt hash and `password_reset_required=true`. Login, refresh and access-token authentication reject such an account until a reviewed password-reset/activation workflow replaces the hash and clears the flag. Account identities, statuses and permissions are still preserved.

## Data-quality findings

- Employee IDs, user IDs, user emails, shift codes and license IDs have no duplicates.
- Every schedule row references a known employee and shift type.
- Schedule dates use day/month/year and cover the exported history without invalid dates.
- Schedule approval history contains multiple revisions for a month; the destination therefore uses `(month, revision)` as its unique key.
- Four quota rows do not match an Employee row by normalized full name.
- Four quota rows belong to duplicated-name groups. They are preserved and marked with a match status; no quota value is discarded or silently assigned.
- The single leave-history row matches exactly one employee.

The unmatched/duplicate quota rows require owner review before production cutover. They do not prevent preservation of the source rows, but they do prevent claiming that every quota is attached to the correct employee.

## Safety controls

- Dry run is the default mode and never creates a Prisma Client.
- Apply mode requires both `--apply` and `LEGACY_MIGRATION_ALLOW_WRITE=true`.
- Apply mode requires a matching local/staging target confirmation and refuses a production target.
- Apply mode refuses pre-populated legacy destination tables or conflicting employee/user identities.
- The import runs in one Prisma transaction.
- Post-import counts are verified in the same transaction; a mismatch rolls back all writes.
- Source password hashes are validated by format and then discarded.
- Console output contains aggregate counts only; it never prints source rows, identities, passwords, hashes, URLs or database credentials.
- Input folders are covered by explicit `.gitignore` rules as an additional guard.
- Prisma errors are reduced to a fixed stage/category and cannot print a source payload.
- PostgreSQL integration-test cleanup is limited to test fixture identities and `TEST-*` employees; it no longer deletes every user or employee in the database.

## Local rehearsal result

- Prisma migration deploy: PASS
- Prisma migration status: up to date (6 migrations)
- Legacy import transaction: PASS
- Aggregate row-count verification: PASS
- Shift, license and leave foreign-key orphan counts: 0
- Imported accounts requiring password reset: 39/39
- Imported password hashes using bcrypt-shaped unusable reset hashes: 39/39
- PostgreSQL integration tests: 7 passed, 0 failed
- Imported employee/user/schedule/leave counts after integration tests: unchanged
- Disposable container cleanup: PASS
- Supabase writes: none

## Commands

Dry run, with the approved source directory supplied locally:

```powershell
npm run migration:legacy:dry-run -- --source "<outside-repository-source-directory>"
```

After a target database is explicitly approved, apply the reviewed Prisma migration using the normal controlled deployment process. Then run the one-time importer from a secure local process:

```powershell
$env:LEGACY_MIGRATION_ALLOW_WRITE = 'true'
$env:LEGACY_MIGRATION_TARGET_CONFIRMATION = 'staging'
npm run migration:legacy:apply -- --source "<outside-repository-source-directory>" --target staging
Remove-Item Env:\LEGACY_MIGRATION_ALLOW_WRITE
Remove-Item Env:\LEGACY_MIGRATION_TARGET_CONFIRMATION
```

Do not put the source path, database URL or any credential in a committed script or report.

## Required cutover verification

1. Confirm an encrypted, restorable backup of the named destination.
2. Confirm the new migration is the only pending Prisma migration.
3. Run the dry run and record aggregate counts.
4. Resolve or formally accept the quota match exceptions.
5. Apply the schema migration once.
6. Run the importer once with the write safety flag.
7. Verify destination counts, foreign keys and the migration audit record.
8. Verify all imported accounts require password reset and cannot authenticate with legacy credentials.
9. Complete an approved password reset for a sample Admin, Manager and Viewer account.
10. Verify employee, schedule, leave, quota, license and approval screens before cutover.

## Remaining application work

This migration restores the data foundation. The current React application still does not reproduce all legacy scheduling, leave, license, report and user-administration screens. Those workflows must be implemented against the new PostgreSQL tables before the new system can be considered a functional replacement for the original SMS.
