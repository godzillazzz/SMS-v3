# SMS — OWNER PROJECT HANDOFF

> START HERE FOR A NEW CHAT / CODEX SESSION.
> Read this complete file before proposing or modifying the SMS project.

Last Updated:
2026-08-21

Repository:
godzillazzz/SMS-v3

This is the single canonical project-continuity document. Future approved
updates must replace or update this file rather than creating versioned
handoff copies.

## CURRENT PRODUCTION

Production is separate from the current development/self-host candidate.
G06 is not Production.

- Production application SHA: 94b4667771006b00759ddf6f0ec447d27400206c
- Production tree: 31e1dbe6c5fb4f8aa47f41052d1d1ae31cfd9f3e
- Production release: G05 — License Document Permanent-Delete Audit Tombstone
- Production deployment: dpl_GLmDVZHQwrEkvBuUwuDcvSzNRf5Z
- Canonical current Vercel hostname: sms-v3-staging-ten.vercel.app

## CURRENT DEVELOPMENT

The current development candidate is the self-host infrastructure foundation,
not the Production deployment.

- Development branch: feat/self-host-infrastructure-foundation-v1
- Development SHA: 6281e233751a7b0299ec3713296c863af4fb538d
- Development tree: ad28215e9cca2bdb1a715dfcbb3ea127d1fb2294
- Self-host product commit: 045a8ef73d2ab0364d541b650647e4efde82b6e4
- Exact-head Remote CI: run 32442374968, job 96655476241, PASS
- Status: SMS_SELF_HOST_INFRASTRUCTURE_CANDIDATE_READY_OWNER_INPUT_REQUIRED

The canonical self-host domain is unresolved. G06.2 Production rollout remains
blocked by the canonical origin/domain gate.

## COMPLETED G06 GATES

- G06.0 — Architecture / Existing-System Fit / Self-host Audit: OWNER APPROVED
- G06.1A — Attendance Core Foundation: APPROVED
- G06.1B — Admin Configuration: COMPLETE
- Owner Visual Gate: APPROVED
- Preview Runtime Gate: VERIFIED
- Self-host Infrastructure Foundation: CANDIDATE READY / OWNER INPUT REQUIRED

Employee Attendance is not live in Production.

## EMAIL NOTIFICATION — CURRENT ACTIVE BEHAVIOR

This section records current code behavior, not desired future policy.

1. Registration OTP
   - Recipient: submitted email

2. Password Reset OTP
   - Recipient: active account email when eligible

3. Registration email verified / reviewable request created
   - Recipient: active ADMIN + MANAGER group

4. Leave request created — reviewer notification
   - Current active recipient: active MANAGER group

5. Leave request created — employee confirmation
   - Recipient: linked active employee user

6. Leave approved
   - Recipient: linked active employee user

7. Leave rejected
   - Recipient: linked active employee user

8. Leave cancelled
   - Recipient: linked active employee user

9. Monthly schedule approved
   - Current behavior: broadcast to active Users/Employees with valid email

Important findings:

- Email delivery is gated by email-notification and SMTP configuration.
- The active leave reviewer broadcast targets MANAGER in the operations path.
- Registration approve/reject has no confirmed applicant email notification
  path.
- Schedule approval recipient scope is broad.
- Legacy leave notification helpers/routes exist, but must not be assumed
  active without mounted-route and callsite proof.
- routes/index.js mounts the operations route and does not directly mount the
  legacy leaves.routes.js path.
- There is no active Attendance email behavior.

No email addresses or SMTP credentials belong in this document.

## EMAIL POLICY — OWNER REVIEW / PROPOSED

The following policy is proposed and not implemented.

### Registration

- OTP: applicant
- Verified/reviewable: Admin + Manager
- Approved: applicant
- Rejected: applicant

### Leave

- Submitted: employee + Admin + Manager
- Approved: employee
- Rejected: employee
- Cancelled: employee

### Schedule

- Approved: preferably affected employees for that month rather than every
  system account

### License

- Future approval/rejection: owner
- Future expiry warnings: policy still to be designed

### Attendance

Do not email every check-in/out. Future notification should focus on
high-value exceptions and supervisor digest events.

Do not implement EMAIL-01 as part of this handoff documentation update.

## G06 ATTENDANCE OWNER-APPROVED CORE

The approved architecture is:

ONLINE FIRST
→ CONTROLLED OFFLINE FALLBACK
→ AUTO SYNC
→ SERVER VALIDATION

Employee self-attendance requires GPS and a fresh live photo. There is no
continuous location tracking and no ordinary gallery-upload substitute.

Online:

- Server receivedAt/server time is authoritative.

Offline:

- Capture locally with captureId, capturedAt, GPS, mandatory fresh photo, and
  signed or cached expected context where applicable.
- Display OFFLINE_PENDING / waiting sync.
- Never represent offline pending as server-confirmed attendance.

On reconnect, automatic retry/sync is validated by the server for:

- idempotency
- schedule and shift
- expected site and geofence
- evidence
- time and risk

Both capturedAt and receivedAt must be preserved. Sync time must not silently
replace the captured event time.

Owner defaults:

- Normal offline sync window: 24 hours
- Local unsynced hard retention: 7 days
- Overdue evidence: review/risk required; it is not silently deleted

## ATTENDANCE BUSINESS RULES

- Schedule is expected; Attendance is actual.
- Site and Department are separate concepts.
- Expected Site is assigned by Admin through Schedule/assignment.
- Current examples are configurable Shift Master values:
  - DAY: 07:00–19:00
  - NIGHT: 19:00–07:00 next day
- DAY and NIGHT are not permanent hardcoded limits.
- There is no grace period; late begins immediately after expected start.
- Early checkout is flagged EARLY_OUT immediately.
- Overtime is not part of the approved rule set.
- Wrong shift preserves evidence and adds WRONG_SHIFT.
- A different valid site preserves evidence and adds ASSIST_OTHER_SITE.
- Outside all sites preserves evidence and adds OUTSIDE_ALL_SITES and review.
- Missing checkout must not invent checkout time or worked hours.
- Manager and Admin corrections are allowed, but original evidence remains
  immutable and reason, actor, time, and Audit are required.

## PATROL RELATIONSHIP

PS and PN are Patrol Routes, not shift names.

Valid future relationship:

- Manager
- Shift = NIGHT
- Patrol Route = PS

Attendance is independent from Patrol execution. G07 handles Patrol execution
later.

## MOBILE ATTENDANCE UX DIRECTION

The approved direction is mobile-first: simple front end with strong backend
authority.

Employee primary flow:

- Clock Home with one large primary action
- Before check-in: CHECK-IN
- After check-in: CHECK-OUT
- Main navigation: Clock and History

Employees do not choose Expected Site, Shift, Duty, or Patrol Route. Those
come from authoritative Schedule/assignment.

Self-service flow:

Open → Check-in → Live camera → GPS → Photo preview → Confirm → Server result

Offline uses the same capture UX, but the result must say saved on device /
waiting sync, not server-confirmed success.

Permission onboarding must explain that GPS is collected only at attendance
events and is not continuous tracking.

## EVIDENCE

- Fresh photo is mandatory for employee Attendance.
- Evidence is private.
- Ordinary gallery upload is not allowed.
- Continuous tracking is not allowed.
- Server binary retention is rolling one year from capturedAt.
- PostgreSQL stores metadata/reference, not photo blobs.
- Authorized viewing uses an eye/view action with private access.
- Photos are not embedded in Excel or PDF reports.

## SELF-HOST FOUNDATION

The verified foundation contains:

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

Disposable validation proved:

- Docker build: PASS
- non-root application container: PASS
- PostgreSQL 16: PASS
- root, health, and ready endpoints: PASS
- unauthenticated auth/me: HTTP 401
- database persistence after application restart: PASS
- database persistence after image replacement: PASS
- backup: PASS
- restore with data verification: PASS
- release replacement and rollback mechanics: PASS

The physical private evidence provider is not implemented because the Owner
storage protocol/location is not yet specified.

## PHYSICAL INFRASTRUCTURE PLAN

Current Owner inputs:

- Internet: Static Public IPv4
- Power: station UPS plus emergency diesel generator

Preferred architecture:

### Dell R330 — Production/Main Candidate

Approximate known configuration:

- Xeon E3-12xx v5/v6 class
- 32–64 GB ECC class
- H330/H730/H730P class controller
- 2 × 1GbE
- former CCTV server

The R330 exact hardware and disk health must be verified before Production
use. Disk health is not yet verified.

### Dell R520 — Backup/Restore Candidate

Known:

- dual Xeon E5-2450 v2
- 16 cores / 32 threads total
- 128 GB ECC
- 8 × 2 TB SAS
- PERC H710 with battery
- iDRAC 7 Enterprise
- dual PSU

## DOMAIN

The Owner currently has no registered canonical SMS domain.

Preferred name discussed:

- secureops.in.th

Possible application origin:

- https://sms.secureops.in.th

This is a preference only. It is not purchased or locked.

CANONICAL DOMAIN GATE: OWNER INPUT REQUIRED

Do not treat the domain as active until the Owner confirms registration and
DNS ownership.

## WHY DOMAIN BLOCKS REAL G06.2 ROLLOUT

Service Worker, Cache Storage, IndexedDB, cookies, and WebAuthn/passkeys are
origin-sensitive.

Do not roll employee controlled-offline Attendance into real Production on a
temporary origin and then change the canonical origin. That could make
browser-local queues inaccessible from the new origin.

Local and mocked development may continue. Real employee rollout waits for the
canonical origin lock.

## WEBAUTHN

Current Production passkeys are bound to the current Vercel origin and RP
identity.

Moving to a new Owner-controlled domain requires a controlled WebAuthn
cutover. Password/OTP fallback must remain available during transition.

Do not weaken WebAuthn security to preserve old-origin passkeys.

## BACKUP DIRECTION

Preferred topology:

R330 Production
→ private LAN backup
→ R520 Backup/Restore

The R520 backup target may contain:

- PostgreSQL backups
- evidence backups
- report and release metadata
- restore-test environment

RAID is not backup. An additional offline or offsite copy remains recommended.

Exact backup retention, RPO, and RTO remain Owner infrastructure decisions
until formally locked.

## NEXT WORK PLAN

Current immediate work:

- EMAIL-01: review and normalize notification policy

Potential later work that does not require the final Production origin:

- Mobile Attendance UI and local visual harness
- camera/GPS client contracts
- server validation
- Attendance Engine
- history/review concepts
- focused tests

Do not perform real employee PWA/offline Production rollout before the
canonical-domain and server gates are complete.

## OWNER INPUT REQUIRED

Before real self-host Production cutover, obtain:

- registered canonical custom domain and DNS ownership
- TLS termination and certificate plan
- R330 exact hardware, disk health, and capacity
- network and ingress topology
- PostgreSQL host/database identity and deployment fingerprint
- private evidence-storage protocol and location
- backup destination, retention, RPO, and RTO
- scheduler host and monitoring/alert destination
- WebAuthn domain cutover strategy

Do not request or record passwords, tokens, cookies, private keys, or SMTP
credentials in this file.

## SAFETY / RELEASE RULES

- GitHub is the source of truth.
- Exact SHA and tree identity are required.
- Exact-head Remote CI is required.
- No Production deployment without explicit Owner authorization.
- No Production migration without explicit Owner authorization.
- No Production environment or data mutation without explicit Owner
  authorization.
- Never deploy from a dirty or wrong worktree.
- Use isolated clones/worktrees for release operations.
- Never put passwords, tokens, cookies, or private keys in this handoff.
- No destructive Production UAT.
- Never edit live source directly on a Production server.
- Preserve the rollback checkpoint.
- Do not promote an arbitrary old Preview deployment.
- Schema migration creation and Production migration execution are separate
  gates.

## DOCUMENTATION-ONLY CURRENT GATE

This handoff update changes only:

- docs/OWNER_PROJECT_HANDOFF.md

Current operation mutation counts:

- Product/source behavior changes: 0
- Schema changes: 0
- Migration: 0
- Production deployment: 0
- Production environment changes: 0
- Production DB/data changes: 0
- Vercel mutation: 0
- DNS mutation: 0

## New Chat / New CODEX Session

Before doing any work:

1. Read this entire file.
2. Verify CURRENT PRODUCTION separately from CURRENT DEVELOPMENT.
3. Verify Git SHA/tree before modifying source.
4. Treat Owner-approved rules in this document as authoritative unless the
   Owner explicitly supersedes them.
5. Update/overwrite THIS SAME FILE after each major approved gate.
