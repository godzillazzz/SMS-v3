# SMS — OWNER PROJECT HANDOFF

> START HERE FOR A NEW CHAT / CODEX SESSION.
> Read this complete file before proposing, modifying, integrating, testing, or releasing SMS V3.

Last Updated:
2026-08-22

Repository:
godzillazzz/SMS-v3

This is the single canonical project-continuity document. Future approved updates must update/overwrite this same file rather than creating V2/V3/FINAL/date-stamped handoff copies.

Historical implementation detail remains available in Git history. This file is the current Owner-authoritative state, release baseline, governance policy, and forward-work lock.

---

## CURRENT PRODUCTION — AUTHORITATIVE BASELINE

Canonical Production:
https://sms-v3-staging-ten.vercel.app

Current Production deployment:
dpl_FAEJmdXEmTcCuDAzqVznwq75CdLL

Current Production immutable URL:
https://sms-v3-staging-h0ezqql3e-godzillazz.vercel.app

Current Production SHA:
db0bf9c8ece06db467cb7690ad4d6fadd941a04b

Current Production release lineage:
MOBILE RESPONSIVE V1
+
inherited G05 / EMAIL-01P behavior
+
LEAVE P2028 TRANSACTION RELIABILITY HOTFIX

Current Production state:
READY

Canonical cutover:
PASS

Post-release smoke:
- health: PASS 3/3
- ready: PASS 3/3
- database: ok
- root: 200
- login: 200
- unauthenticated auth/me: 401
- runtime environment-validation errors: 0
- runtime startup errors: 0
- runtime database errors at release gate: 0
- runtime fatal errors: 0
- runtime unexpected 5xx at release gate: 0

Production release mutations for the Leave hotfix:
- migration: 0
- schema mutation: 0
- manual data mutation: 0
- environment mutation: 0
- DNS mutation: 0
- storage mutation: 0

### CURRENT IMMEDIATE ROLLBACK AUTHORITY

For the next release, the current known-good Production rollback baseline is:

Deployment:
dpl_FAEJmdXEmTcCuDAzqVznwq75CdLL

SHA:
db0bf9c8ece06db467cb7690ad4d6fadd941a04b

Do NOT use an older pre-P2028 deployment as the normal next-release rollback baseline unless the Owner explicitly authorizes such a deeper rollback.

The previous Production before the Leave hotfix remains historical evidence:
- deployment: dpl_8V5bWpjYpfGEG1nPsjyAEvxKtS8P
- SHA: 6b899c0c613ded6dcb28744448c5f5562c6ae8cc

---

## PRODUCTION BASELINE LOCK — LEAVE P2028 HOTFIX

The Leave approval incident where MANAGER could not approve a real leave request is CLOSED.

Root cause:
PRODUCTION_DATABASE_TRANSACTION_TIMEOUT

Prisma code:
P2028

Affected real Production leave used to prove the incident and controlled retry:
83757a3a-17eb-4699-98b1-40a146702548

Production evidence before the hotfix proved repeated HTTP 503 / P2028 transaction timeouts while surrounding DB-backed endpoints were also abnormally slow.

Hotfix branch:
fix/production-leave-p2028-transaction-reliability-v1

Base SHA:
6b899c0c613ded6dcb28744448c5f5562c6ae8cc

Product SHA:
668682900a12ca1b1506160690491bd30a7f0fa7

CI-only / final Production SHA:
db0bf9c8ece06db467cb7690ad4d6fadd941a04b

Exact-head CI:
- run: 32550688964
- job: 96976813434
- result: SUCCESS

Locked transaction behavior:
- isolationLevel: ReadCommitted
- maxWait: 5000 ms
- timeout: 15000 ms
- P2028 maps to HTTP 503 with public code LEAVE_APPROVAL_TRANSACTION_TIMEOUT
- automatic transaction retry: NO
- all authoritative approval writes remain inside one transaction
- partial approval remains prohibited
- stage timing instrumentation must not emit PII/secrets

The approval transaction must continue to preserve:
- Leave row lock
- authorization/RBAC
- Manager self-approval prohibition
- quota ensure/lock and approved-usage validation
- AL ShiftType lookup
- ShiftAssignment upsert
- LeaveRequest status update
- AuditLog write
- post-commit notification behavior

### CONTROLLED PRODUCTION RETRY — PASS

The real Owner-controlled retry was performed once by the Manager and succeeded.

Result:
- HTTP: 200
- transaction outcome: COMMITTED
- request ID: sin1::ccxqm-1787373608520-89bc8d8aab04
- transaction duration: 5584.82 ms
- Prisma P2028: NO
- Leave status: APPROVED
- employee leave-approved email: sent successfully after commit

Stage timings from the successful Production retry:
- leave_lock_read: 619.89 ms
- approval_authority: 1235.07 ms
- quota_ensure: 927.86 ms
- quota_lock: 309.37 ms
- approved_usage_lookup: 309.45 ms
- employee_lookup: 620.55 ms
- al_lookup: 620.44 ms
- shift_upsert: 320.39 ms
- leave_update: 313.76 ms
- audit: 310.33 ms

Incident status:
CONTROLLED_PRODUCTION_RETRY=PASS
INCIDENT_CLOSED=YES
ROLLBACK_REQUIRED=NO

### PERMANENT RELEASE RULE FROM THIS INCIDENT

ALL future SMS V3 releases must preserve the Leave P2028 hotfix.

Do NOT promote an older candidate directly over Production if that candidate predates SHA db0bf9c8ece06db467cb7690ad4d6fadd941a04b.

Future work such as Employee Master and Approval Workflow Standard must integrate onto the current Production lineage containing the P2028 fix.

Do NOT re-fix the Manager leave-approval incident in another branch unless new evidence proves a regression.

### SEPARATE RELIABILITY TRACK

Production and Preview have shown multi-second database-backed request latency beyond the Leave approval route.

This is a separate future workstream:
SMS V3 — PRODUCTION DATABASE / SUPABASE POOLER PERFORMANCE & RELIABILITY V1

Do NOT mix Supabase/Pooler tuning into the closed Leave hotfix or unrelated Employee Master/approval-workflow commits.

Do NOT change DATABASE_URL, DIRECT_URL, connection_limit, pool_timeout, connect_timeout, Pooler mode, or Production environment as part of unrelated feature work.

Operational monitoring for recurrence of Prisma P2028 is enabled separately.

---

## MOBILE RESPONSIVE V1 — VERIFIED PRODUCTION FOUNDATION

Released branch:
fix/production-mobile-responsive-v1

Released SHA:
6b899c0c613ded6dcb28744448c5f5562c6ae8cc

Released tree:
d6c6e79a2b39256906e76863befde7b04e881cab

Owner real iPhone Safari review:
PASS

Important responsive fixes inherited by current Production include:
- shared body-level reference-counted document scroll lock
- body-level portals for mobile overlays/drawers where required
- Leave Request mobile width/scroll repair
- Leave History mobile cards
- License search mobile height repair
- OperationalRecordDrawer body portal
- License / Leave Quota iOS drawer repair
- deliberate mobile Schedule horizontal interaction
- visible Schedule delete control 30x30 with 44x44 effective touch target
- header / safe-area responsive correction

Do not regress these behaviors during future integrated releases.

---

## EMAIL-01P — VERIFIED PRODUCTION POLICY

Current Production inherits the verified EMAIL-01P behavior.

Active notification policy includes:
- Registration OTP → submitted email
- Password Reset OTP → eligible account email
- verified/reviewable registration request → active ADMIN + MANAGER reviewers
- registration approved/rejected → applicant after decision commit, idempotent
- leave request created/submitted → linked active employee + active ADMIN/MANAGER as implemented
- leave approved/rejected/cancelled → linked active employee user where applicable
- approved monthly schedule → eligible employees represented by authoritative assignments only

Rules:
- OTP delivery is authentication-critical and separate from ordinary optional business notifications.
- Business-notification delivery failure must not roll back authoritative business transactions.
- Group recipients must not expose recipient addresses to each other.
- Schedule notification must not use a broad all-user fallback.
- There is no active Attendance email behavior unless a later Owner-approved release explicitly adds it.

Never store SMTP credentials or addresses in this handoff.

---

## EMPLOYEE MASTER GOVERNED EDIT V1 — CANDIDATE READY / NOT PRODUCTION

Branch:
feature/employee-master-governed-edit-v1

Base at feature start:
6b899c0c613ded6dcb28744448c5f5562c6ae8cc

Product SHA:
b570862ef7964d1679a6924dfa6a1a00834d6276

Product tree:
5344b155d00c2bd62fe03308b0e69fcd20b12635

CI-only / final candidate SHA:
a082bb8b4b28f07bc2c3ad6951d87fd2de0e156c

Final candidate tree:
f4a08748cce67ecea93c276b4d79ca465476db06

Exact-head CI:
- run: 32496391030
- job: 96815693634
- result: SUCCESS

Exact Preview:
- deployment: dpl_cYi4mtT7tEpNtwQsphSpoQGpuX4h
- URL: https://sms-v3-staging-33aof1gec-godzillazz.vercel.app
- ref: feature/employee-master-governed-edit-v1
- SHA: a082bb8b4b28f07bc2c3ad6951d87fd2de0e156c
- state: READY

Migration:
202608210001_employee_master_governed_edit_v1

The candidate adds governed EmployeeChangeRequest / Revision / Event structures and preserves immutable request history.

Owner-locked Employee Master authority:

ADMIN edit
→ may apply authorized Employee Master changes directly
→ Audit required

MANAGER edit
→ governed request
→ authoritative Employee Master remains unchanged until ADMIN final approval

Manager old direct PUT bypass is blocked.

The candidate supports:
- Admin direct edit
- Manager submit
- Admin review
- Return for Correction
- Resubmit
- Approve
- Reject
- Cancel
- one active request per Employee
- future-effective status changes
- whole-master stale conflict fail-closed
- schedule projected-status validation
- immutable revisions/events
- shared authoritative mutation service

Closed Preview/UAT gates include:
- Admin direct edit: PASS
- Manager submit: PASS
- Admin review: PASS
- Return: PASS
- Resubmit: PASS
- Approve: PASS
- Reject: PASS
- Cancel: PASS
- one-active-request: PASS
- Manager bypass blocked: PASS
- future-effective: PASS
- stale conflict: PASS
- schedule projected-status: PASS
- governed viewport 390x844: PASS
- governed viewport 360x800: PASS
- governed viewport 768x1024: PASS
- governed viewport 1440x960: PASS
- governed editor open/close cycles: PASS
- governed review open/close cycles: PASS
- route cleanup: PASS
- stale conflict visual UX: PASS
- Preview responsive evidence: PASS
- Mobile Responsive V1 focused regression: PASS
- Preview runtime gate: PASS
- Product source changes after lock: 0
- worktree clean: YES

UAT run IDs:
- R2-20260822023309-738C25
- R2-SCHED-20260822025546-EADB17

Preview UAT records intentionally left with explicit ZZZ-UAT labeling where supported deletion would violate lifecycle/history governance. Broad/raw cleanup must not be used merely to remove governed evidence.

Final candidate status:
SMS_EMPLOYEE_MASTER_GOVERNED_EDIT_V1_CANDIDATE_READY

OWNER_REVIEW=PENDING / IN PROGRESS
PRODUCTION_RELEASE=NO

### EMPLOYEE MASTER RELEASE INTEGRATION LOCK

Do NOT promote SHA a082bb8b4b28f07bc2c3ad6951d87fd2de0e156c directly to Production.

That candidate predates the current Production Leave P2028 lineage.

Future release must create a NEW integrated candidate based on current Production SHA:
db0bf9c8ece06db467cb7690ad4d6fadd941a04b

Then integrate the Employee Master product changes while preserving the P2028 hotfix and Mobile Responsive/EMAIL behavior.

Employee Master migration creation is already part of the candidate history; migration execution for any future Production release remains a separate explicit Owner gate.

---

## COMMON APPROVAL WORKFLOW STANDARD V1 — OWNER LOCKED SYSTEM-WIDE

This is NOT an Employee Master-only feature.

Any SMS V3 business workflow representing:

REQUESTER
→ REVIEWER
→ optional NEXT REVIEWER
→ FINAL APPROVAL

must use one common approval semantic while retaining module-specific business authority and authoritative mutation logic.

### REVIEWER ACTIONS — REQUIRED SEMANTICS

Every applicable review stage must support:

1. APPROVE
2. RETURN FOR CORRECTION
3. REJECT

APPROVE:
- advances to the next review stage if another reviewer stage exists
- does NOT complete the business workflow merely because an intermediate reviewer approves
- only approval by the FINAL APPROVER produces final APPROVED/COMPLETED state

RETURN FOR CORRECTION:
- recoverable, non-terminal
- request is NOT rejected
- authoritative business effect must not be applied
- request goes to the workflow-defined editable owner
- editable owner may correct and resubmit
- prior submitted revision/reviewer action remains immutable

REJECT:
- terminal reviewer decision
- state becomes REJECTED
- reject is not the same as Return or requester Cancel

### REQUESTER ACTIONS AFTER RETURN

When a request is RETURNED_FOR_CORRECTION, the editable requester/owner must have BOTH choices:

A. EDIT + RESUBMIT

B. CANCEL REQUEST

CANCEL REQUEST:
- terminal requester/authorized-owner withdrawal
- state becomes CANCELLED
- must remain semantically different from reviewer REJECTED

Where workflow policy permits, requester cancellation may also be allowed while still pending review, provided no terminal decision/business effect has occurred.

### MULTI-STAGE ROUTING

Example:

Employee SUBMIT
→ MANAGER_REVIEW

Manager:
- RETURN → editable requester corrects/resubmits
- REJECT → REJECTED
- APPROVE → COMPLETED if Manager is final approver
- APPROVE → ADMIN_REVIEW if Admin is required next

Admin:
- RETURN → return to the correct editable owner defined by workflow routing
- REJECT → REJECTED
- APPROVE → APPROVED / COMPLETED

Do NOT hard-code Admin Return → Employee.

Return target must be the workflow's editable owner / prior request-owner stage.

Example: if a Manager authored an Employee Master change request for Admin review, an Admin Return goes back to that Manager/request owner.

### IMMUTABLE AUDIT / EVENT VOCABULARY

Every applicable workflow transition must preserve immutable history for:
- CREATE / DRAFT where applicable
- SUBMIT
- RETURN_FOR_CORRECTION
- RESUBMIT
- STAGE_APPROVE
- FINAL_APPROVE
- REJECT
- CANCEL

Capture at minimum where architecture supports it:
- workflow/module
- request ID
- revision/version
- actor
- actor role
- timestamp
- previous state/stage
- next state/stage
- reason/comment where applicable

Never overwrite prior history to simulate a transition.

### AUTHORITATIVE MUTATION RULE

Pending or returned requests must not silently mutate authoritative business data unless a separately Owner-approved module model explicitly requires it.

Final authoritative mutation must remain module-specific and transaction-safe.

Shared approval semantics do NOT replace module-specific validation such as Leave quota/AL assignment, Registration identity/OTP controls, License expiry application, or Employee Master stale/future-effective rules.

---

## APPROVAL BUTTON / STATUS DESIGN STANDARD — OWNER LOCKED

The same semantics and visual meaning must be used across all applicable modules.

Do not allow each module to choose arbitrary approval colors.

### APPROVE
Thai label:
อนุมัติ

Semantic color:
GREEN

Suggested shared token:
#16A34A

Meaning:
positive reviewer action / advance to next stage / final approval

### RETURN FOR CORRECTION
Thai label:
ส่งกลับไปแก้ไข

Semantic color:
ORANGE

Suggested shared token:
#F59E0B

Meaning:
recoverable correction required

MUST NOT use Reject red.

### REJECT
Thai label:
ไม่อนุมัติ

Semantic color:
RED

Suggested shared token:
#DC2626

Meaning:
terminal reviewer rejection

### RESUBMIT
Thai label:
ส่งใหม่ / ส่งตรวจสอบอีกครั้ง

Semantic color:
PRIMARY BLUE

Suggested shared token:
#2563EB

Meaning:
requester sends corrected revision back to the workflow

### CANCEL REQUEST
Thai label:
ยกเลิกคำขอ

Semantic color:
RED OUTLINE / DESTRUCTIVE SECONDARY

Suggested treatment:
- border: #DC2626
- text: #B91C1C
- white/neutral background

Meaning:
requester withdrawal

Cancel must remain visually distinguishable from reviewer Reject.

### OTHER ACTIONS

SAVE DRAFT:
secondary/light blue

CLOSE / BACK:
neutral gray

DISABLED:
neutral disabled gray

Do not rely on color alone. Preserve explicit Thai labels, keyboard/focus accessibility, and disabled-state clarity.

Preferred shared semantic abstractions:
- btn-approve
- btn-return
- btn-reject
- btn-resubmit
- btn-cancel
- btn-save-draft
- btn-neutral

Preferred shared status semantics:
- status-approved
- status-returned
- status-rejected
- status-cancelled
- status-pending
- status-draft

The implementation may use equivalent shared components/tokens; exact CSS names are not mandatory. Semantic consistency is mandatory.

---

## APPROVAL WORKFLOW STANDARD — CURRENT IMPLEMENTATION PLAN

Before system-wide implementation, perform a READ-ONLY inventory/gap analysis across every actual request/review workflow.

At minimum inspect:
- Leave Request
- Employee Master Change Request
- Registration Request
- Employee License / License Document review
- Schedule-related submission/approval if true requester/reviewer semantics exist
- Attendance corrections/exceptions/device replacement when implemented
- any other discovered governed business request

Do not classify pure CRUD as an approval workflow without evidence.

For every workflow determine:
- requester roles
- reviewer stages
- final approver
- current statuses/actions
- Approve / Return / Reject support
- requester Cancel support
- Resubmit support
- revision history
- immutable transition audit
- authoritative mutation timing
- notification behavior
- button/status semantics
- API routes
- schema models/enums

Classify each workflow:
COMPLIANT / PARTIAL / NON_COMPLIANT / NOT_APPLICABLE

Typical gap codes include:
- MISSING_RETURN
- MISSING_REQUESTER_CANCEL
- MISSING_RESUBMIT
- APPROVE_COMPLETES_TOO_EARLY
- NO_STAGE_ROUTING
- RETURN_TARGET_HARDCODED
- REJECT_AND_RETURN_COLLAPSED
- CANCEL_AND_REJECT_COLLAPSED
- NO_REVISION_HISTORY
- AUDIT_NOT_IMMUTABLE
- AUTHORITATIVE_MUTATION_BEFORE_FINAL_APPROVAL
- BUTTON_SEMANTICS_INCONSISTENT
- STATUS_COLOR_INCONSISTENT

Preferred architecture direction:
shared approval semantics/policy + shared UI components/tokens + shared audit vocabulary,
while retaining module-specific routing and module-specific final authoritative mutation.

Do NOT force one giant generic database workflow engine if domain rules materially differ.

---

## LEAVE WORKFLOW — PRESERVATION REQUIREMENTS FOR FUTURE STANDARDIZATION

Current Production Leave approval is operational and proven after the P2028 hotfix.

Future addition of Return / Resubmit / Cancel semantics must preserve:
- P2028 transaction reliability hotfix
- ReadCommitted / 5000 ms maxWait / 15000 ms timeout
- controlled P2028 503 public behavior
- no automatic retry after uncertain transaction outcome
- Manager global approval scope as currently authorized
- Manager self-approval prohibition
- RBAC
- annual leave quota safety
- AL ShiftAssignment behavior
- exactly-once/atomic business effect as implemented
- audit
- notifications after authoritative transaction commit

Future Leave regression gate must prove at minimum:
- valid Manager approve: PASS
- Manager Return: PASS when implemented
- employee/requester Edit + Resubmit: PASS when implemented
- requester Cancel returned/pending request: PASS when policy allows
- Manager Reject: PASS
- self approval blocked: PASS
- Viewer blocked: PASS
- Admin behavior unchanged/authorized: PASS
- approved leave creates AL exactly once: PASS
- quota accounting correct: PASS
- controlled P2028 handling preserved: PASS
- no partial mutation: PASS

Do not reopen the closed P2028 incident merely because workflow states are added around it.

---

## EMPLOYEE MASTER — OWNER DOMAIN RULES

Unified Edit Employee combines ordinary Employee Master fields and employment-status governance.

Admin:
- direct authorized edit
- immediate authoritative mutation where policy permits
- Audit required

Manager:
- governed request only
- authoritative Employee unchanged until Admin final approval

Manager PII editing boundary currently excludes restricted Admin-only fields such as email/phone/hiredAt/skill as implemented in the candidate.

Employment lifecycle authoritative state remains based on existing Employee.isActive / ACTIVE / TERMINATED semantics.

Do not invent INACTIVE/RESIGNED enum values without separately locking their business meaning.

Future-effective status request:
- may become APPROVED before effective date
- actual Employee authoritative snapshot changes only at the approved effective time
- do not mix immediate and future-effective field semantics in a way that creates partial authority

Termination/schedule rule:
- do not auto-delete historical/future assignments merely because status changes
- surface conflicts
- block new operational shifts after projected termination/effective inactive state
- OFF / AL are not operational work shifts for this eligibility rule

Employee.email does not silently synchronize User.email.

Reference Photo is a future security-sensitive Employee Master extension point; no reference-photo/biometric/liveness implementation is part of Employee Master Governed Edit V1.

---

## EMPLOYEE MASTER NAME DATA-QUALITY NOTE

Separate from the Leave incident and from Employee Master feature logic:

EMP029 Production Master data was observed as:
ชยรบ วัดแก้ว

Owner-confirmed correct name:
ชยธน วัดแก้ว

This is an Employee Master data-quality correction requiring proper authoritative/audited correction.

Do NOT treat this name difference as the Leave P2028 root cause.

Do NOT rewrite historical LeaveRequest snapshots merely to make them match a later corrected Employee Master name unless a separate historical-correction policy explicitly authorizes it.

---

## REGISTRATION / OTP SECURITY PRINCIPLES

Employee Code is local/non-authoritative and must not be used for public identity, duplicate-person identity, auto-match, or roster exposure.

OTP proves control of the submitted email only; it does not prove Employee/User ownership.

SubmittedName is a non-authoritative hint.

No fuzzy public Employee identity lookup.

Do not weaken:
- OTP verification
- single-active OTP semantics where implemented
- no employee roster exposure
- existing-account guard
- duplicate-registration guard
- Admin/Manager controlled matching/activation

Return for Correction in Registration must be designed so applicant re-entry/editing remains privacy-safe and does not expose Employee roster/account existence improperly.

---

## LICENSE DOCUMENT GOVERNANCE

Security-guard license document feature includes private document storage, upload/history/view, Admin review, and authoritative expiry update on approval.

Owner rules include:
- file size <= 4 MB
- allowed document types PDF/JPEG/PNG as implemented
- Admin review/approval
- Admin may approve own document where current policy explicitly permits
- view without ordinary download UX
- approved expiry becomes authoritative only after the authorized approval effect

Future Approval Workflow Standard work must inventory whether Return + Resubmit + Cancel can be added safely without changing approved historical records or weakening audit/storage controls.

---

## G06 / G07 ATTENDANCE/PATROL IDENTITY SECURITY MODEL — OWNER APPROVED DIRECTION

Attendance/Patrol security stack remains:

ACCOUNT / PASSKEY
+
PERSONAL DEVICE ENROLLMENT
+
CRYPTOGRAPHIC DEVICE CREDENTIAL
+
GPS / GEOFENCE
+
STATIC SECURE PAPER QR
+
EMPLOYEE REFERENCE PHOTO
+
1:1 LIVE FACE VERIFICATION
+
LIVENESS / ANTI-SPOOF
+
SCHEDULE / SHIFT / ROUTE AUTHORITY
+
SERVER TIME
+
ANTI-REPLAY / IDEMPOTENCY
+
RISK ENGINE
+
CONTROLLED OFFLINE FALLBACK

### PHOTO / FACE POLICY

Owner-approved current direction:
- one authoritative Employee Reference Photo may be retained per Employee
- no Attendance check-in event photo retention
- no Attendance check-out event photo retention
- no routine Patrol employee event photo retention
- live verification frames are temporary and discarded after verification
- QR camera frames are not retained as evidence
- face verification is 1:1 against the already-known Employee
- broad 1:N roster identification/search is NOT approved
- liveness/anti-spoof is required with face matching
- persistent biometric templates/embeddings are NOT automatically authorized

Face verification is an additional anti-buddy-punching control. It does not replace account/passkey, personal device enrollment, device credential, GPS/geofence, QR, Schedule/Shift authority, Server Time, Anti-Replay, Risk Engine, or Controlled Offline.

Face/liveness failure is a verification/risk outcome, not automatic proof of misconduct.

### DEVICE ENROLLMENT

Default:
1 Employee = 1 ACTIVE primary Attendance/Patrol device at a time.

Device replacement authority:
ADMIN ONLY

Required conceptual flow:
New phone → Login → Request device change → Admin approves → old device REVOKED → new device ACTIVE

Manager approval is not sufficient for primary Attendance/Patrol device replacement.

### STATIC SECURE PAPER QR

Operational sites/checkpoints may use printed paper QR.

QR must use an unguessable token/reference and must be validated together with account, active enrolled device, GPS/accuracy, expected site/checkpoint, geofence, server validation/time, assignment/route authority, and face/liveness where Attendance policy requires it.

A copied QR away from the physical location must not become normal verified attendance/patrol evidence.

### OFFLINE DIRECTION

Architecture:
ONLINE FIRST → CONTROLLED OFFLINE FALLBACK → AUTO SYNC → SERVER VALIDATION

Controlled offline must preserve stable captureId/idempotency, capturedAt and receivedAt separately, GPS/accuracy, secure QR context, enrolled device proof, cached/signed expected schedule/site context where applicable, and approved identity-verification result/proof.

Do NOT solve offline face verification by silently storing raw face images for later server comparison.

If secure Web/PWA offline face/liveness proves insufficient, surface a separate Android hardening architecture gate rather than weakening the no-event-photo rule.

No continuous GPS tracking.

---

## DATA RETENTION ARCHITECTURE — OWNER APPROVED

Initial rolling raw-data defaults:
- System Operational / Usage Logs: 6 calendar months
- Attendance Raw Events: 12 calendar months
- Patrol / Checkpoint Raw Scans: 3 calendar months

Timezone/calendar authority:
Asia/Bangkok

Retention must be calendar-month/year based, not approximate fixed-day conversions.

For controlled-offline data, raw retention age follows authoritative validated occurrence/capture timing, not merely later sync receipt.

Official Attendance/Patrol monthly summary/certification records are outside the raw-event purge unless later explicitly changed.

Employee Reference Photo is Employee Master security/reference data, not an Attendance raw event.

Security/Governance Audit is separate from 6-month operational logs and must fail closed out of operational-log purge until its own retention duration is approved.

### ADMIN-CONFIGURABLE RETENTION

Initial Admin UI defaults:
- System Operational Logs: 6 months
- Attendance Raw Events: 12 months
- Patrol Raw Scans: 3 months
- Automatic Daily Cleanup: enabled

Initial safety bounds:
- Operational Logs: 1–24 months
- Attendance Raw: 3–36 months
- Patrol Raw: 1–24 months

Retention changes must be audited.

Increasing retention does not restore already purged data.

Decreasing retention requires:
1. impact preview
2. cutoff / eligible count where practical
3. explicit Admin confirmation
4. save new policy
5. controlled worker applies deletion
6. safety delay, initial target approximately 24 hours

Do not hard-delete inside the same settings Save request.

Retention worker must be batch-safe, retry-safe, scoped by data class, compactly audited, and fail closed on ambiguity.

---

## SELF-HOST / INFRASTRUCTURE DIRECTION

Current Vercel/Supabase hosting may continue while G06/G07 are developed and measured.

Self-host is a future option, not a prerequisite solely because Attendance/Patrol exists.

Known future candidates:
- Dell R330: main/Production candidate, health/controller/storage verification required before any Production use
- Dell R520: backup/restore candidate

Preferred future host OS if self-hosted:
Ubuntu Server 24.04 LTS bare metal

Do not use Windows Server 2008 R2 as an internet-facing SMS Production host.

Do not perform self-host Production cutover without separate explicit Owner authorization.

Future custom domain has been discussed but is not locked.

Before real controlled-offline/PWA employee rollout, Owner must explicitly lock the rollout origin strategy because IndexedDB, Service Worker, Cache Storage, cookies, device-local keys, and WebAuthn/passkeys are origin-sensitive.

Do not roll out a critical offline queue on a temporary origin and then change origin without a controlled migration/cutover plan.

---

## LOCAL FILESYSTEM BOUNDARY — PERMANENT OWNER RULE

AUTHORITATIVE LOCAL WORKSPACE ROOT:

C:\Users\sermp\OneDrive - PTTPLC\04_SSO\ปี-2569\40.AI\ระบบ Security Management System V3

ALL SMS project-controlled local filesystem operations must remain inside this root.

This includes repository clones, Git worktrees, isolated release clones, source copies, documentation, evidence, screenshots, reports, patches, exports, scripts, project-controlled temporary files, and local backup staging.

Do NOT intentionally create SMS project workspaces/artifacts in Windows Temp, Documents, Desktop, Downloads, arbitrary C:\Temp, another OneDrive folder, or another clone outside the authorized root.

Before major local CODEX work verify:

AUTHORIZED_WORKSPACE_ROOT=<path above>
ACTIVE_WORKING_DIRECTORY=<actual path>
WORKSPACE_BOUNDARY_CHECK=PASS

If the working directory is not a descendant of the authorized root:
SMS_LOCAL_WORKSPACE_BOUNDARY_VIOLATION
STOP.

System-managed caches/temp used internally by OS/Git/Node/browser/Docker are not project-controlled artifacts and are not governed by this path rule unless CODEX intentionally chooses them as the project workspace.

---

## CANONICAL HANDOFF LOCAL BACKUP — PERMANENT OWNER RULE

Canonical repository handoff:
docs/OWNER_PROJECT_HANDOFF.md

Required Owner local/OneDrive copy:

C:\Users\sermp\OneDrive - PTTPLC\04_SSO\ปี-2569\40.AI\ระบบ Security Management System V3\OWNER_PROJECT_HANDOFF.md

After CODEX updates the repository handoff and pushes/verifies the final branch, CODEX must:
1. copy the final repository handoff to the local path above
2. OVERWRITE the same OWNER_PROJECT_HANDOFF.md
3. do not create V2/V3/FINAL/date-stamped duplicates
4. compute SHA256 of repository source and local destination
5. require matching hashes

Expected success:
LOCAL_HANDOFF_BACKUP=VERIFIED

If repository update succeeds but local backup cannot be performed, do not rewrite Git history. Report the limitation and do not falsely claim local handoff backup verification.

---

## SAFETY / RELEASE RULES

- GitHub is the remote source of truth.
- Exact SHA/tree identity is required.
- Exact-head Remote CI is required before Production release unless Owner explicitly authorizes a documented exception.
- No Production deployment without explicit Owner authorization.
- No Production migration without explicit Owner authorization.
- No Production environment/data/schema/DNS/storage mutation without explicit Owner authorization.
- Never deploy from a dirty or wrong worktree.
- Use isolated worktrees/clones under the authorized workspace root.
- Never record passwords, tokens, cookies, private keys, SMTP credentials, biometric templates, or similar secrets in this handoff.
- No destructive Production UAT.
- Never edit live source directly on a Production server.
- Preserve current known-good Production rollback authority.
- Do not promote arbitrary old Preview deployments.
- Migration creation and Production migration execution are separate gates.
- Inactive employees remain historical records, not current operational workload.
- Operational eligibility remains isActive === true && deletedAt === null unless later explicitly superseded.
- Risk flags are evidence for review, not automatic accusations.
- Approval-loop transitions must distinguish Returned for Correction, Rejected, Cancelled, intermediate approval, and final approval.
- Manager-originated Employee Master changes must not mutate authoritative master data before Admin final approval.
- Routine Attendance/Patrol event-photo retention remains prohibited under current policy.
- Retention deletion must be policy/data-class scoped and fail closed on ambiguity.

---

## CURRENT WORK PRIORITY / NEXT PLAN

1. Preserve current Production SHA db0bf9c8ece06db467cb7690ad4d6fadd941a04b as the mandatory release baseline containing the proven Leave P2028 fix.
2. Do NOT directly promote the older Employee Master candidate over Production.
3. Complete Owner review of the Employee Master candidate Preview as needed.
4. Perform the system-wide Approval Workflow Standard V1 READ-ONLY inventory + gap analysis before implementation.
5. Based on that inventory, implement shared approval semantics/UI tokens/audit vocabulary in controlled phases while retaining module-specific business logic.
6. Create a NEW integrated release candidate from current Production SHA db0bf9c8... and integrate Employee Master + authorized Approval Workflow changes without losing the Leave P2028 hotfix.
7. Run focused regression gates including Leave Manager approval/P2028 preservation, Mobile Responsive V1, Employee Master governed flows, RBAC, and exact migration provenance before any Production release request.
8. Keep Supabase/Pooler performance tuning as a separate reliability branch/workstream; do not mix it into feature/hotfix commits.
9. Continue future G06/G07 identity/device/QR/offline/retention architecture only under their separate Owner gates.

---

## CURRENT GATE SUMMARY

CURRENT_PRODUCTION_DEPLOYMENT=
dpl_FAEJmdXEmTcCuDAzqVznwq75CdLL

CURRENT_PRODUCTION_SHA=
db0bf9c8ece06db467cb7690ad4d6fadd941a04b

LEAVE_P2028_INCIDENT=
CLOSED / CONTROLLED PRODUCTION RETRY PASS

EMPLOYEE_MASTER_CANDIDATE=
SMS_EMPLOYEE_MASTER_GOVERNED_EDIT_V1_CANDIDATE_READY

EMPLOYEE_MASTER_OWNER_REVIEW=
PENDING / IN PROGRESS

EMPLOYEE_MASTER_PRODUCTION_RELEASE=
NO

APPROVAL_WORKFLOW_STANDARD_V1=
OWNER SEMANTICS LOCKED / SYSTEM-WIDE INVENTORY NEXT

PRODUCTION_DATABASE_POOLER_PERFORMANCE=
SEPARATE RELIABILITY WORKSTREAM / NOT PART OF CLOSED LEAVE HOTFIX

---

## NEW CHAT / NEW CODEX SESSION

Before doing any work:

1. Read this entire file.
2. Verify CURRENT PRODUCTION separately from any candidate/Preview.
3. Treat db0bf9c8ece06db467cb7690ad4d6fadd941a04b as the current Production baseline until a later explicitly authorized release supersedes it.
4. Never directly promote an older candidate in a way that removes the Leave P2028 fix.
5. Verify Git SHA/tree before modifying source.
6. Verify the local workspace is inside the permanent authorized root.
7. Treat Owner-approved workflow, release, security, retention, and UI semantic rules in this document as authoritative unless explicitly superseded by the Owner.
8. Update/overwrite THIS SAME FILE after each major approved gate.
9. After successful CODEX push, overwrite the required local OneDrive handoff copy and verify SHA256 equality.
