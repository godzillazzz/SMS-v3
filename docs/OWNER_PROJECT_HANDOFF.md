# SMS — OWNER PROJECT HANDOFF

> START HERE FOR A NEW CHAT / CODEX SESSION.
> Read this complete file before proposing or modifying the SMS project.

Last Updated:
2026-08-21

Repository:
godzillazzz/SMS-v3

This is the single canonical project-continuity document. Future approved
updates must update/overwrite this same file rather than creating versioned
handoff copies.

## CURRENT PRODUCTION

Production is separate from the current development/self-host candidate.
G06 is not Production.

- Production application SHA: 94b4667771006b00759ddf6f0ec447d27400206c
- Production tree: 31e1dbe6c5fb4f8aa47f41052d1d1ae31cfd9f3e
- Production release: G05 — License Document Permanent-Delete Audit Tombstone
- Production deployment: dpl_GLmDVZHQwrEkvBuUwuDcvSzNRf5Z
- Canonical current Vercel hostname: sms-v3-staging-ten.vercel.app
- Rollback deployment: dpl_xKvsNaKHJLabrSH3J3aHUUzNoUpZ

EMAIL-01P has an Owner-authorized isolated Production backport candidate, but
Production must NOT be described as upgraded until the fresh exact-SHA
Production deployment, canonical cutover, health/ready, runtime, and rollback
gates are all verified.

Do not deploy the complete current development lineage directly to Production
merely to release EMAIL-01. It also contains G06/self-host work that is not yet
Production-authorized.

## EMAIL-01P PRODUCTION BACKPORT — OWNER AUTHORIZED, RELEASE VERIFICATION PENDING

Owner authorization has been granted to deploy the isolated EMAIL-01P
Production backport.

Authoritative release candidate:

- Branch: fix/email-01-production-backport-v1
- Base Production SHA: 94b4667771006b00759ddf6f0ec447d27400206c
- Base Production tree: 31e1dbe6c5fb4f8aa47f41052d1d1ae31cfd9f3e
- Product backport SHA: 2c83f4e1527ad100395c97bcec8ca8f8a1fcc1b2
- CI-only / final release SHA: 39f28d5d0c0216672f28567b315501e7b7b64990
- Final release tree: 8d9672b936f8a9b24ee3d0b095df1ef31eacee57
- Remote CI run: 32451401152
- Remote CI job: 96680459866
- Remote CI result: SUCCESS
- Focused email tests: 32/32 PASS
- Backend: 539/539 PASS
- Integration: 108/108 PASS
- Frontend: 342/342 PASS
- TypeScript/build: PASS
- Schema delta: 0
- New migrations: 0
- G06/self-host/Attendance files imported: 0
- Automatic Preview reference only: dpl_DMVPsbVrr5UTBCCSjCE5wizQbRTz — READY
- Preview URL: https://sms-v3-staging-3l2qzpqzs-godzillazz.vercel.app

Release rule:

- Use a fresh Production-target exact-SHA deployment from
  39f28d5d0c0216672f28567b315501e7b7b64990.
- Do NOT promote the automatic Preview above.
- No Production migration.
- No Production schema change.
- No Production environment mutation.
- No manual Production DB/data mutation.
- No DNS/storage mutation.
- Do not fabricate real-user business events merely to smoke-test email.
- Current G05 Production deployment remains the rollback authority until the
  new Production release is fully verified.

Required success status after release verification only:

SMS_EMAIL_01P_PRODUCTION_RELEASE_VERIFIED

Until that status is proven, CURRENT PRODUCTION above remains authoritative.

## CURRENT DEVELOPMENT

The current development lineage is EMAIL-01 on top of the G06/self-host
foundation. It is not the Production deployment.

- Development branch: fix/email-01-notification-policy-v1
- EMAIL-01 product commit: ad62b1b44755fe59064676e9a22aa4e13a56610b
- EMAIL-01 CI-only commit: 1aeef1d879b79bb9a8c27b82f8ebc17ee6f0fda7
- EMAIL-01 validated candidate SHA before documentation-only handoff updates:
  7aa7d7511f0c679b76ba98ef6737af39476bb3a2
- EMAIL-01 validated candidate tree:
  77ed5927a0857bb74dbd9d58cd265e4ede6aa469
- Remote CI run: 32449542272
- Remote CI job: 96675263111
- Remote exact-head CI result: PASS
- Frontend: 346/346 PASS
- TypeScript/build: PASS
- Automatic Preview: dpl_7Z5Masj2LMeGuMLRcs8bnDPiiTnL — READY
- Schema delta: 0
- New migrations: 0
- Production mutations for development-line EMAIL-01: 0
- Real-user email smoke: 0
- Status: SMS_EMAIL_01_CANDIDATE_READY

The canonical handoff must continue to be updated on this development lineage
after major approved gates.

## COMPLETED G06 GATES

- G06.0 — Architecture / Existing-System Fit / Self-host Audit: OWNER APPROVED
- G06.1A — Attendance Core Foundation: APPROVED
- G06.1B — Admin Configuration: COMPLETE
- Owner Visual Gate: APPROVED
- Preview Runtime Gate: VERIFIED
- Self-host Infrastructure Foundation: CANDIDATE READY / OWNER INPUT REQUIRED

Employee Attendance is not live in Production.

## EMAIL-01 OWNER-APPROVED POLICY

Implemented EMAIL-01 candidate behavior:

1. Registration OTP
   - Recipient: submitted email

2. Password Reset OTP
   - Recipient: active account email when eligible

3. Registration email verified / reviewable request created
   - Recipient: active ADMIN + MANAGER group

4. Registration approved
   - Recipient: applicant
   - Sent after decision transaction commits
   - Idempotent

5. Registration rejected by reviewer
   - Recipient: applicant
   - Sent after decision transaction commits
   - Idempotent

6. Leave request created
   - Recipient: linked active employee + active ADMIN + active MANAGER

7. Leave approved
   - Recipient: linked active employee user

8. Leave rejected
   - Recipient: linked active employee user

9. Leave cancelled
   - Recipient: linked active employee user

10. Monthly schedule approved
   - Recipient: only eligible employees represented by authoritative
     assignments in the approved schedule month
   - No broad all-user fallback

Important rules:

- Email delivery is gated by email-notification and SMTP configuration.
- Registration approval/rejection uses an idempotent EmailDeliveryReservation
  event key per request and decision.
- Leave reviewer delivery is individual per eligible reviewer; recipient
  addresses are not exposed to each other.
- Schedule approval has no broad fallback to all Users/Employees; an empty or
  unresolved assignment set fails closed.
- Legacy leave notification helpers/routes must not be treated as active
  without mounted-route and callsite proof.
- There is no active Attendance email behavior.
- OTP remains authentication-critical and separate from optional ordinary
  business-notification semantics.
- Business-notification delivery failure must not roll back registration,
  leave, or schedule database state.

No email addresses or SMTP credentials belong in this document.

## G06 / G07 OWNER-APPROVED NO-PHOTO SECURITY MODEL

OWNER DECISION SUPERSEDING THE EARLIER PHOTO REQUIREMENT:

Attendance and Patrol must NOT require or retain employee photos in the current
approved version. SMS must NOT implement its own Face Recognition for this
scope.

The approved security/evidence model is:

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
SCHEDULE / SHIFT / ROUTE AUTHORITY
+
SERVER TIME
+
ANTI-REPLAY / IDEMPOTENCY
+
RISK ENGINE
+
CONTROLLED OFFLINE FALLBACK

NO PHOTO STORAGE.
NO FACE TEMPLATE.
NO SMS FACE RECOGNITION.
NO CONTINUOUS GPS TRACKING.

The design goal is to keep Attendance/Patrol lightweight in storage and
bandwidth so the current hosting model can remain viable as long as practical.
This is a design goal, not a guarantee that an external free tier will remain
sufficient forever.

## PASSKEY ROLE — IMPORTANT

Passkey authenticates access to an account. Passkey is NOT the authoritative
Attendance/Patrol device identity.

Reason:

- One Android phone may legitimately contain passkeys for multiple accounts.
- Therefore possession of a valid passkey alone must not allow the same phone
  to act as the primary Attendance device for multiple employees.

Attendance/Patrol authority must additionally verify the active personal
device enrollment bound to the Employee.

Existing WebAuthn/passkey behavior must not be weakened.

## PERSONAL ATTENDANCE / PATROL DEVICE ENROLLMENT

Default Owner rule:

1 Employee = 1 ACTIVE primary Attendance/Patrol device at a time.

The server must maintain an explicit Employee-to-device enrollment rather than
trusting a browser fingerprint, User-Agent string, cookie, or arbitrary device
name.

Preferred web/PWA concept:

- Device/browser generates a cryptographic key pair.
- Private key remains local and should be non-exportable where the platform
  permits.
- Server stores the public credential and enrollment identity.
- Server challenge is signed by the enrolled device credential.
- Server verifies that the credential is ACTIVE and belongs to the Employee
  performing Attendance/Patrol.

A valid account/passkey on a device enrolled to another Employee is not enough
for normal Attendance/Patrol acceptance.

Example security outcome:

Account = Employee B
Active enrolled device = Employee A device
→ DEVICE_OWNER_MISMATCH
→ do not accept as a normal verified Attendance/Patrol event.

Do not use IMEI/browser fingerprinting as the core web device identity.

### DEVICE CHANGE — OWNER-APPROVED FLOW

The device replacement authority is ADMIN ONLY.
Manager approval is NOT sufficient.

Required flow:

New phone
→ Login
→ Request attendance device change
→ ADMIN approves
→ Old device REVOKED
→ New device ACTIVE

Requirements:

- Only one ACTIVE primary device after approval.
- Old credential is revoked atomically with activation of the new credential.
- Reason/request/actor/timestamps must be auditable.
- Employee must not be able to self-activate unlimited replacement devices.
- Manager must not approve the device replacement.
- ADMIN can approve according to existing Admin authority and audit rules.

If the old device is lost/unavailable, Admin-controlled replacement remains the
recovery path.

Shared-device mode is NOT the default approved model and must not be silently
introduced.

## STATIC SECURE PAPER QR MODEL

Operational constraint: Sites/Checkpoints may only have printed paper QR
codes. Dynamic display QR is not required.

Each Site/Checkpoint QR must contain an unguessable random token/reference, not
plain identifiers such as CP01 alone.

Recommended security properties:

- unique token per Site/Checkpoint
- random high-entropy value
- server stores a hash/derived verifier rather than relying on plaintext
  storage where practical
- token is mapped to authoritative Site/Checkpoint identity
- Admin can regenerate/revoke a compromised QR and print a replacement
- old revoked token must stop validating

A paper QR is NOT sufficient evidence by itself because it can be photographed
or copied.

The QR must therefore be validated together with:

- authenticated Employee/account
- active enrolled personal device credential
- GPS coordinates
- GPS accuracy
- expected Site/Checkpoint
- geofence radius
- server validation/time
- Schedule/Shift or Patrol Route authority

Scanning a copied QR away from the physical location should result in a
location mismatch/risk outcome rather than normal verified attendance.

The QR-scanning camera is used only to decode the QR. Camera frames/photos are
not stored as Attendance/Patrol evidence and must not be uploaded as employee
photos.

Gallery-based QR import should not be a normal employee scanning path.

## G06 ATTENDANCE APPROVED FLOW

Architecture:

ONLINE FIRST
→ CONTROLLED OFFLINE FALLBACK
→ AUTO SYNC
→ SERVER VALIDATION

Typical employee flow:

Open SMS
→ authenticate as required
→ Scan Attendance QR
→ obtain GPS
→ verify active enrolled personal device
→ validate authoritative Schedule / Shift / Expected Site
→ server decides CHECK-IN or CHECK-OUT from current Attendance state
→ return verified result or risk/review result

Employees do not manually select Expected Site, Shift, Duty, or Patrol Route.
Those come from authoritative Schedule/assignment.

No employee photo capture is required under the current policy.

### ONLINE

- Server receivedAt/server time is authoritative for receipt.
- Capture context includes stable captureId and device credential proof.
- Server validates idempotency, assignment, site, geofence, device, QR, and
  risk rules.

### CONTROLLED OFFLINE

Offline remains Owner-approved because field connectivity may be unreliable.

Capture locally with at least:

- stable captureId UUID
- deviceCapturedAt/capturedAt
- GPS latitude/longitude
- GPS accuracy and location capturedAt where available
- scanned static secure QR reference/token proof
- active enrolled device credential/signature proof appropriate to the design
- cached/signed expected Schedule/Site context where applicable

Display OFFLINE_PENDING / saved on device / waiting sync.
Never present offline pending as server-confirmed Attendance.

On reconnect:

AUTO SYNC
→ SERVER REVALIDATION

Server must revalidate:

- captureId/idempotency
- active/revoked device status
- Employee/device ownership
- Schedule/Shift
- expected Site and geofence
- QR validity/revocation
- GPS/accuracy
- capturedAt versus receivedAt
- timing and risk

Both capturedAt and receivedAt must be preserved. Sync time must not silently
replace the captured event time.

Owner defaults retained:

- Normal offline sync window: 24 hours
- Local unsynced hard retention: 7 days
- >24h unsynced/late arrival: overdue/review; do not silently discard
- unresolved offline/time/schedule/location conflicts block official month
  certification until resolved

The browser/PWA queue must use stable idempotency/capture IDs so retries do not
create duplicate Attendance records.

## ATTENDANCE BUSINESS RULES

- Schedule is expected; Attendance is actual.
- Site and Department are separate concepts.
- Expected Site is assigned by Admin through Schedule/assignment.
- Current configurable Shift examples:
  - DAY: 07:00–19:00
  - NIGHT: 19:00–07:00 next day
- DAY/NIGHT values must remain configurable, not hardcoded forever.
- No grace period; late begins immediately after expected start.
- Early checkout is EARLY_OUT immediately before expected end.
- Overtime is not part of the approved initial rule set.
- Wrong shift preserves the event/evidence and adds WRONG_SHIFT according to
  validation policy.
- A different valid site may preserve the event and add ASSIST_OTHER_SITE.
- Outside all sites must not become a normal verified event; preserve the
  attempt/evidence as appropriate and add OUTSIDE_ALL_SITES / LOCATION_RISK
  for review according to the validation engine.
- Missing checkout must not invent checkout time or worked hours.
- Manager and Admin may perform governed corrections under the approved
  correction model, but original evidence remains immutable and reason,
  actor, time, and Audit are required.
- Device replacement remains ADMIN-only even though operational Attendance
  corrections may permit Manager/Admin according to correction policy.

## G07 PATROL / CHECKPOINT APPROVED DIRECTION

PS and PN are Patrol Routes, not shift names.
Attendance is independent from Patrol execution.

Patrol uses the same personal-device and no-photo security principles, plus
checkpoint/route validation.

Per checkpoint event:

Account / Employee
+
ACTIVE enrolled personal device
+
cryptographic device proof
+
GPS + accuracy
+
Static Secure Paper QR for that checkpoint
+
Server time / receivedAt
+
Route authority
+
sequence / movement plausibility where configured
+
risk engine

No continuous GPS tracking is required. Location is captured at relevant
checkpoint events.

A copied Checkpoint QR scanned away from the checkpoint must not be accepted as
a normal verified checkpoint because GPS/geofence validation is independent of
the QR token.

Movement plausibility should compare successive checkpoint observations, for
example impossible travel distance/time. It is a risk signal, not an automatic
accusation of misconduct.

Route order may be fixed or configurable by Patrol policy. Do not hardcode a
single sequence assumption until the operational route rules are formally
locked.

Controlled Offline behavior must preserve capturedAt, checkpoint identity,
GPS, device proof, and route context, then revalidate on sync.

## RISK / ANTI-ABUSE DIRECTION

Candidate risk/result vocabulary should include at least concepts such as:

- DEVICE_OWNER_MISMATCH
- NEW_DEVICE
- DEVICE_REVOKED
- OUTSIDE_GEOFENCE
- LOW_GPS_ACCURACY
- QR_LOCATION_MISMATCH
- WRONG_SHIFT
- WRONG_SITE
- ASSIST_OTHER_SITE
- REPEATED_SCAN
- REPLAY_ATTEMPT
- IMPOSSIBLE_MOVEMENT
- TIME_ABNORMAL
- OFFLINE_OVERDUE
- LOCATION_RISK

Do not assume one signal proves misconduct. Preserve enough audit evidence for
Supervisor/Admin review according to RBAC.

GPS spoofing/mock-location detection may be used as a risk signal where the
client platform safely exposes it, but do not claim web GPS anti-spoofing is
perfect.

## FUTURE ANDROID HARDENING — OPTIONAL, NOT A CURRENT BLOCKER

Most field guards are expected to use Android devices.

If Web/PWA device binding proves insufficient in real operation, a future
small Android app may harden device identity using platform capabilities such
as:

- Android Keystore
- non-exportable app/device keys where supported
- Play Integrity or equivalent app/device integrity signals
- GPS
- Static Secure Paper QR

This does NOT require moving the backend to a private server. A native Android
client may continue to use the existing backend hosting architecture.

Do not start a native app merely to satisfy G06/G07 unless a later Owner gate
authorizes it.

## NO-PHOTO DATA / STORAGE DECISION

For G06 Attendance and G07 Patrol under the current Owner decision:

- No employee check-in/check-out photo storage.
- No Patrol employee photo storage.
- No Face Recognition model/template.
- No image evidence retention requirement for Attendance/Patrol.
- No Attendance/Patrol photo binary in PostgreSQL/object storage.
- QR camera frames are not retained as evidence.
- GPS remains event-based, not continuous tracking.

This materially reduces object-storage, bandwidth, backup, and retention load.

Existing License document storage is a separate feature and is not removed by
this no-photo Attendance/Patrol decision.

## FUTURE PHOTO POLICY EXTENSION — OWNER-APPROVED DESIGN REQUIREMENT

The current policy is NO PHOTO, but the architecture must preserve a clean
future extension point so a later Owner policy can enable photo evidence
without rebuilding Attendance/Patrol core logic.

Do NOT create unused photo storage merely for this possibility now.
Instead, keep Attendance/Patrol event identity and validation independent from
optional evidence storage so a future additive design can support concepts
such as:

AttendanceEvent / PatrolEvent
→ optional Evidence relation
→ evidence type PHOTO when later authorized

A future photo-enabled release may add an additive evidence model with fields
such as event reference, evidence type, storage provider, object key/reference,
checksum, capturedAt, and retention policy.

Future policy may support, after a separate Owner gate:

- NO PHOTO
- PHOTO OPTIONAL
- PHOTO REQUIRED
- PHOTO REQUIRED only for selected Site/risk/policy cases

A future photo policy is a separate implementation/release/privacy/storage gate.
Do not silently enable photo capture, upload, retention, or face recognition.
Face Recognition remains prohibited unless separately and explicitly approved.

## DATA RETENTION ARCHITECTURE — OWNER APPROVED

SMS must use bounded rolling retention for high-volume raw operational data so
the database does not grow without limit.

Initial Owner-approved defaults:

1. SYSTEM OPERATIONAL / USAGE LOGS
   - Retention: 6 calendar months
   - Automatic hard delete after the retention cutoff

2. ATTENDANCE RAW EVENTS
   - Retention: 12 calendar months / 1 calendar year
   - Automatic hard delete after the retention cutoff

3. PATROL / CHECKPOINT RAW SCANS
   - Retention: 3 calendar months
   - Automatic hard delete after the retention cutoff

Retention is calculated by calendar month/year, not by approximating 6 months
as 180 days, 1 year as 365 days, or 3 months as 90 days.

Retention calendar/timezone authority:

Asia/Bangkok

For event data, retention age must be based on the authoritative effective
occurrence/capture date, not merely the later server sync-receipt date.
For controlled-offline records, a later receivedAt/syncReceivedAt must not
artificially extend raw retention when the validated event occurred earlier.

### RAW DATA VERSUS OFFICIAL RECORDS

The raw-data purge must NOT silently delete official governance records.

Attendance raw retention covers high-volume event/evidence/technical data such
as event GPS, accuracy, QR/device validation context, sync/technical metadata,
and raw risk details according to the final schema.

Attendance monthly certification / official summary records are NOT covered by
the 12-month raw-data purge unless a later Owner-approved policy explicitly
changes that rule.

Patrol raw retention covers per-checkpoint raw scan/location/device/validation
records according to the final schema.

Patrol official/monthly summary records are NOT covered by the 3-month raw-data
purge unless a later Owner-approved policy explicitly changes that rule.

### OPERATIONAL LOGS VERSUS SECURITY / GOVERNANCE AUDIT

Routine System Operational/Usage Logs may follow the 6-month retention policy.

Security/Governance Audit is a separate data class and must NOT be silently
included in the 6-month operational-log purge.
Examples include Admin device replacement approval, Attendance correction,
month unlock/certification action, QR regeneration/revocation, privileged
configuration changes, destructive data actions, and similar governance events.

Security/Governance Audit retention requires its own policy. Until explicitly
set, the raw operational-log cleanup must fail closed and exclude governance
audit records.

## ADMIN-CONFIGURABLE RETENTION POLICY — OWNER APPROVED

Retention durations must be data/configuration driven and manageable through
an ADMIN-only System Settings / Data Retention UI.

Do NOT hard-code the business retention durations so a future policy change
requires a source-code edit or redeployment.

Initial UI defaults:

- System Operational Logs: 6 months
- Attendance Raw Events: 12 months
- Patrol / Checkpoint Raw Scans: 3 months
- Automatic Daily Cleanup: enabled

Example future policy change:

Patrol / Checkpoint Raw Scans
3 months → 6 months

This must be possible from the application by an ADMIN without code change or
redeploy.

Every retention-policy change must be audited with at least policy identity,
previous value, new value, Admin actor, changedAt, and effective timing.

Manager is NOT authorized to change retention policy unless a later Owner rule
explicitly changes this authority.

### RETENTION CHANGE SAFETY

Increasing retention does NOT restore data that was already permanently purged
under the previous policy. The Admin UI must state this clearly.

Decreasing retention can make existing data immediately eligible for deletion.
Therefore the application must NOT hard-delete data inside the same Save
request.

For a retention decrease:

1. calculate and show an impact preview before confirmation
2. show the affected cutoff and estimated/actual eligible record count where
   technically practical
3. require explicit ADMIN confirmation
4. save the new policy
5. apply deletion through the controlled retention worker, not the UI request
6. use a safety delay before destructive effect; initial approved target is
   approximately 24 hours so an accidental policy reduction can be corrected
   before the purge runs

The implementation must prevent invalid or dangerous values such as zero,
negative, or unbounded arbitrary retention entries.

Initial UI safety bounds:

- System Operational Logs: 1–24 months
- Attendance Raw Events: 3–36 months
- Patrol / Checkpoint Raw Scans: 1–24 months

These bounds are owner-approved initial guardrails and may themselves be
changed only through a later controlled policy/design gate.

## AUTOMATIC RETENTION JOB — OWNER APPROVED

Retention cleanup must be automatic and server-authoritative. Admin should not
need to manually delete expired raw records day by day.

Preferred behavior:

Daily Retention Worker
→ read current retention configuration
→ calculate Asia/Bangkok calendar cutoffs
→ delete only eligible raw records
→ preserve excluded official records/governance audits
→ record a compact purge result

Do NOT create one audit row per deleted raw record merely to prove cleanup;
that would recreate unnecessary data growth.

A single compact retention-purge record per run should capture appropriate
summary information such as:

- runAt
- applied policy versions/values
- calculated cutoffs
- counts deleted per data class
- result/success/failure
- relevant error summary without sensitive payloads

Deletion should be batch-safe/idempotent/retry-safe and should avoid long
unbounded transactions. Exact batch sizing and scheduler implementation are
implementation details to be validated against the target runtime/database.

If a policy/data dependency is ambiguous, fail closed rather than deleting a
broader data class.

## CAPACITY / FREE-TIER OPERATING DIRECTION

The current NO-PHOTO + bounded-retention design is intentionally optimized to
reduce object storage, bandwidth, backup load, and long-term raw database
growth.

This can materially extend the practical life of the current small/free hosting
model, but no external provider free tier is guaranteed indefinitely.

After G06/G07 real usage begins, capacity decisions should be based on measured
usage rather than assumptions. Track at least database size/growth, request
volume, function/runtime use, bandwidth, and any applicable provider limits.

A future Admin capacity view may show current usage, growth trend, and estimated
remaining capacity. This is recommended future operational tooling, not a
reason to block current G06 architecture work.

## SELF-HOST FOUNDATION

The verified self-host foundation remains a valid future deployment option:

- Node.js 22 application runtime
- Docker runtime
- PostgreSQL 16 target
- reverse proxy and same-origin frontend/API delivery
- restricted trusted-proxy configuration
- private evidence-provider contract
- scheduler reference
- backup/restore model
- exact-SHA release model
- application rollback model

Disposable validation previously proved Docker build, non-root runtime,
PostgreSQL 16, health/ready, DB persistence, backup/restore, and release
rollback mechanics.

OWNER DECISION UPDATE:

Self-host migration is NOT required solely because Attendance/Patrol is being
built. The no-photo model substantially reduces the storage pressure that had
made early self-host migration more attractive.

Current hosting may continue while G06/G07 are developed and measured.
Self-host remains an option when scale, policy, integration, reliability,
cost, internal-network requirements, or Owner preference justify migration.

Do not perform a self-host Production cutover without a separate explicit
Owner gate.

## PHYSICAL INFRASTRUCTURE PLAN — FUTURE OPTION

Current Owner infrastructure plan remains available if/when self-host is
chosen:

### Dell R330 — Production/Main Candidate

Approximate known configuration:

- Xeon E3-12xx v5/v6 class
- 32–64 GB ECC class
- H330/H730/H730P class controller
- 2 × 1GbE
- former CCTV server

R330 disk/controller health must be verified before Production use.

### Dell R520 — Backup/Restore Candidate

Known:

- dual Xeon E5-2450 v2
- 16 cores / 32 threads total
- 128 GB ECC
- 8 × 2 TB SAS
- PERC H710 with battery
- iDRAC 7 Enterprise
- dual PSU

Preferred host OS if self-hosted:
Ubuntu Server 24.04 LTS bare metal.

Do not use Windows Server 2008 R2 as an internet-facing SMS Production host.

## PRODUCTION ORIGIN / DOMAIN DECISION

Current Production origin is:

https://sms-v3-staging-ten.vercel.app

A future Owner-controlled custom domain has been discussed but is not locked.
Previously discussed preference:

- secureops.in.th
- possible application origin: https://sms.secureops.in.th

This is NOT purchased/confirmed merely because it appears in this document.

Important updated rule:

Self-host itself is no longer a prerequisite for G06/G07.
However, before REAL employee controlled-offline/PWA rollout, the Owner must
lock the rollout origin strategy because IndexedDB, Service Worker, Cache
Storage, cookies, device-local keys, and WebAuthn/passkeys are origin-sensitive.

The rollout origin may be the current Vercel hostname if the Owner explicitly
accepts it for that rollout, or a future custom domain. Do not assume the
choice silently.

Do not roll out a critical offline queue on a temporary origin and then change
origin without a controlled migration/cutover plan.

## WEBAUTHN

Current Production passkeys are bound to the current Vercel RP/origin.

Moving to a different canonical domain requires controlled WebAuthn cutover.
Password/OTP fallback must remain available during transition.

Do not weaken WebAuthn to preserve old-origin passkeys.

## BACKUP DIRECTION IF SELF-HOSTED

Preferred future topology:

R330 Production
→ private LAN backup
→ R520 Backup/Restore

RAID is not backup. An additional offline/offsite copy remains recommended.
Exact backup retention/RPO/RTO require Owner lock before self-host Production.

## LOCAL FILESYSTEM BOUNDARY — PERMANENT OWNER RULE

This is a PERMANENT OWNER-AUTHORIZED project rule.

AUTHORITATIVE LOCAL WORKSPACE ROOT:

C:\Users\sermp\OneDrive - PTTPLC\04_SSO\ปี-2569\40.AI\ระบบ Security Management System V3

ALL SMS project-controlled local filesystem operations must remain inside this
root.

This includes, but is not limited to:

- repository clones
- Git worktrees
- isolated release clones
- source working copies
- documentation
- OWNER_PROJECT_HANDOFF.md local backup
- screenshots
- visual evidence
- test evidence
- generated reports
- release evidence
- patches
- exported files
- backup staging
- deployment notes
- temporary project files created by CODEX
- disposable project databases/files where filesystem paths are explicitly
  controlled
- scripts generated for project work

FORBIDDEN OWNER-MANAGED PROJECT LOCATIONS include:

- C:\Users\sermp\AppData\Local\Temp\...
- C:\Users\sermp\Documents\...
- Desktop
- Downloads
- another OneDrive directory
- another repository clone outside the authorized root
- arbitrary C:\Temp or similar project workspaces

Do NOT create new SMS isolated clones/worktrees in Windows Temp.
When isolation is required, create the isolated workspace UNDER the authorized
root.

Before every major local CODEX task, verify:

AUTHORIZED_WORKSPACE_ROOT =
C:\Users\sermp\OneDrive - PTTPLC\04_SSO\ปี-2569\40.AI\ระบบ Security Management System V3

ACTIVE_WORKING_DIRECTORY = <actual path>

WORKSPACE_BOUNDARY_CHECK = PASS / FAIL

PASS is allowed only when the active SMS project working directory is a
descendant of the authorized root.

If not:

SMS_LOCAL_WORKSPACE_BOUNDARY_VIOLATION

STOP before project-controlled file creation, commit, push, deployment, or
evidence generation from that unauthorized workspace.

Operating system/Git/Node/browser/Docker/antivirus/OneDrive internals may use
system-managed cache/temp areas that are not under project control. CODEX must
not intentionally choose those locations for SMS project artifacts.

## CANONICAL HANDOFF LOCAL BACKUP — PERMANENT OWNER RULE

Canonical repository handoff:

docs/OWNER_PROJECT_HANDOFF.md

Required Owner local/OneDrive copy:

C:\Users\sermp\OneDrive - PTTPLC\04_SSO\ปี-2569\40.AI\ระบบ Security Management System V3\OWNER_PROJECT_HANDOFF.md

After CODEX updates this handoff and the final branch is successfully pushed
and remote HEAD is verified, CODEX must:

1. Copy the final repository handoff to the path above.
2. OVERWRITE the same OWNER_PROJECT_HANDOFF.md.
3. Do not create V2/V3/FINAL/date-stamped duplicates.
4. Compute SHA256 of repository source and local destination.
5. Require matching hashes.

Expected success report:

LOCAL_HANDOFF_BACKUP = VERIFIED

If GitHub push succeeds but local backup fails, do not rewrite or undo pushed
Git history. Report the safe error and do not claim local handoff closeout is
complete.

## NEXT WORK PLAN

Immediate development/release priorities:

1. Complete the Owner-authorized EMAIL-01P Production release using only the
   isolated exact-SHA backport and close the release only after canonical,
   health/ready, runtime, and rollback verification.
2. Update G06 implementation/design from the superseded mandatory-photo model
   to the approved NO-PHOTO + PERSONAL DEVICE + STATIC SECURE QR model before
   continuing employee Attendance implementation.
3. Design/implement personal device enrollment and ADMIN-only device
   replacement authority.
4. Design/implement static secure Site QR and Checkpoint QR lifecycle,
   including regenerate/revoke and location binding.
5. Add the configurable retention architecture to G06/G07 design so raw data
   classes are explicitly identified before the retention worker can delete
   anything.
6. Implement ADMIN-only Data Retention settings, policy audit, impact preview,
   and safe delayed application for retention reductions.
7. Design the automatic daily retention worker with fail-closed data-class
   boundaries and compact purge summaries.
8. Preserve an optional future photo-evidence extension point without creating
   or retaining employee photo data now.
9. Continue Attendance/Patrol server validation and mobile UX without
   introducing image evidence storage.
10. Before real controlled-offline employee rollout, obtain explicit Owner
    decision on rollout origin strategy.
11. After real G06/G07 usage begins, measure capacity/growth before deciding on
    paid hosting or self-host migration.

Do not start G07 Production rollout before G06 foundations required by the
shared device/location/QR security model are stable.

## OWNER INPUT / FUTURE GATES

Still requiring explicit Owner decisions when relevant:

- final verification result of the Owner-authorized EMAIL-01P Production
  release
- actual rollout origin for employee PWA/offline
- whether/when to purchase an Owner-controlled custom domain
- whether/when to self-host
- R330 exact disk/controller health before any self-host Production use
- exact Patrol route sequencing/policy where not yet defined
- any future native Android hardening gate
- any future change from NO PHOTO to optional/required photo evidence
- Security/Governance Audit retention duration

Do not request or record passwords, tokens, cookies, private keys, SMTP
credentials, or similar secrets in this file.

## SAFETY / RELEASE RULES

- GitHub is the remote source of truth.
- Exact SHA and tree identity are required.
- Exact-head Remote CI is required.
- No Production deployment without explicit Owner authorization.
- No Production migration without explicit Owner authorization.
- No Production environment or data mutation without explicit Owner
  authorization.
- Never deploy from a dirty or wrong worktree.
- Use isolated clones/worktrees under the authorized Owner workspace root.
- Never put passwords, tokens, cookies, or private keys in this handoff.
- No destructive Production UAT.
- Never edit live source directly on a Production server.
- Preserve the rollback checkpoint.
- Do not promote an arbitrary old Preview deployment.
- Schema migration creation and Production migration execution are separate
  gates.
- Inactive employees are historical records, not current operational workload.
- Operational eligibility remains isActive === true && deletedAt === null
  unless a later Owner-approved domain rule explicitly supersedes it.
- Risk flags are evidence for validation/review, not automatic accusations.
- Retention deletion must be data-class scoped, policy driven, audited in
  compact form, and fail closed on ambiguity.
- Increasing retention cannot restore already-purged data.
- Retention decreases require impact preview and explicit ADMIN confirmation.

## CURRENT GATE

EMAIL-01 development candidate:
SMS_EMAIL_01_CANDIDATE_READY

EMAIL-01P isolated Production backport:
OWNER AUTHORIZED FOR PRODUCTION DEPLOYMENT
RELEASE VERIFICATION PENDING

Current Production remains G05 until the exact Production release is verified.

G06/G07 architecture is now Owner-locked to:

NO PHOTO
+
PERSONAL DEVICE ENROLLMENT
+
ADMIN-ONLY DEVICE REPLACEMENT APPROVAL
+
GPS/GEOFENCE
+
STATIC SECURE PAPER QR
+
SERVER VALIDATION / RISK ENGINE
+
CONTROLLED OFFLINE FALLBACK
+
CONFIGURABLE BOUNDED DATA RETENTION

Initial rolling raw-data retention defaults:

- System Operational Logs: 6 calendar months
- Attendance Raw Events: 12 calendar months
- Patrol / Checkpoint Raw Scans: 3 calendar months

ADMIN may change these within approved safety bounds through the application
without code change/redeploy. Policy changes are audited. Retention decreases
require impact preview + explicit ADMIN confirmation + controlled delayed
purge. Increasing retention never restores already-purged data.

Official Attendance/Patrol summary/certification records are outside these raw
purges. Security/Governance Audit is also outside the 6-month operational-log
purge until its separate retention policy is explicitly approved.

The current NO-PHOTO decision supersedes the earlier mandatory fresh-photo
Attendance requirement in prior handoff text or earlier chat context, while
the architecture must preserve a future additive photo-evidence extension
point for a separately authorized policy change.

## New Chat / New CODEX Session

Before doing any work:

1. Read this entire file.
2. Verify CURRENT PRODUCTION separately from CURRENT DEVELOPMENT.
3. Verify Git SHA/tree before modifying source.
4. Verify the local workspace is inside the permanent authorized root.
5. Treat Owner-approved rules in this document as authoritative unless the
   Owner explicitly supersedes them.
6. Update/overwrite THIS SAME FILE after each major approved gate.
7. After successful CODEX push, overwrite the required local OneDrive handoff
   copy and verify SHA256 equality.
