# R6-B — Protected exact-deployment attestation / Receipt v3 (Draft only)

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

## Contract v3 and signed GET challenge

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

Receipt v3 exact allow-listed root fields:
contract, nonce, deploymentId, applicationSha, vercelProjectId, gitCommitRef,
signedChallengeIdentity, database, storage.

signedChallengeIdentity fields:
host, deploymentId, applicationSha, nonce, issuedAt, signatureVerified.

Database fields:
configuredDatabaseProjectRef, configuredDirectProjectRef,
configuredDatabaseName, observedDatabaseName, runtimePrincipal,
runtimeClusterFingerprintSha256, targetGuardMatched,
databaseReadOnlyQuerySucceeded, transactionReadOnly, runtimeWitnessVerified.

Storage fields:
configuredEndpointProjectRef, bucket,
privateBucketMetadataReadSucceeded, bucketIsPrivate.

Receipt v2/v1 fields, secrets, raw URLs, database rows, Preview-supplied Production
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

## Feasibility checkpoint — Effective PostgreSQL Role / Supabase Storage issuer

**Owner-approved Draft-only capability review (2026-10-13)**

The two authenticated Supabase project-scoped read-only PostgreSQL checks
reported:
- Preview project ref ezxanpfagitckpfsnflp.
- Owner-identified Production project ref jkexwnlxnxbemwavsebv.
- These provider-managed PostgreSQL Cluster Fingerprints differ.
- Catalog privilege checks reported EXECUTE on pg_control_system() for
  postgres, authenticator, service_role, anon and authenticated in both
  projects, and for a role literally named prisma in Production.
  This is a provider-catalog privilege observation **only**, not proof
  that the effective Vercel Preview Prisma runtime uses any listed role,
  or that the query will work through the effective pooler/database URL.
  Do not grant privileges, assume the role, or run Runtime SQL under this
  Draft-only approval.

New scripts/ci/r6b-provider-identity-capability.cjs provides:
- Fixed two-project mapping from authenticated provider project metadata
  (Production named sms-v3-development by explicit Owner designation).
- Read-only SQL *templates*, including current_user and SHA-256 of the
  cluster identifier, plus a non-mutating role capability check.
- A strict, mockable, project-scoped adapter interface for project metadata,
  a private bucket metadata check, provider cluster witness and management
  role capability. This is a source-review scaffold, not a live adapter.
- Explicit refusal of extra API/credential fields and missing or
  contradictory project, bucket or cluster evidence.
- A capability-only result with no raw cluster hashes, no key/token values,
  no Runtime principal assertion and no change to any release verdict.
  Provider evidence source authentication remains unimplemented.

**Supabase Storage key-issuer limit.** Management APIs that list or fetch
project API keys may expose raw keys and are prohibited under the current
no-secret-read authorization. Existing connector capabilities do NOT
provide a confirmed, nonsecret, project-scoped issuer/key-ID plus request
audit correlation for the effective runtime Storage credential. No keys
API, Storage object, or provider request audit was called during this
review. The interface therefore deliberately records
NOT_AVAILABLE_IN_CURRENT_READONLY_CONNECTOR and cannot infer credential
ownership from a bucket name, URL, status 200, signed challenge, key
prefix or legacy JWT claim.

### Future exact-source PASS design — requires separate approval

1. After independent review, implement two authenticated, restricted
   provider adapters that pin Preview and Production Management project
   scopes and supply no secrets. Keep adapter response allowlists strict.
2. Only after distinct approval for a dedicated Preview HMAC secret and
   a live read-only exact-host probe, check the **effective Prisma runtime
   role** first. Evaluate the approved fingerprint query under that role
   using an enforced read-only transaction. If the call fails or returns
   a different cluster fingerprint than Preview, STOP. The provider-side
   Production fingerprint must be distinct. A role privilege query from
   Management is not a substitute for the Runtime witness.
3. Identify a *documented, nonsecret provider-supported* key/issuer or
   request-ID mechanism before designing Storage PASS. Avoid APIs that
   return service keys, never test Preview credentials on Production, and
   do not require project grants or policy changes to collect evidence.
   If no such mechanism exists, document an independently reviewable
   alternative and keep Storage Isolation UNVERIFIED until it works.
4. Verify challenge, provenance, exact CI/deployment/alias frozen status,
   trusted provider source authentication, freshness and negative cases
   before a future verifier can consider any Isolation PASS. No mock or
   adapter-supplied metadata can independently attest its own origin.
5. The current protected verifier is **unchanged and remains fail-closed**.

No Merge, Secret retrieval/configuration, Runtime Probe, Protected
Workflow, SQL writes, RLS changes, Storage writes or Production
modification in this Draft update.

DATABASE_ISOLATION=UNVERIFIED; STORAGE_ISOLATION=UNVERIFIED;
PRODUCTION_SEPARATION=UNVERIFIED; RLS_SECURITY=HOLD;
R6_B_RELEASE=HOLD.

## Mock-only runtime witness preparation (source review; not pushed)

Base Draft PR #615 HEAD: `909fe33f8da1ddd40afd73273453d93775c40451`.
Its existing exact-head CI run `38345332326` is SUCCESS, but that run does
not contain or validate the local source-review delta described here.

The proposed `collectPrismaRuntimeWitness` contract is deliberately kept in
the existing mock capability module. It accepts an injected Prisma client so
tests can prove the future call order without opening a database connection:

1. Enter the same Prisma client's interactive transaction.
2. Execute the fixed `SET TRANSACTION READ ONLY` statement first.
3. query `SHOW transaction_read_only` and require exactly `on`.
4. Execute the fixed cluster-fingerprint/current-user query through the
   transaction client and require exactly one allow-listed row.
5. Compare the observed `current_user` with the separately reviewed expected
   Runtime role, enforce evidence freshness, and expose no URL or credential.

The mock provider collector continues to use separately scoped Preview and
Production adapters and compares project refs plus hashed cluster witnesses.
New freshness validation rejects stale provider observations. An adapter is
still unable to authenticate its own provenance, so a mock match remains
candidate evidence and all release verdicts remain HOLD/UNVERIFIED.

Negative coverage includes missing Runtime witness, wrong provider project,
mismatched Runtime principal, read-only mode not enforced, same/mismatched
cluster, credential-shaped fields or values, and stale Runtime/provider
evidence. The proposed code is not registered in `src/app.js`, any route,
workflow, verifier or release gate, and it performs no live SQL/API request.

**Storage issuer feasibility:** current documented nonsecret Management and
Storage metadata identify a project endpoint and bucket, but do not bind the
effective Runtime `sb_secret_` or legacy service-role JWT issuer to that
project. API-key endpoints that can return raw credentials remain prohibited.
The mock constant therefore records
`UNAVAILABLE_WITH_NONSECRET_METADATA`; bucket metadata, URL project ref,
credential prefix, JWT payload and HTTP success cannot substitute for an
issuer attestation.

Local source-review validation used Node.js `v22.23.3`: 55 tests PASS,
0 FAIL, 0 SKIPPED across the exact-deployment verifier, provider capability
and provider witness suites. Syntax checks and `git diff --check` PASS.
No commit, Push, Preview deployment, live probe, secret read, SQL, Storage
operation, workflow execution or PR mutation was performed.

Separate Owner approval is required before applying this delta to PR #615,
because a Push can trigger a Preview deployment. A later live implementation
also requires a separately reviewed Runtime route/Receipt contract and
Protected Workflow approval; this source review does not authorize either.

DATABASE_ISOLATION=UNVERIFIED; STORAGE_ISOLATION=UNVERIFIED;
PRODUCTION_SEPARATION=UNVERIFIED; RLS_SECURITY=HOLD;
R6_B_RELEASE=HOLD.


## 2026-10-13 Source-review decision — runtime attestation approval packet (NOT AN AUTHORIZATION)

**Disposition: REVIEW-ONLY.** The current PR #615 capability inspector
is a candidate/mocked witness contract, not a trusted runtime/provider
attestation. CI SUCCESS and a READY Preview do not change release status.
This checkpoint is documentation-only in the existing Draft PR.

### Evidence authority and trust boundaries

| Observation | Supports | Cannot prove |
| --- | --- | --- |
| Two independent Supabase provider-scoped cluster witnesses | Provider-managed Preview and Production clusters differ | Effective Prisma runtime database |
| Management PostgreSQL role/capability check | Query feasibility for the inspected role | Privileges/identity of live pooled Prisma connection |
| Vercel immutable deployment, nonce, request HMAC | Selected Preview request identity after approval | Effective DB or Storage credential issuer |
| Private bucket metadata GET on a configured endpoint | Endpoint request and private bucket metadata | Credential provenance and Production separation |
| Provider adapter callbacks / mock fixtures | Candidate comparison regression behavior | Independently authenticated provider evidence |

The future trusted evidence runner must bind provider witnesses to
independently authenticated scopes, exact reviewed deployment ID/SHA,
approved nonsecret evidence, timestamp, freshness, and immutable host.
Never trust a Preview-supplied projectRef, provider label, environment
variable, database name, JWT payload, bucket name or self-asserted key ID
as an independent attestation.

### A. Database proof design — no runtime execution authorized

1. Capture Preview and Production provider identities from authenticated,
   separately scoped read-only sources. Compare the *same canonical*
   cluster fingerprint operation; do not expose the raw identifier,
   connections, SQL errors, rows, or credentials in ordinary logs.
2. Future Preview-only endpoint must query through the **actual Prisma
   client/pooler connection** inside an explicitly read-only transaction.
   Record the effective SQL principal and connection-path evidence.
   Management connection checks alone cannot satisfy runtime binding.
3. PostgreSQL pg_control_system() permission checks are only a capability
   hint. If the effective Prisma principal/pooler cannot execute an
   approved identity query, return WITNESS_UNAVAILABLE; retain UNVERIFIED.
   Do not GRANT privileges, impersonate a role, add SECURITY DEFINER,
   or bypass RLS to make the test succeed.
4. A future authoritative result requires an authenticated runtime
   witness equal to authenticated Preview provider witness and unequal
   to authenticated Production provider witness. Pooler ambiguity,
   unavailable/contradictory witness, timeout, stale evidence or missing
   origin authentication is a STOP. DB hostname/name is not a fallback.

### B. Storage issuer — current BLOCKER

Provider API key endpoints can expose credential values, including
fields called api_key, even in APIs with metadata. **Do not call such
endpoints or fetch keys for subsequent redaction/hashing under the current
no-secret-read restriction.** This prohibition includes reveal flags
and any API whose nonsecret response is not verified independently.

An acceptable future proof must use a provider-documented, credential-free
mechanism linking the independently authenticated Preview project, a
nonsecret identifier of the effective runtime credential, and a trusted
project-scoped request/audit witness with freshness and correlation.
A bucket name, project URL, HTTP 200, credential prefix, JWT claim,
or request HMAC alone is insufficient. Supabase secret-key and legacy
service-role-JWT formats must each be reviewed. Never use Preview
credentials against any Production host. If a safe provider-supported
mechanism does not exist, retain STORAGE_ISOLATION=UNVERIFIED; do not
replace an issuer proof with endpoint/bucket metadata.

### C. Required mock-only negative tests (Node 22)

- Provider scope collision, project mapping mismatch, same fingerprints
- Runtime identity read using the wrong/unknown SQL principal or pooler
- Missing privilege, fingerprint, freshness, or source-authentication
- Contradictory provider and runtime witnesses; replayed/expired nonce
- Unknown SHA, deployment, immutable host, or unsigned challenge
- Missing Storage issuer/key ID, mismatched project, missing audit link
- Credential-bearing response field; API key retrieval in no-secret mode
- Fake JWT/project claim, bucket success, CI success or Preview READY
  masquerading as provider identity proof

These must fail closed and never elevate partial checks to isolation PASS.
No future live test may precede local/mock review and explicit approval.

### D. Approval sequence and independent RLS gate

**A — allowed now:** Draft PR source review, document updates, mock
tests, ordinary GitHub CI. PR #615 stays OPEN/Draft; no Merge.

**B — separate Owner approval required:** Review a Preview-only Runtime
endpoint implementation, effective Prisma identity SQL and permissions,
trusted provider evidence collector, HMAC design and configuration, and
exact immutable Preview deployment pin. The runtime endpoint is not
merged by this Draft review; an Issue #614 patch is not deployment proof.

**C — separate Owner approval required:** Exact Preview GET live probe
and protected Hosted UAT workflow dispatch, only with narrowly scoped
nonsecret provider access, source review, log redaction, immutable
SHA/deployment/host binding and explicit STOP conditions. No Production
runtime probe is authorized.

**D — separate security approval required:** Remediate historic Preview
and Production Data API/RLS findings in a disposable test environment
first. Isolation attestation does not cure public table RLS exposure.
No changes to RLS/grants, schemas, migrations or Production are
authorized here.

**Current verdict (unchanged):** DATABASE_ISOLATION=UNVERIFIED;
STORAGE_ISOLATION=UNVERIFIED; PRODUCTION_SEPARATION=UNVERIFIED;
RLS_SECURITY=HOLD; R6_B_RELEASE=HOLD.

No secrets, Production requests, live probes, protected workflow
dispatch, migrations, database queries or Storage object operations
were performed by this review.
