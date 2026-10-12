# R6-B Protected exact-deployment isolation attestation

## Current limitation

This PR adds trusted-main-only, Owner-comment-triggered, Hosted UAT protected,
GET-only **fail-closed** attestation controls and unit tests. It does not change
Integration, PR #611, Production, credentials, SQL grants, Storage, or deployments.
**Do not dispatch the protected workflow merely because the PR exists.**

- Pinned Integration: `fix/serverless-database-reliability` at
  `eeeb7cea92357c7d34500fbc74c8e3087e9849c5`, READY Preview
  `dpl_yhs6Z4CUHingjrDh1tM8d7wWpNRz`, CI #38190536543 success.
- Approved intended Preview provider: Supabase `sms-v3-preview` project
  `ezxanpfagitckpfsnflp`; private bucket `license-documents-g05-preview`.
- Frozen Production deployment: `dpl_Hjo1fTmgjEdmg5G7fZBX9gssenQP`,
  SHA `77641a2657aa4fd05276afe645dd32648f5cc56b`.
- Existing pinned deployment has **no reviewed sanitized runtime endpoint** for
  effective Database/Storage project identities. `database=ok` from readiness
  and Vercel environment-variable *metadata* are insufficient.
- Production database/Storage identities are not independently approved.
  Therefore the current script must fail closed with `UNVERIFIED`.
- Separately: 35 public tables have RLS disabled and broad API grants.
  UAT writes remain HOLD even if isolation eventually passes.

## Review and later execution requirements

1. Separate Owner merge approval, successful exact-head CI and code review.
   The PR does not trigger protected execution.
2. Trusted protected `main`, exact Owner issue comment on Issue #614,
   non-PR issue, first attempt, and pinned Integration head/CI.
3. GitHub `Hosted UAT` Environment human Owner reviewer, bypass disabled,
   branch allowlist containing only `main`.
4. Immutable Vercel Preview deployment ID/SHA/ref/project/host, frozen
   Production deployment and both aliases all verified before data checks.
5. GET-only `api/v1/ready` plus a nonce-bound source-reviewed **runtime**
   endpoint (`api/v1/ops/preview-isolation-attestation`). The endpoint must
   compute its receipt from actual effective runtime connection strings and
   an executed read-only database check, plus storage private bucket GET
   using effective service-role credential. **No such endpoint is implemented
   by this PR or currently deployed.** Only sanitize non-secret project refs,
   boolean checks and nonce; never return raw URLs, secrets, database rows.
6. A source-reviewed preview-only implementation and new deployment will
   need a separate change and approval. The pinned SHA/deployment in this
   verifier must then be reviewed and updated. Never relabel metadata-only
   evidence as exact-runtime proof.
7. Production DB and Storage provider project refs must come from separately
   confirmed Provider records; provide non-secret protected Environment variables
   `APPROVED_PRODUCTION_DB_REF` and `APPROVED_PRODUCTION_STORAGE_REF`.
   Any absence, ambiguity or collision with Preview => `UNVERIFIED`.
8. Source-approved runtime probe checksum/SHA must be explicitly reviewed;
   set `RUNTIME_PROBE_SOURCE_REVIEW_APPROVED` to exact deployed Integration SHA
   only AFTER implementing and validating the probe.
9. No migrations, `prisma migrate resolve`, DB/Storage mutations, policy
   changes, UAT credentials, production secrets or Production deployment.

**Proposed Owner-only issue command, NOT AUTHORIZED to run now:**

`/sms-v3-r6b-exact-isolation-attestation-20261012`

The command would be posted as an exact comment on Issue #614 only after
Owner merge approval, a reviewed probe on a new Preview deployment, separately
approved Production provider identity inputs, and Hosted UAT human approval.

Until all gates truly pass: `DATABASE_ISOLATION=UNVERIFIED`,
`STORAGE_ISOLATION=UNVERIFIED`, `RLS_SECURITY=HOLD`,
`HOSTED_UAT_READY=NO`, `R6_B_RELEASE=HOLD`.

## Non-goals

No new paid resources, no additional routine feature branch, no alias changes,
no candidate #611 merge, no frozen Integration rewrite, no delete of historical
release/rollback/PR branches. Evidence archive: Issue #614.
