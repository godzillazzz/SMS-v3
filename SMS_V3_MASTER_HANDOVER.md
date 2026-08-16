# SMS V3 MASTER HANDOVER

## Reconstruction Notice

**Classification:** RECONSTRUCTED AUTHORITATIVE BASELINE

This file is a documentation reconstruction. It is not the recovered original
SMS_V3_MASTER_HANDOVER.md, and it must not be read as if it were the lost
historical file.

The original Master was searched for in the current checkout, worktrees, Git
history, unreachable Git objects, remote branches and tags, GitHub history,
other filesystem locations, 147 remote refs, and 57 unreachable commits. It
was not found. docs/PRODUCTION_OPERATIONAL_HANDOVER_ACCEPTANCE.md was reviewed
and is not the Master because it does not contain the required Section 0
current-state record, historical checkpoint chain, V3.3 evidence, rollback
history, or Feature Complete gap register.

Reconstruction date: 2026-08-16

Evidence boundary: This baseline uses the authoritative release, promotion,
rollback, UAT, runtime, repository, and gap evidence supplied and verified in
the preceding SMS V3 release-validation phases. It does not infer unrecorded
historical events, dates, deployment IDs, SHA values, decisions, or
operational ownership. It does not rerun UAT or modify Production. Items not
supported by that evidence are marked UNKNOWN, NOT RECOVERABLE, or
HISTORICAL CONTEXT — NON-AUTHORITATIVE.

Future authoritative updates must modify this file rather than create another
Master with a competing identity.

---

## Section 0 — CURRENT STATE

### Current Production identity

| Field | Authoritative value |
| --- | --- |
| Canonical URL | https://sms-v3-staging-ten.vercel.app |
| Project | sms-v3-staging |
| Current Production deployment | dpl_9kb9pKc14A5zMWo6AFeM6JqSWusk |
| Deployment target | production |
| Deployment state | READY |
| Current application SHA | 148c7b8ab17698c011008335c23b99895bba7bf8 |
| Candidate branch | fix/admin-rbac-surface-alignment-v1 |
| Current release | ADMINISTRATIVE RBAC SURFACE ALIGNMENT V1 |
| Release status | PRODUCTION VALIDATED |
| Promotion timestamp | 2026-08-16T06:03:26Z |
| Current main | e4bde1265ffb6b7daa9260d8465b46dd27008ab0 |
| Current trusted Harness | 66e81e59f813f01e999e21243e5456ddf032ba91 |

The former staged deployment dpl_HNJFMCPiHGonnGkpGABYLPDFFFf9 is
INVALID_FOR_RELEASE_VALIDATION and is not the current Production deployment.
It remains forensic history only.

### Current rollback

| Field | Authoritative value |
| --- | --- |
| Current rollback checkpoint | rollback/admin-rbac-surface-alignment-v1-prod-2026-08-16 |
| Rollback SHA | 148c7b8ab17698c011008335c23b99895bba7bf8 |
| Previous rollback checkpoint | Preserved |

### Current health and release validation

- Post-promotion /api/v1/health: 200, status=ok.
- Post-promotion /api/v1/ready: 200, status=ready, database=ok.
- Readiness observations: 3/3 PASS.
- Technical UAT: 11 PASS / 0 FAIL / 43 SKIP (run 31926176078).
- Exact targeted Auth: 8 PASS / 0 FAIL / 0 SKIP (run 31927914811).
- Final Full Auth: 53 PASS / 0 FAIL / 1 controlled disposable SKIP
  (run 31929402483).
- Artifact leak: 0.
- Password, credential, and authentication-material findings: 0.
- Heavy-read safety: 0 / 0 / 0; outstandingHeavyReads=[].
- Performance classification: PERFORMANCE_NEUTRAL.
- Runtime certification: all required critical signatures were 0,
  including P2024, P2028, pool and transaction timeouts, Prisma
  initialization errors, ReferenceError, HTTP 500/503/504, and Runtime
  Timeout.
- License initial history requests: 0.
- Additional initial summary HTTP: 0.
- Report Center contract: PASS.

### Current business gap status

| Gap | Status | Current authority |
| --- | --- | --- |
| G01 — Administrative RBAC / schedule approval | CLOSED | ADMIN allowed; MANAGER and VIEWER denied; actor identity preserved |
| G02 — Shift Type authorization and audit | CLOSED | ADMIN-only writes; successful mutations audited; denied writes do not mutate |
| G03 — Leave Quota Provisioning | OPEN | Admin product/API provisioning path is missing |
| G04 — Registration Privacy Hardening | OPEN | Anonymous registration exposes a browseable employee roster |
| G05 — License Delete Audit Tombstone | OPEN | Permanent deletion can remove historical document audit rows |

### Next recommended task

G03 — LEAVE QUOTA PROVISIONING V1

G01 and G02 are closed. G03 is the remaining P1 business-operability gap. It
is bounded, should initially avoid a schema migration unless evidence proves
one necessary, and removes reliance on fallback/default-only entitlement
behavior for newly created employees. Do not reopen the validated RBAC or UAT
load-shaping work unless new evidence requires it.

---

## Section 1 — Product Purpose and Architecture

SMS V3 is a security-management system with authenticated employee,
scheduling, leave, license, reporting, audit, and administrative surfaces.

Repository evidence establishes:

- The backend uses Express, PostgreSQL, Prisma, and JWT authentication.
- Versioned API routes live under /api/v1.
- src/ contains configuration, middleware, routes, services, and audit
  extension points.
- prisma/ contains the database schema and seed material.
- frontend/ and e2e/ contain the browser application and UAT surface.
- docs/ contains operational, deployment, security, and acceptance records.

This reconstruction does not assert a complete original architecture
document. Component ownership, external integrations, and historical
environment topology not stated above are UNKNOWN.

### Capability map

| Capability | Classification | Evidence boundary |
| --- | --- | --- |
| Authentication / sessions | COMPLETE | Authenticated UAT and protected endpoint checks passed |
| Users / roles / RBAC | COMPLETE for validated role contracts | G01 and G02 contracts passed |
| Employee management | PARTIAL | Employee surfaces are present; full operational acceptance is not reconstructed |
| Employee lifecycle | PARTIAL | Future-effective behavior and historical limits remain debt |
| Scheduling | PARTIAL | Monthly approval authorization is validated; broader ownership remains G06 |
| Leave | PARTIAL | Leave flows are present; quota provisioning remains G03 |
| Leave quotas | OPEN GAP | Explicit Admin provisioning path is G03 |
| License management | COMPLETE for validated contracts | License access and initial-load contract passed |
| License documents | PARTIAL | Read hardening passed; delete tombstone remains G05 |
| Dashboard | COMPLETE for validated contracts | Technical and Full Auth coverage passed |
| Executive reporting | PARTIAL | Current tested behavior passed; historical as-of semantics remain debt |
| Unified Report Center | COMPLETE for validated contracts | Acceptance and network contracts passed |
| Audit | PARTIAL | Mutation audit passed; deletion tombstone remains G05 |
| Data Quality | PARTIAL | Current-state behavior is validated; historical as-of semantics remain debt |
| Notifications/email | PARTIAL | Full production capability is not established by this reconstruction |
| PDF/export | COMPLETE for validated contracts | PDF, export, and stale-export checks passed |
| Request ID observability | COMPLETE for validated contracts | Request ID visibility and sanitized correlation passed |
| Error handling | COMPLETE for validated contracts | Protected errors and critical runtime checks passed |
| Database reliability | COMPLETE for validated release window | Current runtime certification recorded zero critical signatures |
| Performance/load shaping | COMPLETE for validated UAT contract | V3.3 shaping and final performance semantics passed |
| Responsive/mobile UX | COMPLETE for validated UAT contract | Responsive coverage passed in release validation |
| Settings/admin | PARTIAL | Administrative surfaces exist; full acceptance is not reconstructed |
| Cron/background jobs | PARTIAL | Lifecycle scheduling and operational automation evidence remain incomplete |
| Storage/documents | PARTIAL | Document behavior is validated; G05 remains open |
| Production recovery | COMPLETE for validated release procedure | Exact promotion and rollback checkpoint were verified |
| Automated testing/UAT | COMPLETE for current release-validation contract | Technical, targeted, and Full Auth evidence is recorded |

---

## Section 2 — Production / Deployment Model

- Production is served by the Vercel project sms-v3-staging.
- The current Canonical URL is
  https://sms-v3-staging-ten.vercel.app.
- The current Canonical deployment is the exact Production-target deployment
  dpl_9kb9pKc14A5zMWo6AFeM6JqSWusk at application SHA
  148c7b8ab17698c011008335c23b99895bba7bf8.
- The release was promoted as an existing exact deployment; no replacement
  application deployment was used for the release.
- Deployment Protection can return an interstitial to anonymous clients.
  Deployment identity must therefore be proven with authoritative deployment
  metadata and the approved protected-access method, not HTML markers alone.
- Exact deployment identity requires the deployment ID, project, target,
  state, application SHA, and source-branch/source-SHA contract to agree.
- Promotion, rollback, and environment-policy changes remain governed
  operations requiring explicit authorization.

The full historical deployment topology and any unrecoverable aliases are
NOT RECOVERABLE.

---

## Section 3 — Database / Prisma / Supabase Reliability

- The application uses PostgreSQL through Prisma.
- The current release was validated with no migration and no Production data
  correction.
- The current post-promotion runtime certification recorded zero P2024, P2028,
  pool timeout, transaction timeout, Prisma initialization, HTTP 500, HTTP
  503, HTTP 504, and Runtime Timeout signatures.
- The clean staged artifact validation established the current
  license-document read path without an initial per-row history fan-out and
  without an interactive transaction in the read list() path.
- A prior staged artifact produced stale/dirty license-document behavior and
  was rejected for release validation. That deployment is forensic evidence,
  not a valid current runtime baseline.
- No conclusion is made here about unrecorded Supabase limits, connection
  settings, or historical database incidents. Those details are UNKNOWN
  unless separately evidenced.

No production pool, DATABASE_URL, schema, migration, or database setting was
changed by the current release procedure.

---

## Section 4 — Authentication / RBAC

- Authenticated sessions and role-aware protected API behavior are covered by
  the validated UAT suite.
- The role contract used by the current release includes ADMIN, MANAGER, and
  VIEWER.
- G01 is closed:
  - monthly schedule approval is allowed for ADMIN;
  - monthly schedule approval is denied for MANAGER and VIEWER;
  - the real actor identity is preserved;
  - hardcoded ADMIN actor-role substitution was removed.
- G02 is closed:
  - Shift Type CREATE, UPDATE, and DELETE are ADMIN-only;
  - MANAGER and VIEWER writes are denied;
  - successful mutations are audited;
  - denied mutations do not succeed and do not create a successful mutation
    audit;
  - read behavior is unchanged.
- No claim is made that every historical role rule is represented in this
  reconstruction. The exact tested contracts above are authoritative.

---

## Section 5 — Employee / Lifecycle

- Employee management and authenticated employee-facing flows are part of the
  application surface and were exercised by the release validation evidence.
- Employee lifecycle behavior includes future-effective semantics that are
  currently applied lazily through authenticated application traffic.
- A dedicated scheduler for lifecycle application has not been established in
  this evidence boundary.
- New employees currently rely on fallback quota defaults unless an explicit
  quota row is provisioned through a path that is not yet available; see G03.
- Some legacy unmatched/import history cannot necessarily be reconstructed
  perfectly.

Overall lifecycle capability is PARTIAL, not because the current release
failed its validated contracts, but because the operational model and
historical reconstruction limits remain open.

---

## Section 6 — Scheduling

- Scheduling is an implemented product surface.
- The current release specifically validates the monthly schedule approval
  authorization contract recorded in Section 4.
- ADMIN approval is allowed; MANAGER and VIEWER approval is denied.
- Actor identity is preserved and no hardcoded ADMIN substitution remains.
- Broader scheduling ownership, recurring operational procedures, and
  responsibility-matrix formalization remain subject to P2 item G06.

Classification: PARTIAL for full product-operability completeness; the
validated RBAC approval contract is COMPLETE.

---

## Section 7 — Leave / Quota

- Leave request functionality is part of the validated application surface.
- Leave entitlement currently has fallback/default behavior for newly created
  employees.
- G03 is open because there is no normal Admin product/API path to create,
  provision, and maintain an individual LeaveQuota row for a new employee
  without SQL or a legacy import dependency.
- The target state is explicit Admin-managed quota provisioning for any new
  employee.
- No schema migration is expected initially, but that is a planning
  constraint, not proof that a migration will never be needed.

Classification: OPEN GAP for quota provisioning and PARTIAL for the overall
Leave capability.

---

## Section 8 — Licenses / Documents

- License management and document access are part of the validated product
  surface.
- The current clean artifact uses embedded documentSummary data in the
  license list response.
- Initial table rendering does not issue per-visible-row
  /api/v1/licenses/:id/documents requests.
- Explicit history access remains a separate, user-triggered behavior.
- The current release recorded zero initial history requests, zero additional
  summary HTTP calls, and zero license-document P2028/503 failures.
- G05 is open because permanent eligible document deletion can remove the
  historical audit rows associated with the document.
- The target is a non-sensitive deletion tombstone retaining the appropriate
  entity, actor, timestamp, and former parent identity without retaining the
  private document.

Classification: PARTIAL; the read-path hardening is validated, while the
delete-audit tombstone remains an open P1 gap.

---

## Section 9 — Dashboard / Reporting / Data Quality

- Dashboard and protected reporting surfaces were covered by Technical and
  Full Auth validation.
- Unified Report Center acceptance and its exact network contract passed in
  the targeted and Full Auth evidence.
- Executive reporting, PDF/export behavior, stale-export prevention, and
  blank-first-page checks passed in the final validation evidence.
- Historical Executive Reporting license and Data Quality sections currently
  use current-state semantics rather than full historical as-of
  reconstruction.
- The current report behavior is therefore operationally validated for the
  tested contract but remains subject to the historical semantics debt in
  Section 15.

Classification: PARTIAL for historical reporting completeness; current
tested dashboard and Report Center contracts are COMPLETE.

---

## Section 10 — Audit / Observability / Request ID

- Successful Shift Type mutations are audited.
- Denied Shift Type mutations do not succeed and do not create a successful
  mutation audit.
- Request ID visibility is part of the validated operational behavior.
- Runtime evidence and sanitized UAT artifacts preserve safe request
  correlation without exposing credentials, tokens, cookies, response bodies,
  or other sensitive material.
- Artifact scanning and password/credential-material scanning remained
  enabled during the release validation.

Classification: PARTIAL overall because G05 requires a deletion tombstone; the
validated mutation-audit and request-ID contracts are COMPLETE.

---

## Section 11 — Notifications / Storage / Export

| Capability | Classification | Evidence boundary |
| --- | --- | --- |
| Notifications/email | UNKNOWN | Full production capability and ownership are not established by this reconstruction |
| Storage/documents | PARTIAL | License document read behavior is validated; permanent-delete tombstone is G05 |
| PDF generation | COMPLETE | Final Full Auth PDF contract passed |
| Export behavior | COMPLETE for tested Report Center contracts | Stale export prevention and PDF checks passed |
| Backup/restore operations | OPEN GAP | Operational evidence remains P2 item G08 |

No notification credential, storage secret, or production integration value is
recorded here.

---

## Section 12 — Testing / UAT / Harness

### Validated release evidence

| Gate | Result |
| --- | --- |
| Technical UAT 31926176078 | 11 PASS / 0 FAIL / 43 SKIP |
| Targeted Auth 31927914811 | 8 PASS / 0 FAIL / 0 SKIP |
| Final Full Auth 31929402483 | 53 PASS / 0 FAIL / 1 controlled disposable SKIP |
| Artifact leak | 0 |
| Password/credential findings | 0 |
| Heavy-read safety | 0 / 0 / 0, outstanding [] |
| Performance | PERFORMANCE_NEUTRAL |
| Critical runtime signatures | All 0 |

The trusted Harness used for the release is
66e81e59f813f01e999e21243e5456ddf032ba91. The current main is
e4bde1265ffb6b7daa9260d8465b46dd27008ab0.

The controlled disposable test remained skipped by design. The Full Auth
result must not be rewritten as 54 PASS; the authoritative result is
53 PASS / 0 FAIL / 1 controlled disposable SKIP.

### Governance

- Full Auth is not a substitute for targeted diagnosis or Technical identity
  validation.
- Deployment identity must be proven before UAT.
- Fixed UAT scopes must remain enumerated and fail closed.
- Sanitizers must not expose secret or credential material.
- No retry, redeploy, promotion, or rollback is implied by a test result
  without separate authorization.

### Automated testing/UAT classification

COMPLETE for the current release-validation contract; ongoing regression
coverage remains P2 item G12.

---

## Section 13 — Rollback / Release History

### Current release

- Release: ADMINISTRATIVE RBAC SURFACE ALIGNMENT V1
- Production SHA: 148c7b8ab17698c011008335c23b99895bba7bf8
- Production deployment: dpl_9kb9pKc14A5zMWo6AFeM6JqSWusk
- Rollback checkpoint:
  rollback/admin-rbac-surface-alignment-v1-prod-2026-08-16
- Status: PRODUCTION VALIDATED
- G01: CLOSED
- G02: CLOSED

### Preserved historical milestones

The following entries are recovered historical evidence supplied by the prior
release record. They are not claims that those deployments are current.

#### PERFORMANCE & RELIABILITY HARDENING V1

- Known Production SHA:
  70dcf5ef3978562cd4cac4c6c276851b669ba21a
- Known deployment: dpl_8JHKLVrvWdfMbZfPzssQezP1cc8q
- Known rollback checkpoint:
  rollback/performance-reliability-hardening-v1-prod-2026-08-15

#### REQUEST ID VISIBILITY V1

- Known Production SHA:
  dd78e635146ca452b620216973069be9d1e6e3ea
- Known deployment: dpl_C9HC6M3Rp2mHb6CAmUCmuMhmCCup
- Known rollback checkpoint:
  rollback/request-id-visibility-v1-prod-2026-08-15
- This is historical context only. It is not the current Production
  deployment or current application SHA.

#### UAT LOAD SHAPING V3.3

- Trusted Harness milestone:
  5278113ca928a188480e4d24eaa3a87351ae8912
- Known Full Auth result: 53 PASS / 0 FAIL / 1 SKIP
- Known server heavy peak: 1
- Outstanding/drain counts: 0
- Critical runtime errors: 0

### Unrecovered history

The complete original checkpoint chain, all prior promotion timestamps, and
any historical decisions not listed above are NOT RECOVERABLE from available
sources.

---

## Section 14 — Feature Complete Gap Register

### P1 gaps

#### G03 — Leave Quota Provisioning — OPEN

New employees can use fallback quota defaults, but there is no normal Admin
product/API path to provision an individual LeaveQuota row. The target is
Admin creation and maintenance of explicit leave entitlement without SQL or
legacy import dependency.

#### G04 — Anonymous Registration Directory Exposure — OPEN

Unauthenticated registration currently exposes a browseable
available-employee roster. The target is narrow employee-code or equivalent
identity lookup while retaining registration approval controls.

#### G05 — License Document Permanent-Delete Audit Tombstone — OPEN

Permanent eligible deletion can remove historical audit rows associated with
the document. The target is a non-sensitive deletion tombstone containing
appropriate entity, actor, timestamp, and former parent identity without
retaining the private document.

### Closed P1 work

- G01 — Administrative RBAC / schedule approval — CLOSED.
- G02 — Shift Type authorization and audit — CLOSED.

### P2 / SHOULD HAVE / final acceptance items

- G06 — Manager responsibility matrix formalization.
- G07 — LeaveQuota duplicate-linked-row/invariant assessment.
- G08 — Backup/restore operational evidence.
- G09 — Monitoring/on-call ownership evidence.
- G10 — Historical report license/Data Quality current-state/as-of disclosure.
- G11 — Future-effective Employee Lifecycle application model decision.
- G12 — Focused final acceptance/regression coverage.

---

## Section 15 — Known Technical Debt

1. Future-effective lifecycle events are applied lazily through authenticated
   application traffic unless a dedicated scheduler is later approved.
2. Historical Executive Reporting license/Data Quality sections currently use
   current-state semantics rather than full historical as-of reconstruction.
3. Some legacy unmatched/import history cannot necessarily be reconstructed
   perfectly.

These are not current P0/P1 incidents based on the reconstructed evidence.
They remain explicit design or acceptance debt.

---

## Section 16 — Operational Acceptance Still Required

The following items remain open or require separate operational evidence:

- G03, G04, and G05 must be designed, implemented, and validated in their
  own bounded release phases.
- G06–G12 require owner decisions or evidence according to their individual
  scope.
- Backup and restore evidence is not replaced by the current rollback
  checkpoint.
- Monitoring and on-call ownership evidence remains to be formalized.
- Historical report current-state/as-of disclosure remains required.
- Future lifecycle scheduling/model ownership remains to be decided.
- Final focused acceptance/regression coverage should be retained and rerun
  only under an explicitly authorized validation plan.

Current Production validation does not close these items implicitly.

---

## Section 17 — Do Not Build / Deferred Scope

- Do not reopen G01 or G02 without new contradictory evidence.
- Do not treat the historical invalid staged artifact as a release target.
- Do not bypass exact deployment identity, source SHA, Harness SHA, or
  fail-closed UAT-scope checks.
- Do not solve G03–G05 by changing pool settings, widening timeouts, adding
  blind retries, or mutating Production data without a separately approved
  design.
- Do not expand the current Feature Complete gate with future product
  capabilities before closing G03, G04, G05, and the required P2 acceptance
  evidence.

Historical or future scope not stated in this file is deferred or
NOT RECOVERABLE, not silently approved.

---

## Section 18 — Next Recommended Development Sequence

1. G03 — LEAVE QUOTA PROVISIONING V1
   - Close the remaining P1 employee-operability gap.
   - Provide a normal Admin product/API path for explicit quota provisioning.
   - Avoid schema migration initially unless evidence proves it necessary.
   - Keep the scope bounded and do not reopen RBAC or UAT load shaping.
2. G04 — REGISTRATION PRIVACY HARDENING
   - Replace broad anonymous roster enumeration with narrow identity lookup.
3. G05 — LICENSE DOCUMENT DELETE AUDIT TOMBSTONE
   - Preserve non-sensitive deletion history without preserving private files.
4. Complete the P2 final acceptance items G06–G12.
5. Apply a feature freeze to the current V3 core.

---

## POST-FEATURE-COMPLETE PRODUCT VISION

Classification: OWNER FUTURE VISION — NOT CURRENT FEATURE-COMPLETE BLOCKERS

After G03, G04, G05, and final operational acceptance are complete, future
platform expansion may be scoped separately:

1. Time Attendance.
2. Security Guard Checkpoint Scanning.
3. Expanded Security Reporting:
   - guard behavior reports;
   - Visitor Management and person entry/exit reporting;
   - damage and defective-asset incident reporting.

These are substantial future platform expansions. They do not block current
SMS V3 Feature Complete and must not displace the bounded G03/G04/G05
sequence without an explicit Owner priority change.

---

## Reconstruction Change Log

| Date | Change |
| --- | --- |
| 2026-08-16 | Created this reconstructed authoritative baseline after the original Master was confirmed not recoverable. |
