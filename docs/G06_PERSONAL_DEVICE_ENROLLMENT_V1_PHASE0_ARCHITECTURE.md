# G06 Personal Device Enrollment V1 — Phase 0 Architecture / Existing-System Fit Audit

Date: 2026-08-23

## Gate and source identity

- Phase: 0 — architecture / existing-system fit audit only.
- Working branch: `feature/g06-personal-device-enrollment-v1`.
- Exact Production base SHA: `50b81e90a85e2dddd97a0ee545d32c3f58f8c4e8`.
- Exact Production base tree: `9fd3652a225b3856bf3a341bdeb10b71fa12be0b`.
- Authorized workspace root: `C:\Users\sermp\OneDrive - PTTPLC\04_SSO\ปี-2569\40.AI\ระบบ Security Management System V3`.
- Isolated worktree: `.worktrees/g06-personal-device-enrollment-v1`.
- Production deployment/env/DB/data/auth/storage mutation: NONE.
- Prisma/schema/migration mutation in Phase 0: NONE.

## Owner locks carried forward

1. One Employee has at most one ACTIVE primary Attendance/Patrol device.
2. Passkey authenticates account access; it is not authoritative Attendance/Patrol device identity.
3. A valid account/passkey on a device enrolled to another Employee is insufficient for normal Attendance/Patrol acceptance.
4. Device replacement approval is ADMIN ONLY.
5. Old device credential must be revoked atomically with activation of the replacement credential.
6. Browser fingerprint, User-Agent, cookie, IMEI, or arbitrary device name must not be the core device identity.
7. Employee Code is non-authoritative and must not participate in device identity/linkage.
8. Attendance/Patrol validation also retains GPS/geofence, secure static QR, Schedule/Shift authority, server time, anti-replay/idempotency, risk handling, and controlled-offline rules.
9. No continuous GPS tracking.
10. Existing WebAuthn/passkey behavior must not be weakened.

## Existing Production fit

### User ↔ Employee authority

Production already has a one-to-one optional linkage:

`User.employeeId -> Employee.id`

This is the correct account-to-person linkage for device enrollment. Device enrollment should bind to authoritative `Employee.id`, while the authenticated User supplies account/session context. `employeeCode` is not needed.

### Existing WebAuthn/passkey

Production stores `WebAuthnCredential` per User and intentionally permits multiple active credentials. Credentials may be backed up/synced and are account authentication factors.

Therefore `WebAuthnCredential` MUST NOT be reused as the Attendance primary-device registry. Doing so would violate the Owner rule because multiple passkeys can legitimately exist for one account and one phone can contain passkeys for multiple accounts.

### Existing Attendance lineage

Historical G06.1A commits exist on remote lineage:

- `3da77b3` — Attendance foundation.
- `08f5ebf` — server validation for offline attendance.

Historical G06.1B continues with `8995f66` — Attendance Admin configuration.

The legacy foundation contains useful concepts such as:

- SecuritySite + geofence radius.
- AttendanceSession expectation snapshots.
- AttendanceEvent `captureId` uniqueness/idempotency.
- capturedAt / receivedAt / effectiveEventAt separation.
- ONLINE / OFFLINE provenance.
- server validation requirement for offline events.

But the legacy lineage is based on an older application baseline and must not be cherry-picked wholesale onto current Production.

Most importantly, it has no authoritative personal-device enrollment/credential lifecycle. `AttendanceEvent.deviceContext` is only JSON context and cannot enforce one-active-primary-device authority.

## Required architecture boundary

Keep three identities separate:

`Account identity (User / password / OTP / passkey)`

+ `Employee authority (Employee.id)`

+ `Attendance device authority (dedicated device enrollment + cryptographic device credential)`

A successful account login proves account access. It does not prove that the current browser/device is the Employee's ACTIVE Attendance device.

## Proposed additive persistence model

The implementation should use dedicated module-specific persistence rather than altering WebAuthn tables.

### AttendanceDeviceEnrollment

Purpose: authoritative current/historical Employee-to-device enrollment.

Candidate fields:

- `id UUID`
- `employeeId UUID` — authoritative Employee linkage.
- `publicKey Bytes` or canonical public-key representation.
- `keyAlgorithm` — tightly allowlisted algorithm identifier.
- `credentialFingerprint` — server-derived non-secret fingerprint for support/audit.
- `displayName` — user/admin-friendly label only; never authority.
- `platformHint` / `userAgentSnapshot` — optional diagnostic metadata only.
- `status` — PENDING / ACTIVE / REVOKED / REJECTED as applicable.
- `enrolledAt`, `activatedAt`, `revokedAt`.
- `revokedReason`.
- `createdByUserId`.
- `approvedByUserId` where approval is required.
- immutable created/updated timestamps.

Constraint direction:

- database-enforced at-most-one ACTIVE primary enrollment per Employee where practical;
- otherwise transactional locking + conflict guard plus indexed query, with regression tests proving no double-active state.

Do not store device private keys server-side.

### AttendanceDeviceChallenge

Purpose: short-lived server challenge for device proof / enrollment proof / sensitive device operations.

Candidate fields:

- `id UUID`
- `employeeId`
- `deviceEnrollmentId?`
- `purpose`
- `challengeHash` (not plaintext challenge if avoidable)
- `expiresAt`
- `consumedAt`
- `createdAt`

Properties:

- single-use;
- short TTL;
- server-generated high entropy;
- purpose bound;
- Employee/device bound;
- replay-safe.

### AttendanceDeviceChangeRequest

Purpose: governed replacement lifecycle because replacement approval is ADMIN ONLY.

Candidate state model:

`PENDING_ADMIN_APPROVAL -> APPROVED / RETURNED_FOR_CORRECTION / REJECTED / CANCELLED`

Candidate fields:

- `id UUID`
- `employeeId`
- `requestedByUserId`
- `currentDeviceEnrollmentId?`
- `candidateDeviceEnrollmentId`
- `status`
- `reason`
- reviewer / reviewedAt / reviewReason
- immutable transition/audit metadata or module event/revision records where needed.

The module must follow shared workflow semantics without inventing Manager approval. ADMIN remains the only final replacement approver.

## Cryptographic device credential direction

Preferred Web/PWA foundation:

1. Browser generates an asymmetric signing key with Web Crypto where platform support permits.
2. Private key remains local and non-exportable when the platform/browser supports that property.
3. Server receives only public credential material plus non-authoritative metadata.
4. Server issues a fresh challenge for enrollment proof and for Attendance/Patrol device proof.
5. Device signs the challenge.
6. Server verifies signature, purpose, TTL, single-use status, Employee ownership, enrollment ACTIVE state, and replay guards.

The selected key algorithm and browser compatibility must be validated against target Android/iOS/desktop browsers before implementation lock. Do not silently downgrade to a reusable bearer device token merely because Web Crypto behavior differs by browser.

## Browser storage boundary

Production currently has no established Service Worker / IndexedDB / device-key layer in the exact Production source.

For a Web/PWA implementation:

- private-key handle/material must remain local;
- device enrollment identifiers may be cached locally but are not authentication authority by themselves;
- IndexedDB is a likely persistence mechanism for non-exportable CryptoKey objects where supported;
- origin is security-critical;
- controlled-offline rollout must not proceed before Owner locks the rollout origin strategy.

If reliable non-exportable key persistence or secure offline proof cannot be achieved on the target web stack, escalate to the already-approved future Android hardening architecture gate rather than weakening the device identity model.

## Request / verification API direction

Candidate API surface; names are architectural, not yet implementation lock:

- `POST /api/v1/attendance/devices/enrollment/options`
- `POST /api/v1/attendance/devices/enrollment/verify`
- `GET /api/v1/attendance/devices/me`
- `POST /api/v1/attendance/devices/proof/options`
- `POST /api/v1/attendance/devices/proof/verify`
- `POST /api/v1/attendance/devices/change-requests`
- ADMIN review endpoints for return/reject/final approve.

All business Attendance/Patrol event acceptance should consume a server-verified device proof result, not trust a client-supplied `deviceContext` assertion.

## Replacement transaction invariant

Final ADMIN approval must be one atomic transaction:

1. lock/read authoritative Employee + active device state;
2. verify request is still actionable and candidate credential is valid;
3. revoke old ACTIVE enrollment if present;
4. activate exactly one candidate enrollment;
5. finalize change request;
6. write AuditLog / immutable transition evidence;
7. commit;
8. only after commit, perform non-authoritative notifications.

Any conflict must fail closed with no partial old/new device state.

## Employee lifecycle interaction

Operational device eligibility must follow current Employee authority:

`Employee.isActive === true && Employee.deletedAt === null`

A suspended/resigned Employee must not be allowed to create normal verified Attendance/Patrol events even if an old device credential remains cryptographically valid. Device records remain historical; they are not deleted merely because employment status changes.

A future policy may revoke device credentials automatically on terminal lifecycle transitions, but that behavior must be explicit and audited rather than inferred silently in Phase 0.

## Audit requirements

At minimum audit:

- device enrollment request creation;
- candidate-key proof success/failure summaries without secret material;
- ADMIN final approval;
- return for correction;
- rejection;
- cancellation where permitted;
- old-device revocation;
- new-device activation;
- credential replay / owner mismatch / revoked-device validation outcomes where appropriate for security review.

Never log private keys, raw secret challenges, bearer credentials, or reusable biometric material.

## Risk/result integration

Device layer should produce structured outcomes that Attendance/Patrol validation can consume, including:

- `DEVICE_OWNER_MISMATCH`
- `NEW_DEVICE`
- `DEVICE_REVOKED`
- `DEVICE_PROOF_INVALID`
- `DEVICE_PROOF_EXPIRED`
- `REPLAY_ATTEMPT`

These are validation/risk evidence, not automatic misconduct findings.

## Items explicitly not implemented in Phase 0

- no Prisma schema change;
- no migration;
- no Preview DB mutation;
- no Production DB/env/data/auth/storage mutation;
- no device private-key generation code;
- no Service Worker/IndexedDB queue;
- no Attendance check-in/check-out route;
- no QR implementation;
- no face/liveness implementation;
- no Production deployment or Preview deployment.

## Owner decision required before Phase 1 schema/implementation

The permanent rules explicitly lock ADMIN-only authority for **replacement**, but the canonical handoff does not explicitly define final activation authority for the **first-ever primary device** when an Employee has no previous device.

Phase 1 must not silently invent that authority. Before schema/behavior implementation, Owner should lock one of these models:

- **A — ADMIN_APPROVAL_FOR_INITIAL_AND_REPLACEMENT**: Employee requests first device; ADMIN activates it. Replacement is also ADMIN-only.
- **B — SELF_ACTIVATE_INITIAL_ONLY, ADMIN_REPLACEMENT**: authenticated linked Employee may activate the first device only when no device history/active device exists; every later replacement is ADMIN-only.

Security recommendation: **A** provides the strongest and simplest authority boundary and avoids a compromised account self-binding a new Attendance device without a second administrative gate.

## Phase 0 result

`G06_PERSONAL_DEVICE_ENROLLMENT_V1_PHASE0_ARCHITECTURE_AUDIT_COMPLETE`

Ready for Owner authority decision on first-device activation, then Phase 1 additive schema/service/test implementation. Production remains unchanged.
