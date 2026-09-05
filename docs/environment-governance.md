# SMS V3 Environment Governance

This document is the non-secret operating contract for `sms-v3-staging`.
Secret values remain in an Owner-controlled recoverable secret source and in
the deployment destination. They must never be written to Git, CI output,
PR text, screenshots, `MASTER_HANDOFF.md`, or chat.

The complete source-derived variable inventory remains in
[`DEPLOYMENT_ENVIRONMENT_MATRIX.md`](./DEPLOYMENT_ENVIRONMENT_MATRIX.md).
The machine-readable release contract is
[`config/environment-contract.json`](../config/environment-contract.json),
validated by `scripts/ci/verify-environment-contract.js`.

## Authority model

| Environment | Database authority | CORS authority | Branch override | Migration rule |
| --- | --- | --- | --- | --- |
| Production | One Production-only database target with `APPROVED_DATABASE_TARGET_FINGERPRINT` | Explicit canonical/Owner-approved origins; no wildcard and no automatic immutable-host trust | Forbidden | `RUN_MIGRATIONS` must be explicit; default release is `false` |
| Preview | One project-level isolated non-Production target with `APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT` | Explicit origins plus the deployment's validated `VERCEL_URL` / `VERCEL_BRANCH_URL` when `VERCEL_ENV=preview` | Optional exception only; never required for ordinary/unbranched Preview | Always `false` for visual-witness staging |
| Development | Local or explicitly approved development target | Local/development allowlist | Not a normal dependency | Explicit operator choice |

Preview is not allowed to fall back to Production. A Preview deployment must
pass deployment readiness, `/api/v1/health`, `/api/v1/ready`, auth-function
initialization, Preview-origin CORS, and root/bundle checks before an
authenticated visual witness is used.

## Owner-facing variable matrix

| Variable | Purpose | Master source | Vercel scope | Production / Preview / Development | Shared? | Branch override allowed? | Sensitive? | Runtime required? | Owner / governance notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | Application database runtime connection | Recoverable Owner secret manager or provider credentials | Project-level Production and project-level Preview | Production DB / isolated Preview DB / local development | No | Preview exception only | Yes | Yes | Project-specific; never copy Production credentials to Preview |
| `DIRECT_URL` | Prisma direct/session connection | Recoverable Owner secret manager or provider credentials | Project-level Production and project-level Preview | Production DB / isolated Preview DB / local development | No | Preview exception only | Yes | Yes | Must identify the same logical database as `DATABASE_URL` |
| `SUPABASE_URL` | Private storage endpoint | Owner secret manager or Supabase project settings | Project-specific | Production and representative Preview as needed / local optional | No | No | No | Production | Do not use a Shared variable by default |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only private storage access | Owner password manager or Supabase project settings | Project-specific | Production and representative Preview as needed / local optional | No | No | Yes | Production | Never expose to browser or logs |
| `JWT_SECRET` | Session/JWT signing key | Recoverable Owner secret manager | Project-specific | Distinct Production / Preview / local values | No | Preview exception only | Yes | Yes | Minimum 32 characters; do not reuse across deployed environments |
| `CORS_ORIGIN` | Credentialed browser origin allowlist | Repository policy plus Owner-approved config | Project-specific | Explicit Production / explicit Preview + own Vercel origin / local | No | Preview exception only | No | Yes | Wildcard is forbidden; Production immutable aliases are not auto-trusted |
| `APPROVED_DATABASE_TARGET_FINGERPRINT` | Non-secret Production DB identity guard | Owner-approved release record | Production only | Production / not applicable / not applicable | No | No | No | Release | SHA-256 logical target fingerprint, never a credential |
| `APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT` | Non-secret isolated Preview DB identity guard | Owner-approved Preview record | Preview only | Not applicable / Preview / not applicable | No | No | No | Preview release | Must not equal the Production fingerprint |
| `RUN_MIGRATIONS` | Explicit release migration policy | Approved release manifest/workflow input | Release workflow only | Explicit / `false` / operator choice | No | No | No | Release | No silent migration; DB changes are separately governed |

All other source-validated variables (OTP, alerting, WebAuthn, Face runtime
flags, rate limiting, cookie settings, storage buckets, and operational
controls) are listed in the source-derived matrix. Their sensitive values
remain project-bound unless a separate Owner decision explicitly approves a
shared topology.

## Secret master policy

Vercel Sensitive Environment Variables are write-only deployment destinations:
current values are not a recoverable master copy after saving. For each
business-critical secret, the Owner must be able to recover the value from an
approved password manager, Supabase/project credentials, or organizational
secret manager. If that source cannot be proven, environment mutation is
blocked rather than guessed.

## Branch overrides and current deviation

The documented `feature/approval-workflow-standard-v1` Preview database
override is an exception. It may remain for intentionally isolated branch
work, but normal unbranched Preview must not depend on it. The project-level
Preview database target and its non-secret fingerprint still require an
Owner-managed re-entry from a recoverable source; this source hardening does
not copy, delete, or reveal any secret.

## Linux artifact policy

Any Vercel `--prebuilt` artifact destined for a Linux serverless runtime must
be built on Linux and pass the Linux x64 `sharp`/libvips load and artifact
checks. Windows, Darwin, musl, or non-x64 native sharp packages fail closed.
The guard is generic and is not limited to the historical `sharp-win32-x64`
incident.

## Release preflight responsibilities

- Pull only the selected environment and verify project/team identity.
- Validate exact source SHA/tree and explicit `RUN_MIGRATIONS` policy.
- Validate required variable names and database target structure without
  printing secrets.
- Validate CORS semantics for the selected environment.
- Build and verify Linux native artifacts on a Linux runner.
- Require Preview health/readiness/CORS before authenticated visual QA.
- Require exact Production source, artifact, rollback, environment, and Owner
  promotion gates before canonical alias movement.

The hardening work does not mutate Vercel variables, databases, or the
canonical alias. Preview secret re-entry and any deletion/cleanup of old
environment rows remain separate Owner decisions.

## Production sensitive deployment-destination verification boundary

Production release control must not require Vercel to reveal write-only Sensitive values. The Owner-controlled protected GitHub environment is the recoverable release-time master for `DATABASE_URL` and `DIRECT_URL`; the Vercel project remains the deployment destination.

The governed Production release path separates the checks accordingly:

- Vercel control-plane metadata must contain exactly one project-level Production row for every required Production variable. `DATABASE_URL` and `DIRECT_URL` must remain Vercel Sensitive.
- The protected GitHub Production `DATABASE_URL` and `DIRECT_URL` are verified in memory against `APPROVED_DATABASE_TARGET_FINGERPRINT`; raw connection values are never printed.
- A legacy Production `CORS_ORIGIN` row may remain Vercel Sensitive until a separately authorized Production environment cleanup. Release control does not downgrade or rewrite it merely to make the control plane readable.
- Before build, canonical Production must prove the governed origin receives credentialed CORS and an untrusted origin is rejected. After explicit promotion, the same trusted/denied CORS checks are part of canonical runtime verification; failure triggers the manifest rollback policy.
- `RUN_MIGRATIONS=false` and `NO_DATABASE_CHANGES` remain mandatory for a no-database-change manifest. This control-plane boundary does not authorize Production environment mutation or database mutation.

## Preview database target verification boundary

Vercel Sensitive Environment Variables are intentionally write-only to the control plane. `DATABASE_URL`, `DIRECT_URL`, and `JWT_SECRET` must remain Sensitive in Preview. A control-plane `vercel env pull` may therefore expose only a `[SENSITIVE]` placeholder and must not be treated as proof that the underlying secret is malformed.

The governed Preview release path separates the checks accordingly:

- Control plane verifies project-level Preview scope, the required variable names, sensitivity classification, readable `CORS_ORIGIN`, readable `APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT`, exact source SHA/tree, no branch dependency, and `RUN_MIGRATIONS=false`.
- `DATABASE_URL` and `DIRECT_URL` remain Sensitive and are not downgraded to readable configuration for CI convenience.
- The actual logical database target is verified inside the Preview runtime, where Vercel supplies the real Sensitive values. `/api/v1/ready` computes the same normalized logical target fingerprint in memory and compares it with `APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT` before issuing the database readiness query.
- A missing, malformed, or mismatched Preview target authority fails readiness with HTTP 503 and a generic environment-validation classification. Raw URLs, hostnames, usernames, passwords, project references, and fingerprint values are not emitted by that failure path.
- The Preview approved fingerprint remains non-sensitive configuration because it is an identifier/guard, not a credential. It must be Owner-derived from the intended isolated non-Production target and must not equal the Production database fingerprint.
- Production readiness behavior and Production database authority are unchanged by the Preview runtime guard.
