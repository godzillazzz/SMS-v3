# UAT V3 Preview canonical account reset — controlled operator package

**Status: staged only; NOT executed.** The connected database tool rejected Preview account mutation. Do not use another remote dispatch route to bypass that denial. This package is for the repository's approved operator/review process.

## Fixed target and identity

- Preview Supabase project: `ezxanpfagitckpfsnflp` only
- Guard: database name `postgres`, runtime role `postgres`, and provider cluster SHA-256 `a96200459370c855ff978934689acb140b1c8573e623696cd854c76afa72fc76`
- Requires both `DATABASE_URL` and `DIRECT_URL` to identify the Preview project.
- Never target Production `jkexwnlxnxbemwavsebv`.
- No deployment, Vercel environment, Production alias, schema, migration or service-role grant changes.

The four canonical identities are:

| Role | Display name | Exact email | Stable legacy marker |
| --- | --- | --- | --- |
| ADMIN | UAT V3 Admin | `uat-v3-admin@preview.invalid` | `UAT-V3-PREVIEW-ADMIN` |
| MANAGER | UAT V3 Manager | `uat-v3-manager@preview.invalid` | `UAT-V3-PREVIEW-MANAGER` |
| SUPERVISOR | UAT V3 Supervisor | `uat-v3-supervisor@preview.invalid` | `UAT-V3-PREVIEW-SUPERVISOR` |
| VIEWER | UAT V3 Viewer | `uat-v3-viewer@preview.invalid` | `UAT-V3-PREVIEW-VIEWER` |

`.invalid` is intentionally non-deliverable; Hosted UAT authenticates through the application email/password login route. These accounts must not be used for email OTP or real notification testing. Do not attach employee identities to canonical UAT users.

## One-time operator gates

1. Re-audit Preview identities, FK references, and relevant account activity with an approved provider/operator channel. Old UAT accounts have hundreds of references in audit and business history, so **never hard-delete** old users or dependent rows.
2. Independently review script, exact source SHA, target fingerprint and branch protection. Do not treat owner approval as a bypass of a database tool's denied operation.
3. In the authorized secret manager for the Preview-only run, provision exactly the eight `UAT_{ADMIN,MANAGER,SUPERVISOR,VIEWER}_{EMAIL,PASSWORD}` names. Emails must match the table exactly. Passwords are unique, at least 16 characters and never stored in Git, logs or artifacts. If the GitHub `Hosted UAT` environment already has these names, update only mismatched values; never make duplicates. The workflow may additionally require `VERCEL_TOKEN` and `VERCEL_AUTOMATION_BYPASS_SECRET`.
4. Use the approved operator environment to run read-only preflight by default:
   `node scripts/admin/uat-v3-preview-canonical-reset.js`
5. Only after all operator/governance checks are actually passed, a credentialed operator may run:
   `UAT_V3_RESET_CONFIRMATION=RECONCILE_ONLY_PREVIEW_UAT_V3 node scripts/admin/uat-v3-preview-canonical-reset.js --apply`
   **This is an instruction for the authorized operator, not authorization for an agent to bypass a denied provider call.**
6. The transaction creates four canonical role accounts before suspending known legacy test identities, preserves historical FKs/audit/business data, revokes old refresh sessions and increments old token versions. Canonical accounts are no-op on repeat runs. A mismatch on an existing canonical account fails closed instead of silently rotating credentials.
7. Validate read-only post-state: exactly four active canonical identities (distinct user IDs, roles, and credentials), no employee link, old UAT accounts suspended, no active old sessions, guarded Preview DB fingerprint. Then validate four independent Preview logins in the protected Hosted UAT read-only test. Do not claim UAT PASS from mere account provisioning.

## Scope notes

The archive allowlist contains known Preview test display names only: AWV1 UAT Admin/Manager/Manager 2/Viewer, G06 Preview UAT, Preview UAT Admin, and UAT Automation Admin/Manager/Viewer. This intentionally deactivates the older G06/employee-linked UAT fixtures, so dependent test suites must be revalidated. These accounts remain present for historical references but are suspended, and appear as archived records in the access-management UI; the UI does not currently offer an archive-only filter.

The last successful read-only Preview audit found `AWV1 UAT Manager 2` with role SUPERVISOR, but the tool later blocked rechecks. **No mutation success is assumed.** Reverify before running the operator package. Never copy email/password values from Production.

Evidence: T39 isolation run `38678253409`; PR #635 Preview RLS hardening merged at `2a3107fa4282106800f8b265bb877825d258a8ac`; Issue #614 closeout; PR #589 UAT recovery.
