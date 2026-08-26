# G06 Attendance Frontend UX Skeleton

Status: source/test checkpoint only. AWS/provider integration remains paused. Production remains unchanged.

## Purpose

Provide a mobile-first Attendance page that can collect transient Site QR + one-shot GPS evidence and ask the existing server-owned Attendance readiness contract what the next Attendance action is, without opening biometric execution or allowing the browser to record Attendance by itself.

## Authority boundary

- The browser does not choose `CHECK_IN` or `CHECK_OUT`.
- `/api/v1/attendance/readiness` receives only `captureId` + raw QR/GPS evidence.
- The server returns the authoritative `eventIntent` presentation value.
- The frontend may render readiness states, but every readiness state remains non-authoritative for Attendance acceptance.
- This checkpoint does not call `/api/v1/attendance/verification/start`.
- This checkpoint does not call `/api/v1/attendance/events`.
- The frontend does not handle a verification receipt, PAD result, face-match result, provider score, or client biometric PASS.
- Only a later server-committed `AttendanceEvent` may represent accepted Attendance.

## UX flow

1. Employee opens **ลงเวลา**.
2. QR evidence is kept only in React memory for the current attempt. It is not persisted to Local Storage or Session Storage.
3. GPS uses one-shot `navigator.geolocation.getCurrentPosition` with high accuracy, `maximumAge=0`, and a bounded timeout. There is no `watchPosition` or continuous tracking.
4. Employee selects **ตรวจสอบความพร้อม**.
5. The frontend creates a fresh UUID `captureId` and posts raw evidence to readiness.
6. If the server route is hidden (HTTP 404), the page explicitly reports that Attendance is not enabled in that environment. No biometric work or Attendance event is started.
7. If the server returns a blocking readiness state, the page presents the server remediation state and stays fail-closed.
8. If the server returns `READY_TO_START_VERIFICATION`, the page only states that server authority is ready for the next trusted verification step. Face/Liveness execution remains disabled in this checkpoint.

## View As

`View As` is read-only. The page does not allow QR/GPS evidence submission while impersonating another user.

## Device remediation

When the server returns `DEVICE_SETUP_REQUIRED`, the UI may navigate the user to the existing **อุปกรณ์ลงเวลา** page. This does not change Personal Device authority or approval rules.

## Current non-goals

- No AWS credential/IAM/Cognito work.
- No provider runtime activation.
- No Face/Liveness browser integration.
- No QR camera scanner implementation yet; this skeleton accepts transient QR data for readiness wiring only.
- No Attendance event write from the frontend.
- No offline Attendance PASS.
- No schema or migration change.
- No Production deploy/env/data change.

## Verification gates

- G06 frontend focused: 14/14 PASS.
- Frontend full suite: 400/400 PASS.
- Frontend TypeScript/Vite build: PASS.
- Backend Attendance/trust focused: 57/57 PASS.
- Full backend on disposable PostgreSQL: 681/681 PASS.
- Prisma migration status on fresh disposable PostgreSQL: 26 migrations, schema up to date.
