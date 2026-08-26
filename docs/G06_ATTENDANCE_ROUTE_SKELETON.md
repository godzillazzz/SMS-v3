# G06 Attendance Route Skeleton — Preview/Internal Gate

Status: SOURCE PREPARATION ONLY / PREVIEW HIDDEN BY DEFAULT

Owner direction remains unchanged: AWS/provider integration is paused, biometric runtime is closed, and Production activation is not authorized.

## Purpose

This gate exposes the already-accepted internal Attendance API contract through an authenticated Express route skeleton without enabling biometric runtime or Production Attendance.

Mounted prefix:

`/api/v1/attendance`

Skeleton operations:

- `POST /readiness`
- `POST /verification/start`
- `POST /events`

## Visibility gate

The route is fail-closed before authentication unless all route visibility conditions are satisfied.

- `VERCEL_ENV=production` => always hidden with HTTP 404.
- Preview requires `ATTENDANCE_API_PREVIEW_ENABLED=true`.
- No Vercel environment value is added by this source checkpoint.
- Therefore the normal automatic Preview produced from this source remains hidden unless a later explicit Preview-enablement gate adds that variable.

## Biometric runtime gate

Route visibility is separate from trusted biometric runtime.

Biometric start readiness is considered enabled only when:

- Vercel environment is Preview;
- Attendance Preview route flag is enabled; and
- the existing trusted Face Verification PoC runtime flag `FACE_VERIFICATION_POC_API_ENABLED=true` is also enabled.

Production always returns biometric runtime disabled regardless of flag values.

The current Owner decision keeps AWS/provider runtime paused, so no Face Liveness/CompareFaces runtime is enabled by this checkpoint.

## Request authority boundary

`/readiness` and `/verification/start` accept only:

- authenticated account identity from server middleware;
- client-generated UUID `captureId` used only as idempotency/correlation input;
- no client event intent; the backend resolves `CHECK_IN` / `CHECK_OUT` from authoritative Attendance state;
- raw Attendance QR token;
- GPS latitude/longitude/accuracy/capturedAt.

The server remains responsible for resolving Employee, active device, Reference Photo, ShiftAssignment, approved Schedule, expected Security Site, QR credential authority, geofence decision and the canonical Attendance context digest.

Strict route schemas reject extra client biometric or authority claims such as:

- `padPassed`;
- `faceMatchPassed`;
- `contextDigest`;
- provider confidence/similarity/score;
- provider result payloads.

`/events` accepts only an opaque verification receipt plus the server-issued Attendance context reference. Receipt validation/replay/stale checks and AttendanceEvent persistence remain server-authoritative.

## Success semantics

A route response must never treat readiness or verification-start success as Attendance success.

- readiness ready => `attendanceAccepted=false`;
- verification session created => `attendanceAccepted=false`;
- only a committed `AttendanceEventService.acceptVerifiedEvent()` result may return `attendanceAccepted=true`.

## Authentication / View As

The route uses the existing SMS `authenticate` middleware. Existing token lifecycle and View As write protection remain unchanged. A linked active Employee is still required by the downstream Attendance authority service.

## Current database safety

This route-source checkpoint does not apply G06 migrations to Preview. The active automatic Preview database may still lack migrations:

- `202608240003_g06_security_site_qr_gps_v1`;
- `202608240004_g06_attendance_event_workflow_v1`.

Do not enable `ATTENDANCE_API_PREVIEW_ENABLED` for real route UAT until a separate guarded Preview migration gate proves those migrations are applied to the isolated Preview database and post-status is up to date.

## Explicit non-actions

This checkpoint does not:

- add AWS credentials;
- create IAM/Cognito resources;
- enable Face Verification PoC;
- call Face Liveness or CompareFaces;
- add frontend Attendance write UX;
- retain biometric/event photos;
- apply Preview migrations;
- change Vercel env;
- deploy/promote Production;
- mutate Production DB/data/auth/storage.

## Next gate

After source/tests/Preview build verification, the next consequential gate is guarded isolated Preview migration `003/004` plus temporary route visibility for authenticated Preview UAT. Biometric provider runtime may remain disabled during readiness/authority UAT. Enabling actual biometric runtime remains a separate Owner decision.


## Server-owned CHECK_IN / CHECK_OUT

Client-supplied `eventIntent` on readiness/start is rejected by the strict route schema. The backend chooses intent from the current authoritative shift/session/events. The event intent inside the later server-issued Attendance context remains digest-bound and cannot be substituted independently by the client.
