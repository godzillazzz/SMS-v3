# G06 — Attendance API Contract Draft (Unmounted)

Status: **INTERNAL / UNMOUNTED / NO PUBLIC ATTENDANCE WRITE ROUTE**

AWS/provider integration remains paused. Biometric runtime remains closed in current Preview and Production.

## Purpose

This draft defines the provider-neutral application contract that a future authenticated Attendance route may call after a separate review gate. It composes existing server-authoritative context validation, Face Verification preparation, readiness-state mapping and atomic AttendanceEvent acceptance without allowing the browser to decide biometric PASS.

No Express route or frontend page is added by this checkpoint.

## Contract 1 — Assess readiness

Future conceptual operation: `POST /api/v1/attendance/verification/readiness` — **not mounted now**.

Input owned by the request:

- `captureId` — UUID generated for this Attendance attempt.
- The client does NOT send `eventIntent`. The server resolves `CHECK_IN` or `CHECK_OUT` from the authoritative current ShiftAssignment + AttendanceSession/Event state.
- `attendanceEvidence.qrToken` — raw current-site QR presented only for server validation; it must not be logged or persisted.
- `attendanceEvidence.location` — current GPS latitude/longitude, accuracy and capturedAt.

Not accepted as authority:

- client `contextDigest`;
- client `siteBindingDigest` / `qrBindingDigest` / `locationBindingDigest`;
- client liveness/PAD/face-match/injection booleans or scores.

Behavior:

1. server-owned biometric-runtime gate is checked first;
2. if disabled, return `BIOMETRIC_RUNTIME_DISABLED` without creating a FaceVerificationSession;
3. if enabled, call the existing server-side `prepareContext` authority chain;
4. valid context returns `READY_TO_START_VERIFICATION` with `attendanceAccepted=false`;
5. failures map to the stable readiness contract and remain fail closed.

## Contract 2 — Begin verification

Future conceptual operation: `POST /api/v1/attendance/verification/start` — **not mounted now**.

Input is the same raw Attendance evidence as readiness. The server recalculates authority; the browser cannot submit a trusted digest.

If the server-owned biometric runtime is disabled, no downstream verification call is made.

A successful internal result may return only the fields required for the future verification flow:

- `sessionId`;
- safe verification `status`;
- `expiresAt`;
- opaque device `challengeId` + challenge value;
- server-produced `attendanceContext` reference containing no raw QR token.

`READY_TO_START_VERIFICATION` still has `attendanceAccepted=false`. Starting a verification is not Attendance success.

## Contract 3 — Accept verified Attendance event

Future conceptual operation: `POST /api/v1/attendance/events` — **not mounted now**.

Input:

- opaque verification `receipt` returned by the trusted backend provider flow;
- exact server-produced `attendanceContext` from that attempt.

The API/facade must pass these to `AttendanceEventService.acceptVerifiedEvent`. The existing service re-resolves current employee/device/reference/schedule/site/QR/GPS authority and consumes the receipt inside the same transaction as AttendanceEvent persistence.

Only after that transaction returns a committed event may the API response set:

- `attendanceAccepted=true`;
- committed Attendance event/session identifiers and safe metadata;
- `idempotent=true` when the exact capture already committed previously.

Any thrown domain failure maps to readiness with `attendanceAccepted=false`.

## Runtime semantics

The biometric runtime switch is a server-owned dependency supplied to the internal facade. This contract does not read a browser flag and does not introduce a new environment variable.

While AWS/provider work is paused:

- readiness is effectively runtime-disabled when wired in the future;
- begin-verification is blocked before creating provider work;
- no local/browser biometric fallback is allowed;
- existing provider code remains preserved but disabled;
- accepting a cryptographically valid existing receipt is defined separately from provider-start availability and remains governed by authoritative receipt/event validation.

## Response safety

The facade must not copy raw thrown errors, provider payloads, stack traces, QR tokens, receipt hashes/secrets, biometric media or scores into UX responses.

The verification-start projection is intentionally narrow. Internal provider references, credential fingerprints and Reference Photo checksums are not exposed by this contract.

## Review gate before mounting

Before any route is mounted, review must explicitly confirm:

1. authentication/RBAC policy for employee self-Attendance;
2. rate limits/idempotency for readiness/start/event acceptance;
3. request schemas and body-size limits;
4. anti-CSRF/session assumptions for the current frontend architecture;
5. public error/status-code mapping versus readiness-state payloads;
6. audit logging with receipt/QR/provider-secret redaction;
7. Preview migration state for `202608240003` and `202608240004`;
8. Preview-only runtime enablement policy;
9. frontend UX/mobile camera/location permissions;
10. no Production activation without separate Owner authorization.

This checkpoint deliberately stops before mounting any route.


### Server-owned event intent

- No current AttendanceSession for the authoritative shift -> server resolves `CHECK_IN`.
- OPEN session with a committed `CHECK_IN` and no `CHECK_OUT` -> server resolves `CHECK_OUT`.
- Completed/closed or inconsistent session state -> fail closed; the client cannot override the decision.
- A server-issued `attendanceContext.eventIntent` is bound into the verification context digest and may be echoed back only for opaque-receipt event acceptance.
