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
| Current Production deployment | dpl_FmYkoc5hfCJ6g6xyGfdvufE56sYs |
| Deployment target | production |
| Deployment state | READY |
| Current application SHA | 0951d4ce08de817dda7b986924232e86e745b532 |
| Current application tree | dfacd4261df08139f21bebd498ce709954163b8b |
| Candidate branch | feat/annual-leave-quota-rollover-v1 |
| Current release | G03.1 — ANNUAL LEAVE QUOTA ROLLOVER V1 |
| Release status | PROMOTED / PRODUCTION VERIFIED |
| Promotion timestamp | 2026-08-17T05:01:49.815Z |
| Current main | e4bde1265ffb6b7daa9260d8465b46dd27008ab0 |
| Current trusted Harness | a561b3bf6884c9d464aaba57b5974dff1f37c2b6 |
| G03.1 schema migration | 202608170001_annual_leave_quota_year — APPLIED EXACTLY ONCE |
| 2026 classification | VERIFIED — 64 authoritative linked rows; 3 unmatched/unlinked NULL-year rows; 0 other years (fresh checkpoint snapshot 2026-08-17T05:26:13Z) |
| Multi-year activation | G03_1_MULTI_YEAR_WRITES_ENABLED = INACTIVE (setting MISSING) |

The former staged deployment dpl_HNJFMCPiHGonnGkpGABYLPDFFFf9 is
INVALID_FOR_RELEASE_VALIDATION and is not the current Production deployment.
It remains forensic history only.

### Current rollback

The current rollback checkpoint is the verified G03.1 Production checkpoint created after exact Promotion verification while multi-year activation remained INACTIVE. The historical G03 checkpoint and all earlier rollback refs remain preserved.

| Field | Authoritative value |
| --- | --- |
| Current rollback checkpoint | rollback/g03-1-annual-leave-quota-rollover-v1-prod-2026-08-17 |
| Rollback SHA | 0951d4ce08de817dda7b986924232e86e745b532 |
| Associated Production release | G03.1 — ANNUAL LEAVE QUOTA ROLLOVER V1 |
| Canonical deployment | dpl_FmYkoc5hfCJ6g6xyGfdvufE56sYs |
| Checkpoint status | VERIFIED |
| Created / verified date | 2026-08-17 |
| Previous rollback checkpoint | rollback/g03-leave-quota-provisioning-v1-prod-2026-08-17 |
| Previous rollback SHA | 1701bcf90a1998ea4999ee02e687172295984c9a |
| Earlier rollback checkpoint | rollback/admin-rbac-surface-alignment-v1-prod-2026-08-16 |
| Earlier rollback SHA | 148c7b8ab17698c011008335c23b99895bba7bf8 |

### Current health and release validation

- Post-promotion /api/v1/health: 200, status=ok.
- Post-promotion /api/v1/ready: 200, status=ready, database=ok.
- Readiness observations: 3/3 PASS.
- G03.1 Technical validation: 11 PASS / 0 FAIL / 46 SKIP (run 31989684604).
- G03.1 Full Auth: 55 PASS / 0 FAIL / 2 controlled SKIP / 0 uncontrolled SKIP (run 31994339618).
- G03.1 role contract: ADMIN PASS / MANAGER PASS / VIEWER PASS.
- Trusted Harness: a561b3bf6884c9d464aaba57b5974dff1f37c2b6.
- Security artifact leak: 0; Production business writes attributable to UAT/Promotion: 0.
- Promotion CI run: 31996411117; exact existing deployment promoted through POST /v10/projects/{projectId}/promote/{deploymentId}; HTTP 201; dispatch count 1.
- Post-promotion runtime window 2026-08-17T05:01:45Z–2026-08-17T05:05:00Z: P2021, P2022, P2024, P2028, pool timeout, connection timeout, transaction timeout, Prisma initialization error, ReferenceError, HTTP 500/503/504, Runtime Timeout, UnhandledPromiseRejection, and fatal initialization all 0.
- 2026 entitlement / used / remaining preserved exactly: SICK 1856 / 15 / 1841; PERSONAL 164 / 3 / 161; VACATION 299 / 15 / 284.
- Fresh checkpoint snapshot after legitimate Production activity: 67 total LeaveQuota rows; 64 quotaYear=2026 authoritative linked rows; 3 quotaYear=NULL unmatched/unlinked rows; 0 other years. The checkpoint task itself created no quota row and changed no quotaYear.
- G03_1_MULTI_YEAR_WRITES_ENABLED remains INACTIVE; setting remains MISSING; activation mutation 0.
- Production business mutation during Promotion: 0; migration during Promotion: NONE; Cron invocation: 0.
- New release/replacement deployment created by Promotion: 0.

### Current business gap status

| Gap | Status | Current authority |
| --- | --- | --- |
| G01 — Administrative RBAC / schedule approval | CLOSED | ADMIN allowed; MANAGER and VIEWER denied; actor identity preserved |
| G02 — Shift Type authorization and audit | CLOSED | ADMIN-only writes; successful mutations audited; denied writes do not mutate |
| G03 — Leave Quota Provisioning | CLOSED | Explicit Admin provisioning promoted and Production verified |
| G03.1 — Annual Leave Quota Rollover | PROMOTED / CHECKPOINT VERIFIED / ACTIVATION INACTIVE | Annual quotaYear schema/classification is Production verified; G03.1 rollback checkpoint is verified; non-2026 creation remains hard-gated pending separate activation approval |
| G04 — Registration Privacy Hardening | OPEN / PAUSED | Anonymous registration privacy scope remains open but is not started while G03.1 release governance is incomplete |
| G05 — License Delete Audit Tombstone | OPEN | Permanent deletion can remove historical document audit rows |

### Next recommended task

G03.1 — MULTI-YEAR ACTIVATION — SEPARATE OWNER APPROVAL REQUIRED

The G03.1 Production rollback checkpoint is now created and verified. Multi-year writes remain deliberately INACTIVE and no 2027+ annual authority exists. The next consequential action requires separate explicit owner authorization to set G03_1_MULTI_YEAR_WRITES_ENABLED=true. G04 remains PAUSED.

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
| Users / roles / RBAC | COMPLETE | G01 and G02 contracts passed |
| Employee management | PARTIAL | Employee surfaces are present; full operational acceptance is not reconstructed |
| Employee lifecycle | PARTIAL | Future-effective behavior and historical limits remain debt |
| Scheduling | PARTIAL | Monthly approval authorization is validated; broader ownership remains G06 |
| Leave | PARTIAL | Leave flows and explicit quota provisioning are validated; broader operational acceptance remains |
| Leave quotas | COMPLETE for G03 provisioning; G03.1 promoted with activation pending | Annual quotaYear schema/classification and 2026 preservation are Production verified; multi-year non-2026 creation remains deliberately inactive |
| License management | COMPLETE | License access and initial-load contract passed |
| License documents | PARTIAL | Read hardening passed; delete tombstone remains G05 |
| Dashboard | COMPLETE | Technical and Full Auth coverage passed |
| Executive reporting | PARTIAL | Current tested behavior passed; historical as-of semantics remain debt |
| Unified Report Center | COMPLETE | Acceptance and network contracts passed |
| Audit | PARTIAL | Mutation audit passed; deletion tombstone remains G05 |
| Data Quality | PARTIAL | Current-state behavior is validated; historical as-of semantics remain debt |
| Notifications/email | PARTIAL | Full production capability is not established by this reconstruction |
| PDF/export | COMPLETE | PDF, export, and stale-export checks passed |
| Request ID observability | COMPLETE | Request ID visibility and sanitized correlation passed |
| Error handling | COMPLETE | Protected errors and critical runtime checks passed |
| Database reliability | COMPLETE | Current runtime certification recorded zero critical signatures |
| Performance/load shaping | COMPLETE | V3.3 shaping and final performance semantics passed |
| Responsive/mobile UX | COMPLETE | Responsive coverage passed in release validation |
| Settings/admin | PARTIAL | Administrative surfaces exist; full acceptance is not reconstructed |
| Cron/background jobs | PARTIAL | Lifecycle scheduling and operational automation evidence remain incomplete |
| Storage/documents | PARTIAL | Document behavior is validated; G05 remains open |
| Production recovery | COMPLETE | Exact promotion and rollback checkpoint were verified |
| Automated testing/UAT | COMPLETE | Technical, targeted, and Full Auth evidence is recorded |

---

## Section 2 — Production / Deployment Model

- Production is served by the Vercel project sms-v3-staging.
- The current Canonical URL is
  https://sms-v3-staging-ten.vercel.app.
- The current Canonical deployment is the exact Production-target deployment
  dpl_FmYkoc5hfCJ6g6xyGfdvufE56sYs at application SHA
  0951d4ce08de817dda7b986924232e86e745b532.
- G03.1 was promoted as the existing exact staged Production deployment; no
  replacement application deployment or rebuild was used for the release.
- The immediately previous Canonical was dpl_rK4D47D2HaJ2ur4cLV1YfWtnu2eL at
  application SHA 1701bcf90a1998ea4999ee02e687172295984c9a and is preserved as historical release evidence.
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
- Production already contained the additive G03.1 migration
  202608170001_annual_leave_quota_year before Promotion; it is applied exactly once.
- Promotion itself performed no migration and no Production data correction.
- Current annual quota classification is 63 authoritative linked rows at
  quotaYear=2026, 3 unmatched/unlinked rows at quotaYear=NULL, and 0 rows in
  other years.
- G03_1_MULTI_YEAR_WRITES_ENABLED remains INACTIVE with the setting MISSING;
  no activation row was created and no annual Cron was invoked by Promotion.
- The current post-promotion runtime certification recorded zero P2021, P2022,
  P2024, P2028, pool timeout, connection timeout, transaction timeout, Prisma
  initialization, ReferenceError, HTTP 500, HTTP 503, HTTP 504, Runtime Timeout,
  UnhandledPromiseRejection, and fatal initialization signatures.
- The clean staged artifact validation established the current
  license-document read path without an initial per-row history fan-out and
  without an interactive transaction in the read list() path.
- A prior staged artifact produced stale/dirty license-document behavior and
  was rejected for release validation. That deployment is forensic evidence,
  not a valid current runtime baseline.
- No conclusion is made here about unrecorded Supabase limits, connection
  settings, or historical database incidents. Those details are UNKNOWN
  unless separately evidenced.

No production pool, DATABASE_URL, schema, migration, activation setting, or
business data was changed by the G03.1 Promotion procedure. The G03.1 schema
migration and 2026 classification were completed and verified before Promotion.

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
- New employees can now be explicitly provisioned through the G03 Admin quota path; fallback/default behavior remains legacy compatibility rather than an open G03 blocker.
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
- G03 closed the prior provisioning gap by adding and Production-verifying a normal ADMIN product/API path for explicit individual LeaveQuota provisioning.
- The validated G03 path preserves fallback/default behavior for legacy compatibility while allowing explicit entitlement provisioning for new employees.
- G03 Promotion performed no schema migration, no bulk backfill, and no Production quota mutation during validation or Promotion.
- G03.1 adds Gregorian quotaYear authority for annual quota accounting. Fresh checkpoint verification records 64 authoritative linked 2026 rows, 3 unmatched/unlinked NULL-year rows, and no second-year authority rows.
- Existing 2026 rows were not reset. Promotion verification recorded SICK 1856 / 15 / 1841, PERSONAL 164 / 3 / 161, and VACATION 299 / 15 / 284. A later legitimate 2026 provisioning event (outside the checkpoint task) increased entitlement by exactly the normal 30 / 3 / 6 defaults; the fresh checkpoint snapshot records SICK 1886 / 15 / 1871, PERSONAL 167 / 3 / 164, and VACATION 305 / 15 / 290.
- New annual defaults 30 / 3 / 6 apply only when creation of new annual entitlements is permitted after separate multi-year activation approval; they did not reset existing 2026 rows.
- G03_1_MULTI_YEAR_WRITES_ENABLED remains deliberately INACTIVE. Non-2026 annual creation, cross-year missing-authority creation, and NULL→non-2026 classification remain backend-gated.
- G03.1 Promotion created no quota rows, no second-year authority, no activation row, and no business-data mutation.
- The G03.1 Production rollback checkpoint is verified at rollback/g03-1-annual-leave-quota-rollover-v1-prod-2026-08-17 → 0951d4ce08de817dda7b986924232e86e745b532. Activation is still not complete and must not be represented as complete.

Classification: COMPLETE for explicit G03 quota provisioning; G03.1 annual rollover is PROMOTED / PRODUCTION VERIFIED with multi-year activation deliberately pending. The overall Leave capability remains PARTIAL because broader operational acceptance remains.

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
| G03.1 Technical UAT 31989684604 | 11 PASS / 0 FAIL / 46 SKIP |
| G03.1 Full Auth 31994339618 | 55 PASS / 0 FAIL / 2 controlled SKIP / 0 uncontrolled SKIP |
| ADMIN / MANAGER / VIEWER | PASS / PASS / PASS |
| Artifact leak | 0 |
| Business writes attributable to Auth UAT | 0 |
| Heavy-read safety | outstanding 0; drain complete |
| Promotion 31996411117 | SUCCESS; exact existing deployment; HTTP 201; dispatch count 1 |
| Critical post-promotion runtime signatures | All 0 |

The trusted Harness for G03.1 is
a561b3bf6884c9d464aaba57b5974dff1f37c2b6. The current main is
e4bde1265ffb6b7daa9260d8465b46dd27008ab0.

The two Full Auth skips were controlled: the destructive disposable-employee lifecycle suite and the canonical-versus-candidate benchmark. No uncontrolled skip or Auth failure remained.

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

- Release: G03.1 — ANNUAL LEAVE QUOTA ROLLOVER V1
- Production SHA: 0951d4ce08de817dda7b986924232e86e745b532
- Application tree: dfacd4261df08139f21bebd498ce709954163b8b
- Production deployment: dpl_FmYkoc5hfCJ6g6xyGfdvufE56sYs
- Canonical URL: https://sms-v3-staging-ten.vercel.app
- Status: PROMOTED / PRODUCTION VERIFIED
- Migration: 202608170001_annual_leave_quota_year — APPLIED EXACTLY ONCE before Promotion
- 2026 classification: VERIFIED
- Activation: INACTIVE (G03_1_MULTI_YEAR_WRITES_ENABLED setting MISSING)
- Trusted Harness: a561b3bf6884c9d464aaba57b5974dff1f37c2b6
- Final Technical run: 31989684604
- Final Full Auth run: 31994339618 (55 PASS / 0 FAIL / 2 controlled SKIP / 0 uncontrolled SKIP)
- Promotion CI run: 31996411117 (SUCCESS; exact existing deployment; HTTP 201; one Promotion API execution)
- Previous Canonical: dpl_rK4D47D2HaJ2ur4cLV1YfWtnu2eL / 1701bcf90a1998ea4999ee02e687172295984c9a (historical G03 Production identity)
- Current rollback checkpoint: rollback/g03-1-annual-leave-quota-rollover-v1-prod-2026-08-17 → 0951d4ce08de817dda7b986924232e86e745b532 (VERIFIED 2026-08-17).
- Historical G03 checkpoint preserved: rollback/g03-leave-quota-provisioning-v1-prod-2026-08-17 → 1701bcf90a1998ea4999ee02e687172295984c9a.
- G03.1 multi-year activation is NOT complete. Multi-year writes remain deliberately INACTIVE pending separate owner activation approval.
- Rollback safety boundary: BEFORE multi-year activation, the G03.1 checkpoint above is the preferred Production rollback point. AFTER the first non-2026 annual authority exists, old G03 SHA 1701bcf90a1998ea4999ee02e687172295984c9a is DATA-INCOMPATIBLE / DO NOT ROLLBACK TO because old G03 uses employee-only quota lookup semantics.
- G04: PAUSED

### Preserved historical milestones

The following entries are recovered historical evidence supplied by the prior
release record. They are not claims that those deployments are current.

#### G03 — LEAVE QUOTA PROVISIONING V1

- Historical Canonical deployment immediately before G03.1 Promotion: dpl_rK4D47D2HaJ2ur4cLV1YfWtnu2eL.
- Historical Production SHA: 1701bcf90a1998ea4999ee02e687172295984c9a.
- Historical status: PROMOTED / PRODUCTION VERIFIED / CLOSED.
- Historical rollback checkpoint remains current until a separately authorized G03.1 checkpoint is created: rollback/g03-leave-quota-provisioning-v1-prod-2026-08-17 → 1701bcf90a1998ea4999ee02e687172295984c9a.

#### ADMINISTRATIVE RBAC SURFACE ALIGNMENT V1

- Prior Canonical deployment: dpl_9kb9pKc14A5zMWo6AFeM6JqSWusk
- Prior Production SHA: 148c7b8ab17698c011008335c23b99895bba7bf8
- Status before G03 Promotion: PRODUCTION VALIDATED
- Preserved as historical prior Canonical evidence; deployment was not deleted.
- Historical rollback checkpoint preserved: rollback/admin-rbac-surface-alignment-v1-prod-2026-08-16 → 148c7b8ab17698c011008335c23b99895bba7bf8. It was not deleted, moved, renamed, or overwritten when the G03 checkpoint was created.

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

#### G03 — Leave Quota Provisioning — CLOSED

The prior gap was the absence of a normal Admin product/API path to provision an individual LeaveQuota row. G03 added that explicit provisioning surface and the exact immutable release was Production promoted and verified. Final Technical, Focused Auth, and Full Auth gates passed; G03 quota mutations and unexpected business writes were 0; no migration or bulk backfill occurred. G03 is CLOSED.

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

- G03 is CLOSED and Production verified. G04 and G05 remain open and must be designed, implemented, and validated in their own bounded release phases.
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
- Do not solve G04–G05 by changing pool settings, widening timeouts, adding blind retries, or mutating Production data without a separately approved design.
- Do not expand the current Feature Complete gate with future product capabilities before closing G04, G05, and the required P2 acceptance evidence.

Historical or future scope not stated in this file is deferred or
NOT RECOVERABLE, not silently approved.

---

## Section 18 — Next Recommended Development Sequence

1. G04 — REGISTRATION PRIVACY HARDENING
   - Replace broad anonymous roster enumeration with narrow identity lookup.
2. G05 — LICENSE DOCUMENT DELETE AUDIT TOMBSTONE
   - Preserve non-sensitive deletion history without preserving private files.
3. Complete the P2 final acceptance items G06–G12.
4. Apply a feature freeze to the current V3 core.

---

## POST-FEATURE-COMPLETE PRODUCT VISION

Classification: OWNER FUTURE VISION — NOT CURRENT FEATURE-COMPLETE BLOCKERS

After G04, G05, and final operational acceptance are complete, future platform expansion may be scoped separately:

1. Time Attendance.
2. Security Guard Checkpoint Scanning.
3. Expanded Security Reporting:
   - guard behavior reports;
   - Visitor Management and person entry/exit reporting;
   - damage and defective-asset incident reporting.

These are substantial future platform expansions. They do not block current SMS V3 Feature Complete and must not displace the bounded G04/G05 sequence without an explicit Owner priority change.

---

## Reconstruction Change Log

| Date | Change |
| --- | --- |
| 2026-08-16 | Created this reconstructed authoritative baseline after the original Master was confirmed not recoverable. |
| 2026-08-17 | G03 Leave Quota Provisioning V1 promoted to exact Canonical Production deployment dpl_rK4D47D2HaJ2ur4cLV1YfWtnu2eL; post-health/readiness/runtime verified; G03 CLOSED; prior Canonical preserved; rollback checkpoint unchanged. |
| 2026-08-17 | Created and remotely verified rollback/g03-leave-quota-provisioning-v1-prod-2026-08-17 at exact Production SHA 1701bcf90a1998ea4999ee02e687172295984c9a; previous admin-RBAC rollback checkpoint preserved; Canonical and Production remained unchanged. |
