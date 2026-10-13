# R6-B — Protected exact-deployment attestation / Receipt v2 (Draft only)

## Review checkpoint

This PR contains a main-only, Owner issue-comment-triggered, protected Hosted UAT,
GET-only fail-closed verifier. It DOES NOT authorize merging, changing secrets,
running a live probe, Protected Workflow dispatch, or any Production operation.

Exact Integration HEAD: e80a1883d1598c035741ca55d9a1fc09061718f9.
Exact GitHub CI: 38324590377 SUCCESS.
Exact Preview: dpl_9FeFnk1yQx8LUsENMA7TR3R8fpwk, READY, target Preview,
project prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s.
Frozen Production: dpl_Hjo1fTmgjEdmg5G7fZBX9gssenQP,
SHA 77641a2657aa4fd05276afe645dd32648f5cc56b.
Canonical Production aliases remain sms-v3-staging-godzillazzz.vercel.app
and sms-v3-staging-ten.vercel.app.

Supabase Preview provider project: ezxanpfagitckpfsnflp. This project record,
a private bucket metadata GET, URL parsing and a read-only DB name check do
NOT prove effective runtime service-role credential issuer/project binding.
Production database and Storage project identity refs lack independent approval.
A dedicated RUNTIME_ISOLATION_PROBE_HMAC_SECRET was not found in the last
reviewed Vercel variable metadata; no secret is set by this PR.

## Contract v2 and signed GET challenge

The runtime and protected verifier share an exact canonical HMAC payload
of seven lines separated by LF:
1. GET
2. /api/v1/ops/preview-isolation-attestation
3. lowercase runtime host
4. exact Vercel deployment ID
5. lowercase Integration application SHA
6. lowercase 32-hex nonce
7. issuedAt in milliseconds.

The signature header is x-smsv3-probe-signature with v1= HMAC-SHA256 hex.
GET query keys: nonce, sha, deploymentId, issuedAt. Runtime restricts
challenge to 120 seconds, preview environment, exact Vercel project,
repository, Git ref, SHA, immutable host and a dedicated >=32-byte HMAC
secret. Never log the signature, HMAC key or signed URL.

Owner-only exact command syntax, NOT AUTHORIZED for dispatch:
 /sms-v3-r6b-exact-isolation-attestation-20261012 sha=e80a1883d1598c035741ca55d9a1fc09061718f9 deployment=dpl_9FeFnk1yQx8LUsENMA7TR3R8fpwk

Workflow filters an exact command prefix; the Node validator enforces the
complete SHA, Deployment ID, Owner identity, Issue #614, protected main
and first run attempt. Hosted UAT must require a human Owner approval,
disable admin bypass and allow only main.

Receipt v2 exact allow-listed root fields:
contract, nonce, deploymentId, applicationSha, vercelProjectId, gitCommitRef,
database, storage.

Database fields:
configuredDatabaseProjectRef, configuredDirectProjectRef,
configuredDatabaseName, observedDatabaseName, targetGuardMatched,
databaseReadOnlyQuerySucceeded.

Storage fields:
configuredEndpointProjectRef, bucket,
privateBucketMetadataReadSucceeded, bucketIsPrivate.

v1 fields, secrets, raw URLs, database rows, Preview-supplied Production
project identities and all other unlisted keys are rejected.

The verifier may record deployment identity PASS and separately label
configured database/storage endpoint checks MATCH and read-only checks PASS,
but DATABASE_ISOLATION, STORAGE_ISOLATION and PRODUCTION_SEPARATION remain
UNVERIFIED in the absence of independently attested provider/runtime
credential binding. Even where all partial checks succeed, the protected
verification exits nonzero, never authorizing a release.

## Required separate approvals and remaining work

1. Review Draft PR source, exact-head CI and workflow; separate Owner merge
   approval for this protected main-only workflow is required.
2. Independently confirm intended Production database and Storage provider
   identities and review a provider/runtime binding attestation strategy.
3. Separately approve and scope the dedicated HMAC secret in the Preview
   runtime and protected Hosted UAT Environment. Do not reuse bypass secret.
4. Separately approve Protected Workflow trigger and live read-only probe.
5. Resolve Preview Data API/RLS exposure with Prisma and Storage non-regression
   tests in a disposable environment before changing grants or policies.
   Current audit: 35 public tables with RLS disabled and broad grants.

NO migration, RLS change, Production edit, Storage write, UAT writes,
PR #611 merge, PR #615 merge or Protected Workflow execution here.

DATABASE_ISOLATION=UNVERIFIED; STORAGE_ISOLATION=UNVERIFIED;
PRODUCTION_SEPARATION=UNVERIFIED; RLS_SECURITY=HOLD;
HOSTED_UAT_READY=NO; R6_B_RELEASE=HOLD.
Evidence: https://github.com/godzillazzz/SMS-v3/issues/614

## Provider evidence plan — Owner-confirmed Production mapping (Draft only)

On 2026-10-13 the Owner clarified that the Supabase project named
`sms-v3-development` is **the intended Production project**. Names alone are
not trustworthy. Supabase Management API confirms separate project refs:
- Production: `jkexwnlxnxbemwavsebv`, private license bucket
  `sms-v3-license-documents`
- Preview: `ezxanpfagitckpfsnflp`, private license bucket
  `license-documents-g05-preview`

Separate provider-scoped, read-only checks gave different PostgreSQL cluster
system-identifier SHA-256 digests. These digests are not embedded in source,
logs or test fixtures. This establishes that the independently queried
**provider-managed clusters** differ. It does NOT establish where the running
Prisma connection is attached or which project issued its Storage secret.

New `scripts/ci/r6b-provider-witness-contract.cjs` is an **offline,
pure-function candidate evidence schema**, covered by mocks in
`test/r6b-provider-witness-contract.test.js`. It rejects project/cluster
collisions, incorrect buckets, unknown properties, raw credentials, stale
identity formats and mismatched key-ID/audit correlation. Even perfectly
matching mocks return only `MATCH_CANDIDATE` and `UNVERIFIED`;
the module is deliberately **NOT** wired into the protected verifier to
issue PASS. Neither `source=provider` strings nor arbitrary JSON assertions
can authenticate a provider. The existing verifier stays fail-closed.

### Reviewed execution design — NOT AUTHORIZED HERE

1. A future trusted runner must retrieve Production and Preview project
   metadata directly through two authenticated, independently scoped
   provider API requests; compare project refs with this frozen mapping.
   Gather nonsecret Storage bucket metadata but no objects or credentials.
2. Gather distinct PostgreSQL cluster witnesses directly from each
   provider's management-scoped read-only connection. A privileged
   `pg_control_system()` function worked for the management principal;
   **do not assume** that the application Prisma role has access.
   Do not grant privileges to the app role to make an attestation pass.
   Review and select a provider-supported least-privilege alternative if
   necessary, including connection-pooler behavior.
3. Only after separate Owner HMAC/Protected Workflow authorization, use a
   one-time nonce-bound signed GET at the **exact immutable Preview host**.
   Read an approved nonsecret witness of the **effective Prisma connection**;
   compare its server identity against both provider witnesses. Confirm
   source authentication and timestamp; no employee/business data reads.
4. For Storage, request an independently verifiable **nonsecret key
   identifier, issuer-to-project relation, and matching request/audit ID**
   from authenticated provider audit/API records, if those records are
   supported. Correlate them with the signed Preview metadata GET. Neither
   bucket naming, credential prefix, HMAC challenge, service-role JWT claim,
   nor an HTTP 200 proves issuer/project binding. If unavailable, keep
   `STORAGE_ISOLATION=UNVERIFIED` and design an alternative without using
   Preview credentials on any Production host.
5. Define a new trusted-runner `providerEvidence` fetcher and source
   authentication boundary in a **separately reviewed and authorized**
   change. Pin exact deployment, ref, CI and HMAC challenge, reject
   contradictions or stale evidence. Do not accept provider assertions
   from the Preview receipt, user-supplied JSON, environment variables
   or the pure candidate contract as authoritative sources.
6. Independently audit effective Production runtime bindings without
   reading Production secrets or modifying Production, under separately
   approved read-only provider evidence access. Any ambiguity is STOP.

**This Draft-only change neither implements the future privileged
provider API fetcher nor changes the runtime endpoint, Release Gate,
Protected Workflow or deploy behavior.** It only defines testable failure
cases and non-authoritative candidate comparisons. No live runtime probe
was performed; no secret was read or configured; PR remains Draft.

RLS is a separate STOP: last provider audit found 25 Production and
35 Preview public tables with RLS disabled. Any remediation requires
separate Owner approval and non-regression validation.

Required until all independently authenticated binding checks pass:
`DATABASE_ISOLATION=UNVERIFIED`,
`STORAGE_ISOLATION=UNVERIFIED`,
`PRODUCTION_SEPARATION=UNVERIFIED`,
`RLS_SECURITY=HOLD`, `R6_B_RELEASE=HOLD`.
