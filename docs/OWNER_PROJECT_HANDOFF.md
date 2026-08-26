# SMS — OWNER PROJECT HANDOFF

> START HERE FOR A NEW CHAT / CODEX SESSION.
> Read this complete file before proposing or modifying the SMS project.

Last Updated:
2026-08-25

Repository:
godzillazzz/SMS-v3

This is the single canonical project-continuity document. Future approved
updates must update/overwrite this same file rather than creating versioned
handoff copies.

## CURRENT PRODUCTION

Production is separate from the current development/self-host candidate.
G06 is not Production.

- Production application SHA: 6b899c0c613ded6dcb28744448c5f5562c6ae8cc
- Production tree: d6c6e79a2b39256906e76863befde7b04e881cab
- Production release: MOBILE RESPONSIVE V1 + inherited G05 / EMAIL-01P behavior
- Production deployment: dpl_8V5bWpjYpfGEG1nPsjyAEvxKtS8P
- Production immutable URL: https://sms-v3-staging-qrshx2imp-godzillazz.vercel.app
- Canonical current Vercel hostname: sms-v3-staging-ten.vercel.app
- Immediate rollback deployment: dpl_6vYMt8yYtpkCmYvfo1RHuavZoZpX
- Immediate rollback SHA: 39f28d5d0c0216672f28567b315501e7b7b64990

Mobile Responsive V1 is Owner-approved on real iPhone Safari and verified in
Production from the exact authorized GitHub SHA. The release preserves the
existing G05 / EMAIL-01P Production behavior. EMAIL-01P remains verified and
is inherited by this release. G06/self-host development remains outside
Production.

Do not deploy the complete current development lineage directly to Production.
It contains future G06/G07/self-host work that is not Production-authorized.
## EMAIL-01P PRODUCTION BACKPORT — VERIFIED IN PRODUCTION

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
- Automatic Preview reference only: dpl_DMVPsbVrr5UTBCCSjCE5wizQbRTz — never promoted
- Preview URL: https://sms-v3-staging-3l2qzpqzs-godzillazz.vercel.app
- Production deployment: dpl_6vYMt8yYtpkCmYvfo1RHuavZoZpX
- Production immutable URL: https://sms-v3-staging-7i3butp28-godzillazz.vercel.app
- GitSource: GitHub repo 1305361853, branch fix/email-01-production-backport-v1,
  SHA 39f28d5d0c0216672f28567b315501e7b7b64990
- Deployment target/state: production / READY
- Canonical cutover: verified on sms-v3-staging-ten.vercel.app
- Health: 3/3 PASS
- Ready/database: 3/3 PASS, database=ok
- Root/login: 200 / 200
- Unauthenticated auth/me: 401
- Runtime fatal/unexpected 5xx/database/config errors: 0
- Production migrations/env/DB-data/DNS/storage mutations: 0
- Real-user email smoke: 0

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
- The prior G05 deployment remains the immediate rollback authority.

Verified release status:

SMS_EMAIL_01P_PRODUCTION_RELEASE_VERIFIED

CURRENT PRODUCTION above is now the EMAIL-01P verified state.

## MOBILE RESPONSIVE V1 — OWNER APPROVED / VERIFIED IN PRODUCTION

Owner real-device result:

- REAL_IOS_SAFARI_OWNER_REVIEW=PASS
- OWNER_REVIEW_STATUS=APPROVED
- Final status: SMS_MOBILE_RESPONSIVE_V1_PRODUCTION_RELEASE_VERIFIED
- Inherited EMAIL-01P verified status: SMS_EMAIL_01P_PRODUCTION_RELEASE_VERIFIED

Release lineage:

- Base Production SHA: 39f28d5d0c0216672f28567b315501e7b7b64990
- Responsive Product SHA: e7e693946a031bb8da9d5cb7c0550762456b3b25
- CI topology SHA: 8bc0631b341262a9c5710808fb2789d9aba5b88e
- Owner Review Fix V1: a31b0203034d29fd80aa219a4c584dfb120dfd2b
- Owner Review Fix V2: fa32d46948514f3578574adb7b04d27e0cbebeb0
- Owner Review Fix V3 / released SHA: 6b899c0c613ded6dcb28744448c5f5562c6ae8cc
- Released tree: d6c6e79a2b39256906e76863befde7b04e881cab
- Release branch: fix/production-mobile-responsive-v1

Exact-head CI:

- Remote CI run: 32480708606
- Remote CI job: 96766246161
- Remote CI result: SUCCESS
- Head SHA: 6b899c0c613ded6dcb28744448c5f5562c6ae8cc
- Checkout SHA: 6b899c0c613ded6dcb28744448c5f5562c6ae8cc

Owner-approved Preview:

- Deployment: dpl_DifsRJJNtGBCFHCHP56fg8ePP9Hu
- URL: https://sms-v3-staging-9a77opri2-godzillazz.vercel.app
- GitHub repo ID: 1305361853
- Ref: fix/production-mobile-responsive-v1
- SHA: 6b899c0c613ded6dcb28744448c5f5562c6ae8cc
- Owner real iPhone Safari review: PASS

Verified Production release:

- Production deployment: dpl_8V5bWpjYpfGEG1nPsjyAEvxKtS8P
- Production immutable URL: https://sms-v3-staging-qrshx2imp-godzillazz.vercel.app
- Canonical: https://sms-v3-staging-ten.vercel.app
- Target/state: production / READY
- GitSource repo ID: 1305361853
- GitSource ref: fix/production-mobile-responsive-v1
- GitSource SHA: 6b899c0c613ded6dcb28744448c5f5562c6ae8cc
- Deployment creation: Vercel Deployments API via authenticated CLI wrapper;
  source metadata reports cli, while gitSource/meta repo/ref/SHA are exact and
  no local-source upload or Preview promotion was used.
- Canonical cutover: VERIFIED
- Post-release health: 3/3 PASS
- Post-release ready/database: 3/3 PASS, database=ok
- Root/login: 200 / 200
- Unauthenticated auth/me: 401
- Runtime environment-validation/startup/database/fatal/unexpected 5xx errors: 0
- Production schema/migrations/DB-data/env/DNS/storage mutations: 0
- Immediate rollback deployment: dpl_6vYMt8yYtpkCmYvfo1RHuavZoZpX
- Immediate rollback SHA: 39f28d5d0c0216672f28567b315501e7b7b64990

Mobile Responsive V1 defects closed:

- shared body-level reference-counted document scroll lock
- mobile utility menu body portal
- Leave Request mobile width/scroll repair
- Leave History mobile cards
- License search mobile height repair
- OperationalRecordDrawer body portal
- License / Leave Quota iOS drawer repair with VisualViewport-safe geometry
- deliberate mobile Schedule horizontal interaction
- Schedule delete visible control = 30x30
- Schedule effective touch target = 44x44
- header / safe-area responsive correction

G06/G07, Employee Master approval workflow, Reference Photo, Face Verification,
Liveness and other future Owner-approved architecture remain future work and
were not implemented by this Production responsive release.
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
- Status: SMS_EMAIL_01_CANDIDATE_READY (development lineage; not Production)

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

## COMMON APPROVAL WORKFLOW STANDARD — OWNER APPROVED

Owner decision: workflows that send a request to ADMIN/MANAGER for review must
not be designed as only a binary APPROVE / REJECT choice when correction and
withdrawal are legitimate operational outcomes.

Default review-state vocabulary for applicable approval loops:

DRAFT
→ PENDING_APPROVAL
→ APPROVED / RETURNED_FOR_CORRECTION / REJECTED / CANCELLED

Required semantic distinction:

- APPROVED: terminal reviewer approval; the authorized business effect may be
  applied according to that module's transaction rules.
- RETURNED_FOR_CORRECTION: non-terminal. The reviewer is not rejecting the
  request. The request owner may correct the identified fields and resubmit the
  same governed request/revision.
- REJECTED: terminal reviewer decision for that request/revision; a reason is
  required where the workflow supports rejection.
- CANCELLED: withdrawal by the request owner or another explicitly authorized
  role while cancellation remains legally/operationally valid. Cancellation
  is not the same as reviewer rejection.

Where applicable, the review UI must expose actions equivalent to:

- อนุมัติ / Approve
- ส่งกลับไปแก้ไข / Return for Correction
- ไม่อนุมัติ / Reject
- ยกเลิกคำขอ / Cancel Request

The exact action set may vary where a domain rule makes one action impossible,
but any omission must be intentional and documented rather than a generic
binary-approval shortcut.

Workflow requirements:

- Every transition must preserve immutable audit history: request/revision,
  previous state, next state, actor, timestamp, and reason/comment where
  applicable.
- RETURNED_FOR_CORRECTION must not overwrite the prior reviewer decision or
  prior submitted values. Resubmission must remain traceable.
- APPROVED business effects must occur only after the authorized approval
  transition succeeds.
- A pending or returned request must not silently mutate authoritative master
  data unless that module explicitly uses a different Owner-approved model.
- Reviewer notifications and queue visibility should follow the actionable
  state, not create duplicate queue items for each resubmission.
- Existing module-specific authority remains authoritative. This common model
  does not grant MANAGER authority where a feature is ADMIN-only, such as
  Attendance/Patrol primary-device replacement.

This standard must be reviewed for every existing/new module that has an
approval loop, including Employee Master changes, registration, leave,
license/document review, Attendance corrections/exceptions, and other governed
requests. Existing business rules are not silently changed merely by this
standard; each module must be mapped explicitly before implementation.

## EMPLOYEE MASTER EDIT + STATUS GOVERNANCE — OWNER APPROVED

Employee Master should present one coherent Edit Employee experience rather
than forcing ordinary employee-data editing and employment-status management
into unrelated controls.

The Edit Employee surface should be able to contain, as applicable:

- employee/general information
- organization/department/position information
- employment status and effective date/reason
- employee reference face photo used for Attendance identity verification
- current/pending change state
- relevant status/change history

Authority model:

ADMIN edit
→ may apply the authorized change directly
→ audit required

MANAGER edit
→ create governed Employee Master change request
→ PENDING_ADMIN_APPROVAL
→ authoritative Employee Master remains unchanged until ADMIN approval

ADMIN review of a Manager-originated Employee Master change must support:

- APPROVE
- RETURN_FOR_CORRECTION
- REJECT

The Manager/request owner must be able to CANCEL a still-pending or returned
request where no terminal decision/business effect has occurred.

Admin review should show a clear before/after diff for the proposed changes,
including employment-status transitions and effective-date/reason where
applicable.

Employment status is not a cosmetic field. A change such as ACTIVE → INACTIVE
or RESIGNED may affect operational eligibility, Schedule, Attendance, Patrol,
and other current-work views. Historical records must not be deleted merely
because status changes.

Manager-proposed employment-status changes must not become effective before
ADMIN approval.

Employee reference face-photo replacement is security-sensitive and follows
the same authority principle:

- ADMIN may replace the active reference photo directly with audit.
- MANAGER may propose a replacement, but the new reference photo must not
  become authoritative until ADMIN approval.

This prevents a lower-authority reference-photo change from bypassing the
Attendance identity-control layer.

## G06 / G07 OWNER-APPROVED ATTENDANCE/PATROL IDENTITY SECURITY MODEL

OWNER DECISION SUPERSEDING THE EARLIER ABSOLUTE NO-PHOTO / NO-FACE LANGUAGE:

Attendance and Patrol must continue to avoid storing employee photos for each
check-in/check-out/patrol event. However, SMS may retain one authoritative
Employee Reference Photo in Employee Master for 1:1 identity verification at
Attendance check-in/check-out.

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

Important identity/photo rules:

- Employee Reference Photo: retained as an authoritative Employee Master
  security reference.
- Attendance check-in photo: NOT retained as event evidence.
- Attendance check-out photo: NOT retained as event evidence.
- Patrol event employee photo: NOT retained as event evidence under the current
  approved scope.
- Live camera frames used for face/liveness verification are temporary
  processing data and must be discarded after verification; they must not be
  silently written to Attendance/Patrol evidence storage.
- Face verification is 1:1 only: the authenticated/assigned Employee is already
  known and the live face is compared only with that Employee's authoritative
  reference.
- 1:N face identification/search across the employee roster is NOT required and
  is not approved by this decision.
- Liveness/anti-spoof is required together with face matching; a plain still
  photo-to-live-frame similarity check alone is not sufficient.
- Do not classify a face-verification failure as misconduct automatically.
  Preserve it as a verification/risk outcome for retry/review according to
  policy.
- NO CONTINUOUS GPS TRACKING.

The purpose of the face layer is anti-buddy-punching: Device + GPS + QR can
show that the assigned device is at the expected location, while 1:1 face
verification adds evidence that the person presenting the device matches the
Employee reference identity.

The other approved security layers remain mandatory; face verification does
not replace Device Enrollment, Device Credential, GPS/Geofence, Static Secure
QR, Schedule/Shift authority, Server Time, Anti-Replay, Risk Engine, or
Controlled Offline safeguards.

Current operating scale is approximately 65 employees. This makes reference
photo storage small, but implementation choices must still be driven by
security, privacy, liveness quality, offline behavior, device compatibility,
and cost rather than by storage size alone.

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
- The common approval-workflow standard may add Return for Correction / Cancel
  semantics to the request lifecycle where technically appropriate, but the
  actual approval authority remains ADMIN ONLY.

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
- face/liveness verification where Attendance policy requires it

Scanning a copied QR away from the physical location should result in a
location mismatch/risk outcome rather than normal verified attendance.

The QR-scanning camera is used only to decode the QR. QR camera frames/photos
are not stored as Attendance/Patrol evidence.

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
→ capture temporary live front-camera frames
→ perform liveness / anti-spoof
→ perform 1:1 face verification against that Employee's reference photo
→ discard live frames after verification
→ server decides CHECK-IN or CHECK-OUT from current Attendance state
→ return verified result or risk/review result

Employees do not manually select Expected Site, Shift, Duty, or Patrol Route.
Those come from authoritative Schedule/assignment.

No check-in/check-out employee photo is retained under the current policy.

### ONLINE

- Server receivedAt/server time is authoritative for receipt.
- Capture context includes stable captureId and device credential proof.
- Server validates idempotency, assignment, site, geofence, device, QR, face
  verification result/proof appropriate to the final design, and risk rules.
- Live face frames must be discarded after verification and must not be retained
  merely for routine Attendance evidence.
- A bounded retry policy may be used for ordinary face/liveness failure caused
  by lighting, pose, camera quality, or similar conditions; repeated failure
  becomes a governed risk/exception outcome rather than an automatic accusation.

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
- face/liveness verification result/proof appropriate to the final approved
  offline design

Display OFFLINE_PENDING / saved on device / waiting sync.
Never present offline pending as server-confirmed Attendance.

The combination of FACE REQUIRED + NO EVENT PHOTO RETENTION + OFFLINE means the
system must not solve offline verification by silently storing raw live-face
images for later server comparison. The preferred architecture direction is
on-device/local verification with a signed/tamper-resistant result/proof where
technically supportable.

If secure on-device liveness/1:1 verification cannot be achieved reliably in
the selected Web/PWA stack, that limitation must be surfaced at a separate
architecture gate. A small native Android hardening path may then be considered;
it is not automatically authorized merely by this document.

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
- face/liveness result/proof according to the approved offline design
- timing and risk

Both capturedAt and receivedAt must be preserved. Sync time must not silently
replace the captured event time.

Owner defaults retained:

- Normal offline sync window: 24 hours
- Local unsynced hard retention: 7 days
- >24h unsynced/late arrival: overdue/review; do not silently discard
- unresolved offline/time/schedule/location/identity conflicts block official
  month certification until resolved

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
- Face/liveness failure is a verification/risk outcome, not proof of deliberate
  buddy punching or misconduct by itself.

## G07 PATROL / CHECKPOINT APPROVED DIRECTION

PS and PN are Patrol Routes, not shift names.
Attendance is independent from Patrol execution.

Patrol uses the same personal-device security principles, plus
checkpoint/route validation. Current Owner approval adds reference-face 1:1
verification specifically to Attendance check-in/check-out anti-buddy-punching;
it does not automatically require a live face step at every Patrol checkpoint.

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
- FACE_VERIFICATION_FAILED
- LIVENESS_FAILED

Do not assume one signal proves misconduct. Preserve enough audit evidence for
Supervisor/Admin review according to RBAC.

GPS spoofing/mock-location detection may be used as a risk signal where the
client platform safely exposes it, but do not claim web GPS anti-spoofing is
perfect.

## FUTURE ANDROID HARDENING — OPTIONAL, NOT A CURRENT BLOCKER

Most field guards are expected to use Android devices.

If Web/PWA device binding or secure offline face/liveness verification proves
insufficient in real operation, a future small Android app may harden device
identity/verification using platform capabilities such as:

- Android Keystore
- non-exportable app/device keys where supported
- Play Integrity or equivalent app/device integrity signals
- on-device 1:1 face/liveness capability where separately selected and tested
- GPS
- Static Secure Paper QR

This does NOT require moving the backend to a private server. A native Android
client may continue to use the existing backend hosting architecture.

Do not start a native app merely to satisfy G06/G07 unless a later Owner gate
authorizes it.

## EVENT-PHOTO / FACE DATA STORAGE DECISION

For G06 Attendance and G07 Patrol under the current Owner decision:

- One authoritative Employee Reference Photo may be retained per Employee for
  1:1 Attendance identity verification.
- No employee check-in/check-out photo is retained as Attendance event evidence.
- No Patrol employee event photo is retained under the current approved scope.
- Live face/liveness camera frames are temporary processing data and must be
  discarded after verification.
- No Attendance/Patrol routine event-photo binary is stored in PostgreSQL/object
  storage.
- QR camera frames are not retained as evidence.
- GPS remains event-based, not continuous tracking.
- Broad 1:N employee face identification is not required/approved.
- Persisting a reusable biometric template/embedding is NOT automatically
  authorized by the reference-photo decision. If the selected implementation
  requires persistent templates/embeddings, that requires an explicit
  architecture/security/privacy decision before implementation.

Reference-photo governance:

- The active reference photo is security-sensitive Employee Master data.
- ADMIN replacement is direct + audited.
- MANAGER replacement is pending until ADMIN approval.
- Change history/audit metadata must remain traceable.
- Old reference-photo binary retention/deletion safety window must be defined
  before implementation; do not retain superseded biometric/reference images
  indefinitely without an approved purpose.

This remains materially lighter than storing a fresh photo for every
check-in/check-out event.

Existing License document storage is a separate feature and is not removed by
this Attendance/Patrol event-photo decision.

## FUTURE EVENT-PHOTO POLICY EXTENSION — OWNER-APPROVED DESIGN REQUIREMENT

Current policy permits an Employee Reference Photo for 1:1 Attendance face
verification, but routine Attendance/Patrol event photos are NOT retained.

The architecture must preserve a clean future extension point so a later Owner
policy can enable event-photo evidence without rebuilding Attendance/Patrol
core logic.

Do NOT create unused event-photo storage merely for this possibility now.
Instead, keep Attendance/Patrol event identity and validation independent from
optional evidence storage so a future additive design can support concepts
such as:

AttendanceEvent / PatrolEvent
→ optional Evidence relation
→ evidence type PHOTO when later authorized

A future event-photo-enabled release may add an additive evidence model with
fields such as event reference, evidence type, storage provider, object
key/reference, checksum, capturedAt, and retention policy.

Future policy may support, after a separate Owner gate:

- NO EVENT PHOTO
- EVENT PHOTO OPTIONAL
- EVENT PHOTO REQUIRED
- EVENT PHOTO REQUIRED only for selected Site/risk/policy cases

A future event-photo policy is a separate implementation/release/privacy/storage
gate. Do not silently enable routine event-photo capture, upload, or retention.

The currently approved face capability is limited to 1:1 verification against
the known Employee reference with liveness/anti-spoof. Broad 1:N face
identification across the employee roster remains outside the approved scope.

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
as event GPS, accuracy, QR/device/identity validation context,
sync/technical metadata, and raw risk details according to the final schema.

Attendance monthly certification / official summary records are NOT covered by
the 12-month raw-data purge unless a later Owner-approved policy explicitly
changes that rule.

Patrol raw retention covers per-checkpoint raw scan/location/device/validation
records according to the final schema.

Patrol official/monthly summary records are NOT covered by the 3-month raw-data
purge unless a later Owner-approved policy explicitly changes that rule.

Employee Reference Photo is Employee Master security/reference data, not an
Attendance raw event, and therefore is NOT governed by the 12-month raw-event
purge. Its replacement/deletion policy is a separate reference-photo rule.

### OPERATIONAL LOGS VERSUS SECURITY / GOVERNANCE AUDIT

Routine System Operational/Usage Logs may follow the 6-month retention policy.

Security/Governance Audit is a separate data class and must NOT be silently
included in the 6-month operational-log purge.
Examples include Admin device replacement approval, Attendance correction,
month unlock/certification action, QR regeneration/revocation, Employee Master
change approval, reference-photo replacement approval, privileged
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

The current no-Attendance-event-photo + bounded-retention design is
intentionally optimized to reduce object storage, bandwidth, backup load, and
long-term raw database growth. The addition of one Employee Reference Photo
per Employee remains small at the current workforce scale compared with
retaining photos for every Attendance event.

This can materially extend the practical life of the current small/free hosting
model, but no external provider free tier is guaranteed indefinitely.

After G06/G07 real usage begins, capacity decisions should be based on measured
usage rather than assumptions. Track at least database size/growth, request
volume, function/runtime use, bandwidth, face/liveness verification cost where
applicable, and any applicable provider limits.

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
built. The no-event-photo model substantially reduces the storage pressure
that had made early self-host migration more attractive. One reference photo
per Employee does not by itself change that conclusion.

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

1. Preserve the verified Mobile Responsive V1 Production release and immediate rollback
   checkpoint; do not deploy the broader development lineage.
2. Design/implement the common approval-workflow standard and integrate
   Employee Master status/general edit into one governed Edit Employee flow.
3. Ensure Manager-originated Employee Master changes use
   PENDING_ADMIN_APPROVAL with Approve / Return for Correction / Reject and
   request-owner Cancel semantics, with immutable before/after audit.
4. Perform a dedicated architecture/security/privacy/cost/device audit for
   Employee Reference Photo + 1:1 Face Verification + Liveness before choosing
   the implementation/vendor/library. Do not implement broad 1:N identification.
5. Design the offline face/liveness approach so NO event-photo retention is
   preserved. If secure Web/PWA on-device verification is insufficient, surface
   that as a later Android hardening decision rather than storing raw offline
   face images silently.
6. Design/implement personal device enrollment and ADMIN-only device
   replacement authority.
7. Design/implement static secure Site QR and Checkpoint QR lifecycle,
   including regenerate/revoke and location binding.
8. Add the configurable retention architecture to G06/G07 design so raw data
   classes are explicitly identified before the retention worker can delete
   anything.
9. Implement ADMIN-only Data Retention settings, policy audit, impact preview,
   and safe delayed application for retention reductions.
10. Design the automatic daily retention worker with fail-closed data-class
    boundaries and compact purge summaries.
11. Preserve the optional future event-photo-evidence extension point without
    enabling routine Attendance/Patrol event-photo storage.
12. Continue Attendance/Patrol server validation and mobile UX with the approved
    identity stack; face verification augments rather than replaces Device,
    GPS, QR, Schedule, Server Time, Anti-Replay, Risk, and Offline controls.
13. Before real controlled-offline employee rollout, obtain explicit Owner
    decision on rollout origin strategy.
14. After real G06/G07 usage begins, measure capacity/growth and face/liveness
    verification cost before deciding on paid hosting or self-host migration.

Do not start G07 Production rollout before G06 foundations required by the
shared device/location/QR/identity security model are stable.

## OWNER INPUT / FUTURE GATES

Still requiring explicit Owner decisions when relevant:

- any future EMAIL-01P rollback or follow-up release decision
- actual rollout origin for employee PWA/offline
- whether/when to purchase an Owner-controlled custom domain
- whether/when to self-host
- R330 exact disk/controller health before any self-host Production use
- exact Patrol route sequencing/policy where not yet defined
- implementation/provider/library choice for 1:1 face verification and
  liveness/anti-spoof
- secure offline face/liveness design and whether a native Android hardening
  gate is required
- reference-photo capture quality rules, replacement safety window, and
  superseded-binary deletion policy
- whether persistent biometric templates/embeddings are ever required; current
  approval does not automatically authorize them
- any future change from NO EVENT PHOTO to optional/required event-photo
  evidence
- Security/Governance Audit retention duration

Do not request or record passwords, tokens, cookies, private keys, SMTP
credentials, biometric templates, or similar secrets/sensitive artifacts in
this file.

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
- Never put passwords, tokens, cookies, private keys, or biometric artifacts in
  this handoff.
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
- Approval-loop transitions must preserve immutable audit and distinguish
  Returned for Correction, Rejected, and Cancelled outcomes.
- Manager-originated Employee Master changes must not mutate authoritative
  master data before ADMIN approval.
- Reference-photo changes are security-sensitive and must follow the approved
  authority/audit model.
- Routine Attendance/Patrol event-photo retention remains prohibited under the
  current policy; live verification frames are ephemeral.
- Retention deletion must be data-class scoped, policy driven, audited in
  compact form, and fail closed on ambiguity.
- Increasing retention cannot restore already-purged data.
- Retention decreases require impact preview and explicit ADMIN confirmation.

## CURRENT GATE

EMAIL-01 development candidate:
SMS_EMAIL_01_CANDIDATE_READY

EMAIL-01P isolated Production backport:
SMS_EMAIL_01P_PRODUCTION_RELEASE_VERIFIED

Mobile Responsive V1 Production release:
SMS_MOBILE_RESPONSIVE_V1_PRODUCTION_RELEASE_VERIFIED

Current Production is the exact Mobile Responsive V1 release recorded above,
with inherited G05 / EMAIL-01P behavior. G06 and self-host remain outside
Production.

G06/G07 architecture is now Owner-locked to:

COMMON APPROVAL WORKFLOW STANDARD
+
EMPLOYEE MASTER UNIFIED EDIT / STATUS GOVERNANCE
+
MANAGER CHANGES → ADMIN APPROVAL
+
APPROVE / RETURN FOR CORRECTION / REJECT / CANCEL
+
NO ATTENDANCE/PATROL EVENT PHOTO STORAGE
+
EMPLOYEE REFERENCE PHOTO
+
1:1 FACE VERIFICATION + LIVENESS
+
NO 1:N FACE IDENTIFICATION
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

The earlier absolute NO-PHOTO / NO-FACE language is superseded by the current
Owner decision. The current rule is more precise: retain one governed Employee
Reference Photo for 1:1 Attendance verification, require liveness/anti-spoof,
discard routine live verification frames, and do NOT retain check-in/check-out
or Patrol event photos. All previously approved Device/GPS/QR/Schedule/Server
Time/Anti-Replay/Risk/Offline controls remain in force.

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


## 2026-08-22 — Approval Workflow Standard V1 Phase 0–2 Foundation

Owner review of the Phase 0–2 implementation inventory is APPROVED for closeout. This section records the integrated foundation only; later License, Leave Return/Resubmit, Registration correction, and Schedule workflow redesign phases have not started.

### Production baseline protected

- Current Production SHA: `db0bf9c8ece06db467cb7690ad4d6fadd941a04b`
- Current Production deployment: `dpl_FAEJmdXEmTcCuDAzqVznwq75CdLL`
- Leave P2028 Product SHA: `668682900a12ca1b1506160690491bd30a7f0fa7`
- The Leave P2028 Production fix is mandatory lineage for all subsequent work.
- Preserve `ReadCommitted`, `maxWait=5000`, `timeout=15000`, P2028 → HTTP 503 `LEAVE_APPROVAL_TRANSACTION_TIMEOUT`, P2034 → HTTP 409 `LEAVE_QUOTA_STATE_CONFLICT`, quota locking, AL ShiftAssignment inside the final-approval transaction, self-approval guard, atomic AuditLog, post-commit notification, no automatic retry, and no partial mutation.

### Phase 0–2 integrated branch and exact identity

- Branch: `feature/approval-workflow-standard-v1`
- Base SHA: `db0bf9c8ece06db467cb7690ad4d6fadd941a04b`
- Product integration commit: `7488d7efe653e0b9de0118dcb7a1e014e691c9d9` — `feat: add governed employee master editing`
- Shared semantics commit: `7bc1fac2f196f65ee9bdad77d3da2ec0673cb32a` — `feat: add shared approval workflow semantics`
- Employee Master alignment commit / Product SHA: `49fad1490bfc356ced0d9cee9b0278a1c00b671d` — `feat: align employee master approval semantics`
- Product tree: `2465d1dc16575943d853b832aa56a0f3188ce223`
- CI-only SHA: `03dad13738eca1ce4125f49fa9fc149c084de551`
- CI-only parent: `49fad1490bfc356ced0d9cee9b0278a1c00b671d`
- CI-only change is limited to `.github/workflows/ci.yml` to validate `feature/approval-workflow-standard-v1`.
- Exact-head Remote CI run: `32556472256`
- Exact-head Remote CI job: `96991348939`
- Remote CI result: `SUCCESS`

### Migration lock

- Existing Employee Master migration `202608210001_employee_master_governed_edit_v1` is carried forward unchanged and byte-identical to the published Employee Master Product source.
- No new Approval Workflow Standard migration was created in Phase 0–2: `NEW_APPROVAL_STANDARD_MIGRATION=0`.
- Phase 1/2 shared approval semantics are source-only; no universal workflow database engine was introduced.

### Shared approval semantics and audit vocabulary

Shared transition semantics are standardized around:

- `SAVE_DRAFT`
- `SUBMIT`
- `RETURN_FOR_CORRECTION`
- `RESUBMIT`
- `APPROVE`
- `REJECT`
- `CANCEL`

Shared audit vocabulary for new compatible transitions is:

- `CREATE`
- `SAVE_DRAFT`
- `SUBMIT`
- `RETURN_FOR_CORRECTION`
- `RESUBMIT`
- `STAGE_APPROVE`
- `FINAL_APPROVE`
- `REJECT`
- `CANCEL`

Historical AuditLog rows are not renamed or backfilled. Module-specific services remain responsible for authority, current/next stage, editable owner, final business mutation, persistence, and notifications.

### Shared action-system semantics

Continue to use `frontend/src/styles/action-system.css`; do not create a parallel design system.

- Approve = GREEN / success semantic (`#16A34A` family)
- Return for Correction = ORANGE / warning semantic (`#F59E0B` family)
- Reject = RED / danger semantic (`#DC2626` family)
- Resubmit = PRIMARY BLUE (`#2563EB` family)
- Cancel Request = RED OUTLINE / destructive-secondary
- Save Draft = soft/secondary primary
- Close / Back = neutral
- Color is never the only signal; explicit Thai action text remains required.

### Employee Master alignment lock

Employee Master remains the reference implementation and its business state machine is not redesigned:

- Manager = request owner.
- Admin = final reviewer.
- No Employee → Manager review stage may be invented.
- Manager: DRAFT → SUBMIT → PENDING_APPROVAL.
- Admin: APPROVE / RETURN_FOR_CORRECTION / REJECT.
- Returned Manager: EDIT → RESUBMIT, or CANCEL_REQUEST.
- Preserve one-active-request protection, immutable revisions/events, stale-master protection, future-effective behavior, projected operational status rules, Manager PII boundary, Admin direct edit, and linked User lifecycle safety.
- New Employee Master final-approval AuditLog semantic is normalized to `FINAL_APPROVE` while the persisted immutable request event remains compatible with the existing schema/history contract.

### Registration correction scope — Owner locked

`REGISTRATION_CORRECTION_SCOPE=OPTION_A`

Returned Registration may edit only non-identity request information, initially `submittedName` and `departmentHint`.

Returned Registration must not change the existing request email or password/credential in place. If a different email or credential path is required: cancel the request, create a fresh Registration request, perform normal OTP ownership proof, and rerun duplicate/account/person guards. Do not weaken OTP ownership proof, existing-account guard, duplicate-person guard, no employee roster exposure, no employeeCode identity, or the prohibition on automatic linkage by name.

### Schedule draft ownership and approval authority — Owner locked

`SCHEDULE_DRAFT_OWNERSHIP=TEAM_OWNED`

Authorized Manager/Admin schedule editors may collaboratively prepare and correct working monthly Schedule drafts according to existing RBAC. Record the actual `submittedBy` actor; do not make a returned Schedule editable only by one individual owner.

However, approval authority is separately and permanently locked unless Owner explicitly changes it:

- `SCHEDULE_APPROVE_AUTHORITY=ADMIN_ONLY`
- `SCHEDULE_FINAL_APPROVE_AUTHORITY=ADMIN_ONLY`
- Manager must never approve, final-approve, or publish an approved monthly Schedule.
- Required future regression: `SCHEDULE_APPROVE_BY_MANAGER=BLOCKED`.
- Required future regression: `SCHEDULE_APPROVE_BY_ADMIN=ALLOWED`.

### Leave cancellation authority — Owner locked

`LEAVE_CANCEL_AUTHORITY=ADMIN_ONLY`

The generic workflow concept of requester cancellation does not grant Leave requester cancellation rights.

- VIEWER / Employee cannot cancel Leave.
- MANAGER cannot cancel Leave.
- ADMIN may cancel Leave according to the module's governed cancellation/reversal semantics.
- For a Leave request returned for correction, the requester may EDIT + RESUBMIT, but must not gain `CANCEL_REQUEST` authority.
- Required future regression: `LEAVE_CANCEL_BY_VIEWER=BLOCKED`.
- Required future regression: `LEAVE_CANCEL_BY_MANAGER=BLOCKED`.
- Required future regression: `LEAVE_CANCEL_BY_ADMIN=ALLOWED`.

Do not collapse pre-final workflow correction with the existing approved-Leave administrative/business cancellation or reversal. They have different authority, audit semantics, and business effects. The existing Production approved-Leave reversal route remains unchanged by Phase 0–2.

### Release and next-phase hard stop

Phase 0–2 produced no Production deployment, migration, data mutation, schema mutation, environment mutation, DNS mutation, or storage mutation. No Preview deployment is part of this closeout.

Subsequent implementation phases have NOT started. Do not begin License workflow changes, Leave Return/Resubmit changes, Registration correction implementation, or Schedule workflow redesign until the Owner explicitly authorizes the next phase.


## 2026-08-22 — Approval Workflow Standard V1 Phase 3 License Closeout

Owner review is APPROVED. Phase 3 License source, tests, migration design, and exact-head CI evidence are accepted as the locked License workflow candidate. This closeout records authority only; it does not deploy Preview or Production and does not start any later workflow phase.

### Phase 3 exact identity and commit lineage

- Branch: `feature/approval-workflow-standard-v1`
- Phase 3 behavior SHA / Commit C: `fe5ed03c62a21d7d3e9edec036f41a172dd56fd0` — `feat: align license workflow review ui`
- Commit A: `e3d78d765d955f2089ff9809ea44f83546a28c45` — `feat: add license document immutable revisions`
- Commit B: `f0da50441c0ca973c5e8600dc96fb1cef87ba7f1` — `feat: align license workflow ownership and transitions`
- Test-baseline-only commit: `21af471bd47b16209a61d7801191185952bfcad6` — `test: refresh authorized frontend api source locks`
- Prisma format-only commit: `9f7cc5795a8b966a5667c47c7fbcc94ab25b7769` — `style: format prisma schema`
- Exact Phase 3 candidate SHA: `9f7cc5795a8b966a5667c47c7fbcc94ab25b7769`
- Exact Phase 3 candidate tree: `712a576159a4da3c047cf8138d6cce145fc85e2a`

### License migration, request ownership, and immutable revision contract

- Migration: `202608220001_license_document_workflow_alignment_v1`.
- Migration design is additive only; no published migration was edited and no Production/Preview migration was applied during Phase 3.
- `LICENSE_REQUEST_OWNER_MODEL=EmployeeLicenseDocument.uploadedById`.
- The request owner is the User who submitted/uploaded the License workflow request; the Employee who owns the License is not treated as requester merely because the document belongs to that Employee.
- `IMMUTABLE_REVISION_MODEL=EmployeeLicenseDocumentRevision`.
- Initial submit creates Revision 1. Return + Resubmit creates the next immutable revision. Historical Revision N must never be overwritten by Revision N+1.
- Historical rows may materialize Revision 1 only through the implemented safe compatibility path.
- Only ADMIN `FINAL_APPROVE` may apply the current immutable revision values to authoritative `EmployeeLicense`.
- `RETURN_FOR_CORRECTION`, `RESUBMIT`, `REJECT`, and `CANCEL` must not mutate authoritative `EmployeeLicense`.

### License authority and terminal-state semantics — Owner locked

- `ADMIN_FINAL_APPROVE=ALLOWED`.
- `MANAGER_FINAL_APPROVE=BLOCKED`.
- `ADMIN_SELF_APPROVE=ALLOWED`; self-approval remains explicitly audited and is not generalized to other workflows.
- `RETURN_BY_ADMIN=ALLOWED`.
- `RETURN_BY_MANAGER=BLOCKED`.
- `RESUBMIT_BY_REQUEST_OWNER=ALLOWED`.
- `RESUBMIT_BY_UNRELATED_MANAGER=BLOCKED`.
- `LICENSE_CANCEL_ALLOWED_STATES=RETURNED_FOR_CORRECTION only`.
- `CANCEL_BY_REQUEST_OWNER_WHEN_RETURNED=ALLOWED`.
- `CANCEL_PENDING=BLOCKED`.
- `CANCEL_APPROVED=BLOCKED`.
- `CANCEL_REJECTED=BLOCKED`.
- `APPROVED`, `REJECTED`, and `CANCELLED` remain distinct terminal meanings; `RETURNED_FOR_CORRECTION` remains recoverable.
- Cancel is requester withdrawal after Return and is not reviewer Reject.

### License storage and document contract — Owner locked

- Accepted document types remain PDF / JPEG / PNG.
- Maximum file size is 4 MB.
- Magic-byte validation remains required.
- License storage remains private and document viewing remains signed.
- Historical private storage objects are not automatically deleted merely because a document becomes `RETURNED_FOR_CORRECTION`, `REJECTED`, `CANCELLED`, or `SUPERSEDED`.
- Governed permanent deletion remains a separate ADMIN behavior; expiration cleanup remains separate.
- Approved historical document/predecessor preservation semantics remain intact.

### Shared approval UI and audit semantics preserved

- License review actions use the shared Phase 1 action system: Approve = green, Return for Correction = orange, Reject = red, Resubmit = blue, Cancel Request = red outline.
- Authoritative Thai Return label is `ส่งกลับไปแก้ไข`.
- Cancel confirmation is distinct from Reject and does not imply document deletion.
- New License transition audit metadata uses the normalized Phase 1 vocabulary, including `SUBMIT`, `RETURN_FOR_CORRECTION`, `RESUBMIT`, `FINAL_APPROVE`, `REJECT`, and `CANCEL` where compatible with existing immutable `AuditLog` persistence.
- No redundant License workflow event table was introduced.

### System-wide authority regressions preserved

- `SCHEDULE_APPROVE_AUTHORITY=ADMIN_ONLY`.
- `SCHEDULE_FINAL_APPROVE_AUTHORITY=ADMIN_ONLY`.
- `SCHEDULE_APPROVE_BY_MANAGER=BLOCKED`.
- `SCHEDULE_APPROVE_BY_ADMIN=ALLOWED`.
- `LEAVE_CANCEL_AUTHORITY=ADMIN_ONLY`.
- `LEAVE_CANCEL_BY_VIEWER=BLOCKED`.
- `LEAVE_CANCEL_BY_MANAGER=BLOCKED`.
- `LEAVE_CANCEL_BY_ADMIN=ALLOWED`.
- Subsequent shared workflow work must not weaken these module-specific authority rules.

### Phase 3 validation evidence

- Commit C focused frontend tests: `29/29 PASS`.
- License backend focused tests: `41/41 PASS`.
- License real-DB integration: `8/8 PASS`.
- Phase 0–2 focused regression: `PASS`.
- Full backend: `551/551 PASS`.
- Full integration: `162/162 PASS`.
- Full frontend: `373/373 PASS` across `41/41` files.
- TypeScript: `PASS`.
- Production build: `PASS`.
- Prisma validate: `PASS`.
- Prisma generate: `PASS`.
- Prisma format check: `PASS`.
- Git diff check: `PASS`.
- Exact-head Remote CI run: `32560097886`.
- Exact-head Remote CI job: `97000264510`.
- Exact-head CI SHA: `9f7cc5795a8b966a5667c47c7fbcc94ab25b7769`.
- Exact-head CI event: `push`.
- Exact-head CI result: `SUCCESS`.

### Prisma format-only closeout

- `FORMATTER_OUTPUT_EXACT_MATCH=YES`.
- `FORMAT_ONLY_FILE=prisma/schema.prisma`.
- The format-only commit is formatter normalization only and is not a Product behavior change.
- `SCHEMA_SEMANTIC_CHANGE=NO`.
- `MIGRATION_CHANGE=NO`.

### Preview isolation and Production hard stop

- `PREVIEW_DATABASE_CLASSIFICATION=PRODUCTION_DB` for the current branch configuration.
- `PREVIEW_BRANCH_DATABASE_URL_OVERRIDE=NO`.
- `PREVIEW_BRANCH_DIRECT_URL_OVERRIDE=NO`.
- `PREVIEW_BRANCH_JWT_SECRET_OVERRIDE=NO`.
- `PREVIEW_BLOCKED_BY_DATABASE_ISOLATION=YES`.
- No Preview deployment, migration, data mutation, schema mutation, or environment mutation is authorized until an isolated Preview database configuration is separately created and proven.
- Phase 3 produced no Production deployment, migration, data mutation, schema mutation, environment mutation, storage mutation, or DNS mutation.
- `PRODUCTION_RELEASE=NOT_AUTHORIZED`.

### Subsequent-phase hard stop

- Phase 4 Leave Return/Resubmit implementation has NOT started.
- Phase 5 Registration correction implementation has NOT started.
- Phase 6 Schedule workflow redesign has NOT started.
- The separate Employee Master UX request to combine `แก้ไข` and `จัดการสถานะพนักงาน` entry points has NOT started and remains a separate subsequent task.
- No Product source, tests, Prisma schema, migrations, or CI workflow are to be changed as part of this Phase 3 documentation closeout.


## 2026-08-22 — Approval Workflow Standard V1 Preview Migration / UAT Checkpoint

This checkpoint supersedes older Preview-isolation statements above for the active `feature/approval-workflow-standard-v1` release line. Preview isolation is now proven and the Phase 3 License migration has been applied to the isolated Preview database. Production has not been promoted.

### Current Production baseline — preserve

- Current Production deployment: `dpl_FAEJmdXEmTcCuDAzqVznwq75CdLL`.
- Current Production SHA: `db0bf9c8ece06db467cb7690ad4d6fadd941a04b`.
- Leave P2028 Product SHA: `668682900a12ca1b1506160690491bd30a7f0fa7`.
- The Manager Leave-approval P2028 reliability fix remains mandatory lineage and must not be lost in any later promotion.
- Preserve `ReadCommitted`, `maxWait=5000`, `timeout=15000`, P2028 → HTTP 503 `LEAVE_APPROVAL_TRANSACTION_TIMEOUT`, P2034 → HTTP 409 `LEAVE_QUOTA_STATE_CONFLICT`, no automatic retry, quota locking, AL ShiftAssignment atomicity, self-approval protection, AuditLog, and post-commit notification behavior.
- `LEAVE_CANCEL_AUTHORITY=ADMIN_ONLY` remains locked.
- `SCHEDULE_APPROVE_AUTHORITY=ADMIN_ONLY` and `SCHEDULE_FINAL_APPROVE_AUTHORITY=ADMIN_ONLY` remain locked.

### Preview isolation — proven

- Target branch: `feature/approval-workflow-standard-v1`.
- Preview Supabase project name: `sms-v3-preview`.
- Preview Supabase project ref: `ezxanpfagitckpfsnflp`.
- Production Supabase project ref: `jkexwnlxnxbemwavsebv`.
- Branch-scoped Preview `DATABASE_URL`, `DIRECT_URL`, and `JWT_SECRET` overrides are present.
- Runtime project-identity proof confirmed both Preview database URLs resolve to the Preview project ref and not the Production project ref.
- `RUNTIME_CURRENT_DATABASE=postgres` is the normal Supabase PostgreSQL database name and is not itself evidence of Production use.
- Preview JWT/runtime validation is healthy after the Preview-only `JWT_SECRET` correction.
- `PREVIEW_DATABASE_CLASSIFICATION=ISOLATED_PREVIEW_DB`.
- `PREVIEW_ISOLATED_DATABASE_PROVEN=YES`.

### Migration checksum forensic closure

The apparent checksum drift for these already-applied migrations was a Windows working-tree line-ending artifact only:

- `202608190001_signature_v12_webauthn_passkeys`
- `202608210001_employee_master_governed_edit_v1`

Locked result:

- `MIGRATION_1_DIFFERENCE_CLASS=LINE_ENDINGS_ONLY`.
- `MIGRATION_2_DIFFERENCE_CLASS=LINE_ENDINGS_ONLY`.
- `MIGRATION_1_SEMANTIC_DRIFT=NO`.
- `MIGRATION_2_SEMANTIC_DRIFT=NO`.
- `PREVIEW_SCHEMA_STATE=SEMANTICALLY_EQUIVALENT`.
- `ROOT_CAUSE_CLASSIFICATION=WINDOWS_CRLF_LOCAL_CHECKSUM_ARTIFACT`.
- `ACTUAL_MIGRATION_DRIFT=NO`.
- `RECOMMENDED_REMEDIATION=NO_DATABASE_REPAIR_REQUIRED`.

Canonical migration-byte authority for this Windows workspace is the committed Git object bytes (`git cat-file blob` or equivalent byte-exact Git-object source), not CRLF materialized working-tree/archive bytes.

Do not rebuild Preview, edit `_prisma_migrations`, run `prisma migrate resolve`, rewrite applied migrations, or reopen this forensic gate unless new semantic evidence appears.

### Preview migration — completed

- Migration inventory before: `20 applied / 1 pending`.
- Applied migration: `202608220001_license_document_workflow_alignment_v1`.
- Migration inventory after: `21 applied / 0 pending`.
- Failed/rolled-back migrations: `0`.
- License migration canonical checksum: `498e3ded8cfd47890f792f0d2595f56c15204e1335d5092f1b30eaf54c08b3a6`.
- `employee_license_document_revisions` exists.
- `LicenseDocumentStatus.CANCELLED` exists.
- `DATABASE_REPAIR_PERFORMED=NO`.
- `PRISMA_MIGRATE_RESOLVE_USED=NO`.
- `PRISMA_DB_PUSH_USED=NO`.
- `PREVIEW_SEED=0` during the migration gate.
- Temporary migration/probe mechanisms were removed after evidence capture.

### Clean Preview deployment

- Clean Preview deployment: `dpl_3m39Pu3QVWPZqSznpgGqumsd7WbD`.
- Branch: `feature/approval-workflow-standard-v1`.
- Git SHA: `686a95df6080f60a0019407002e1d08c277dd2e8`.
- Clean tree: `51da7d7d1c4aa0ed1889e7e6f30365018c5c571e`.
- Deployment state: `READY`.
- `/health`: `200`, `status=ok`.
- `/ready`: `200`, `status=ready`, `database=ok`.
- Temporary identity probe: absent.
- Temporary migration mechanism: absent.

### Preview UAT fixtures and transport checkpoint

- UAT marker: `AWV1-UAT-20260822`.
- The first interrupted fixture transaction was read back as `ROLLED_BACK_COMPLETELY`.
- The known dedicated Preview fixture set was then provisioned once and confirmed complete.
- Dedicated UAT ADMIN / MANAGER / VIEWER accounts are present.
- Dedicated UAT Employee and 2027 LeaveQuota are present.
- Additional marker-scoped unrelated-Manager and Manager-linked Employee/quota fixtures exist for authority/self-approval checks.
- `FIXTURE_SCOPE=DEDICATED_PREVIEW_ONLY`.
- Existing realish user credentials were not modified.
- Vercel Deployment Protection was correctly distinguished from SMS authentication.
- Temporary Vercel-protection transport bridge fix: `PASS`.
- `vercel curl` informational stderr is tolerated only when native exit code is `0`; secret output remains prohibited.

### UAT status — not yet complete

Business workflow UAT has not yet been completed after the transport fix. Do not claim Preview UAT PASS or Production readiness yet.

Remaining minimum manual/automated Preview checks are:

1. Employee Master: Manager Submit → Admin `ส่งกลับไปแก้ไข` → Manager Edit/Resubmit → Admin Final Approve; also confirm authoritative mutation only after final approval.
2. License: Upload → Admin Return → request owner Resubmit → Admin Final Approve; Manager final approval blocked; returned-owner Cancel path; immutable revision increment.
3. Leave: authorized Manager approval PASS; Manager cancellation BLOCKED; Admin cancellation ALLOWED; self-approval guard preserved; do not remove the P2028 hotfix.
4. Schedule: Manager edit allowed where authorized; Manager Approve/Final Approve BLOCKED; Admin Approve ALLOWED.
5. Shared UI: Approve green, `ส่งกลับไปแก้ไข` orange, Reject red, Resubmit blue, Cancel red-outline.
6. Preview runtime closeout: no environment-validation errors, no unhandled exceptions, no unexplained HTTP 5xx during the UAT window.

Existing authoritative Phase 3 exact-head CI remains `32560097886 = SUCCESS`. If Product source does not change, the Owner-approved fast path does not require rerunning the full backend/integration/frontend suites merely to repeat already-proven CI evidence.

Current gate:

- `FINAL_STATUS=SMS_APPROVAL_WORKFLOW_STANDARD_V1_PREVIEW_UAT_IN_PROGRESS`.
- `READY_FOR=NOT_READY_FOR_PRODUCTION`.
- `PRODUCTION_RELEASE=NOT_AUTHORIZED` at this checkpoint.
- No Production deployment, migration, data/schema/env/storage/DNS mutation occurred during Preview isolation/migration/UAT preparation.

Next safe continuation: perform only the minimum Preview business UAT and runtime closeout above. Do not rerun Preview isolation, migration, fixture provisioning, CRLF forensic work, or transport setup unless new evidence proves those established gates invalid.

## 2026-08-25 — G06 Department ↔ SecuritySite / Default Site / Admin Security Site Management CI Closeout

This section records the isolated G06 feature-branch implementation candidate and its exact-head CI evidence. It does not authorize a Production release and does not claim the complete Attendance V1 program is finished.

### Exact branch / PR identity

- Branch: `feature/g06-department-security-site-v1`.
- Draft PR: `#111`.
- PR status at candidate verification: `OPEN / DRAFT / UNMERGED`.
- Verified implementation candidate HEAD: `ce612fa473c10d1e29b1eaaf2c1dde26ce9efdce`.
- Verified implementation candidate tree: `172094ae4a06a3d205a50e785fd97caa2356cb3a`.
- Exact-head Remote CI run: `32857117495`.
- Exact-head Remote CI job: `97831816379`.
- Remote CI result: `SUCCESS`.

### Database / migration / test gate evidence

CI uses an ephemeral PostgreSQL 16-alpine service with database `sms_v3_test`; no Production database is involved.

Exact candidate CI passed:

- Prisma format check: `PASS`.
- Prisma validate: `PASS`.
- Prisma generate: `PASS`.
- PostgreSQL test migrations: `PASS`.
- Test seed: `PASS`.
- Migration status: `PASS`.
- Backend unit tests: `PASS`.
- Backend integration tests: `PASS`.
- Frontend tests: `PASS`.
- Frontend TypeScript `tsc --noEmit`: `PASS`.
- Frontend production build: `PASS`.
- Repository hygiene: `PASS`.

### G06 authority / regression locks proven in this gate

- Department and SecuritySite remain separate concepts with Department ↔ SecuritySite mapping.
- Fresh Attendance Expected Site authority remains Schedule Site first, then Department Default Site, otherwise fail closed rather than guessing a fallback.
- Existing/open Attendance sessions preserve the pinned `expectedSiteId`; later schedule/default/mapping changes must not remap the session.
- Security Site deactivation is blocked when the Site is a Department Default with `SECURITY_SITE_DEFAULT_IN_USE`.
- A real PostgreSQL integration regression now creates an OPEN `AttendanceSession` using the actual schema semantics `state=OPEN`, `closedAt=null`, `expectedSiteId=<Site>` and proves deactivation fails with `SECURITY_SITE_OPEN_ATTENDANCE_IN_USE` without mutating the Site/session.
- The regression intentionally does not use the obsolete/nonexistent `checkOutAt` field.
- Raw SQL paths that operate on `security_site_departments.security_site_id` now cast bind values explicitly as UUID (`::uuid`) so PostgreSQL does not compare/insert UUID columns as text.
- Security Site QR lifecycle, Department default changes, Schedule override, historical pinning, and database uniqueness/invariant coverage remain part of the PostgreSQL integration gate.

### Frontend boundary correction

The Admin Security Site Management surface is no longer coupled to the Preview-only physical Active Challenge rehearsal flag.

- `AttendanceFaceChallengeUatPanel` again returns `null` when `VITE_G06_FACE_CHALLENGE_UAT` is disabled.
- `SecuritySiteManagementPanel` is rendered independently by `AttendancePage`.
- This preserves the permanent rule that physical Active Challenge rehearsal is Preview/UAT-only and non-authoritative while keeping Admin Site Management available independently.

### Release / Production hard stop

- Production deploy/promotion/alias: `0`.
- Production DB migration/data mutation: `0`.
- Production environment mutation: `0`.
- Production workflow dispatch: `0`.
- Merge to Production/default branch: `0`.
- PR #111 remains Draft/Open and must not be merged as part of this closeout.
- No Vercel Preview was required for this CI-only gate.
- `G06_DEPARTMENT_SECURITY_SITE_GATE=CI_GREEN_CANDIDATE`.
- `ATTENDANCE_V1_100_PERCENT=NO` — later Attendance V1 gates/audit items remain separate work.

## 2026-08-26 — G06 Department ↔ SecuritySite Diagnostic Closure

This section records the final CI-only closeout evidence for the G06
Department ↔ SecuritySite / Default Site / Admin Security Site Management
gate. It does not authorize Production release and does not claim that the
complete Attendance V1 program is finished.

### Exact branch / PR identity

- Branch: `feature/g06-department-security-site-v1`.
- Draft PR: `#111`.
- PR state: `OPEN / DRAFT / UNMERGED`.
- Verified G06 candidate before the handoff commits: `ccaa9ac67f7740439d27ef6a208c58326c71f18e`.
- Candidate tree: `74931613ba3df21c42c94a7bdeb6cf24de6a4d95`.
- Handoff commit verified by the final exact-head CI: `f4066c9ff1972f909489bd353635b3cf421e3039`.
- Handoff tree: `30b0161c1c087ef85371893819c2f02ede7ed879`.
- Final handoff CI: Run `32877558427`, Job `97899095041`, event `push`, checkout `f4066c9ff1972f909489bd353635b3cf421e3039`, result `SUCCESS`.

### Diagnostic failure and minimal correction

- Diagnostic artifact `9565609838` from Run `32854400888` / Job `97822732368` identified the first deterministic failure in `test/integration/security-site-department-authority.integration.test.js:109`.
- The failure reached `src/services/security-site.service.js:229`: PostgreSQL SQLSTATE `42804` rejected a text bind for UUID column `security_site_id` in the Department ↔ Site insert.
- `2bec7748e136380d2a7dd8de1a0acb3a1158b116` added the explicit `$1::uuid` cast for mapping inserts; `e3a5457d4646b2cb9b2a9d76d8c857a681ef7342` retained explicit UUID casts in deactivation queries.
- `37db2f98e6aa140a6aed75a8f24e06870401dd74` added the real PostgreSQL OPEN `AttendanceSession` deactivation regression using `state=OPEN`, `closedAt=null`, and `expectedSiteId`; no obsolete `checkOutAt` field is used.
- Temporary diagnostic artifact wrappers were removed in `ccaa9ac67f7740439d27ef6a208c58326c71f18e`; authoritative tests remain enabled.

### G06 evidence

- PostgreSQL 16 ephemeral migrations, seed, and migration-status checks: `PASS`.
- Prisma format, validate, and generate: `PASS`.
- Backend unit tests: `PASS`.
- Backend integration tests: `PASS`.
- Authoritative Attendance event PostgreSQL integration: `PASS`.
- Frontend tests: `PASS`.
- Frontend TypeScript noEmit: `PASS`.
- Frontend production build: `PASS`.
- Tracked frontend build metadata restore: `PASS`.
- Repository hygiene: `PASS`.
- Required authority behavior remains covered: Department ↔ Site mapping, one PostgreSQL-enforced Default Site per Department, Schedule Site precedence, Department Default fallback, fail-closed resolution, historical `expectedSiteId` pinning, Schedule changes not remapping open sessions, both deactivation guards, QR SHA-256/revocation/version/audit invariants, and actual-schema cleanup.
- The raw partial unique index for one Default Site per Department remains a PostgreSQL migration invariant; no Prisma `@@unique` replacement was introduced.

### Scope and safety

- Production deployment, promotion, alias, environment, database/data, migration, storage, and workflow-dispatch mutations: `0`.
- No Production database or secrets were used for diagnosis or validation.
- Owner decision remains that Department and SecuritySite are separate entities, Employee keeps `Employee.department`, and existing Attendance sessions retain their historical expected Site.
- `ATTENDANCE_V1_100_PERCENT=NO`: remaining Attendance V1 work includes employee check-in/out end-to-end, authoritative server time, event GPS/accuracy/geofence and expected/actual Site, Shift Master/Schedule/overnight and timing/risk flags, missing/absent/leave handling, corrections/audit, supervisor dashboard, monthly certification and lock/revision, PDF/Excel/privacy/retention, and final Preview/UAT gates. No event-photo evidence is claimed by this G06 gate.
