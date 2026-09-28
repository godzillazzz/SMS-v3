# G06 Employee PWA / GPS-only Attendance — On-device UAT Runbook

Status: **physical-device GPS UAT in progress**
Date: 2026-09-28
Branch: `preview/enterprise-evolution-20260927`
Application commit under test: `375684da7867755bb0361638c550345e05c5cbb7`
Preview deployment: `dpl_E7XdpyXCEFTpVRCDFyUButyYaLqG`
Preview URL: `https://sms-v3-staging-a7cmrsrvn-godzillazz.vercel.app`

## Purpose

Prove the real employee Attendance path one authority layer at a time before resuming Face Verification:

`Account -> Approved Schedule -> Shift Assignment -> Security Site -> GPS/Geofence -> optional QR Step-up -> CHECK_IN/CHECK_OUT AttendanceEvent`

The current UAT deliberately bypasses Device Proof and Face Verification **only in Preview** so Site/GPS/Event behavior can be verified independently.

## Safety boundary

- Preview only. Do not run this GPS-only UAT against Production.
- `VITE_G06_GPS_ONLY_UAT=true` is a Preview build flag.
- GPS-only UAT events are real Preview AttendanceEvents with `provenance=GPS_ONLY_UAT`.
- GPS-only UAT events must have no `FaceVerificationSession` and must never be represented as Face-verified.
- Server remains authoritative for event intent, time, Schedule, Shift, expected/actual Site, GPS/geofence, optional QR, idempotency and CHECK_IN-before-CHECK_OUT.
- GPS is one-shot. No continuous/background location tracking.
- QR is step-up only. Strong server-validated GPS may continue in `GPS_ASSURED` mode without QR.
- No Production deploy, alias, migration, environment change or data mutation is part of this runbook.

## Reserved Preview fixture

Employee code: `UAT-G06-20260911-01`
Account: `uat-g06-20260911-01@example.invalid`
Role: `VIEWER`
Department: `UAT-PREVIEW`

The account must remain linked to the reserved active Employee. Do not create a substitute Employee to bypass account authority.

## 1. Admin preflight — required before employee test

Login to the Preview as an approved `ADMIN` account.

Open:

`Access Management -> G06 Preview UAT Fixture`

1. Tick the Preview-only confirmation.
2. Press `สร้าง G06 Preview UAT fixture`.
   - If the fixture already exists, the service must return the existing safe state idempotently.
   - It must not create a duplicate Employee/User or issue a new password for an existing fixture.
3. At the physical Site, press `เตรียม Attendance UAT จาก GPS ปัจจุบัน`.
4. Allow precise location when the browser requests it.

Expected:

- Browser takes one high-accuracy GPS sample only.
- GPS sample must be fresh and sufficiently accurate.
- Server selects only an **ACTIVE Security Site** for which the device is confidently inside the geofence.
- Current month ScheduleApproval must already be `APPROVED`; this action must not approve or revise the month.
- Active Shift `D` is used.
- Server creates only today's locked ShiftAssignment for the reserved fixture with explicit Site authority and source `G06_PREVIEW_UAT`.
- Repeating the exact preparation is idempotent.
- Existing non-G06 ShiftAssignment for the Employee/date is never overwritten.

Current known Preview facts from read-only diagnosis:

- Current-month ScheduleApproval: `APPROVED`, revision `2`.
- Active Day Shift `D`: `07:00-19:00`.
- The original blocker was no ShiftAssignment for the test date.

### STOP condition — Site authority

If Admin preparation reports that GPS is not confidently inside any Active Security Site, stop the employee Attendance test.

Correct action: fix Security Site coordinates/radius/activation. Do **not** widen/bypass the geofence merely to force a PASS.

## 1A. Read-only preflight before returning to Face

After the fixture exists, Admin may press `ตรวจความพร้อมก่อนเปิด Face` in the G06 Preview UAT Fixture card.

This calls the existing Employee onboarding-readiness endpoint only. It does not request Camera/GPS permission, create a verification session, call a face provider or create an AttendanceEvent.

Use it to surface server-authoritative blockers early:

- Account authority
- exactly one proven ACTIVE Attendance Device
- ACTIVE Reference Photo
- approved/current Schedule
- Security Site authority

Typical blockers include `ATTENDANCE_DEVICE_REQUIRED`, `REFERENCE_PHOTO_REQUIRED`, `SCHEDULE_REQUIRED`, `SCHEDULE_NOT_APPROVED` and Site-authority errors. Face Match / Active Challenge / provider runtime remain separate later gates even when this preflight says the authority prerequisites are READY.
## 2. Employee login and Attendance entry

Logout ADMIN and login with the reserved G06 VIEWER fixture.

Open `ลงเวลา`.

Expected before tapping:

- Server time is shown as the recording authority.
- Location can be acquired one-shot.
- Face and Device are visibly identified as bypassed for this Preview GPS-only UAT.
- UI must not claim Face verification success.

## 3. GPS-only CHECK_IN

Press `ลงเวลา GPS (UAT)` and allow precise location if asked.

Expected strong-GPS path:

1. Server resolves the authoritative current Shift Assignment.
2. Expected Site is taken from the Shift Assignment.
3. GPS freshness, accuracy and geofence are validated on the server.
4. If GPS evidence is strong enough, evidence mode becomes `GPS_ASSURED`; QR must not open merely because QR exists.
5. Server commits exactly one CHECK_IN AttendanceEvent with:
   - `provenance=GPS_ONLY_UAT`
   - server-received/effective time
   - no FaceVerificationSession
   - the authoritative AttendanceSession / Shift / expected Site / actual Site evidence
6. UI may show success only after the server returns `attendanceAccepted=true` for the committed event.
7. Employee self-service `today` state is refreshed after acceptance.

### QR Step-up path

QR should open only when the server returns `QR_STEP_UP_REQUIRED` or `QR_RESCAN_REQUIRED`.

Expected:

- Camera permission is requested only when QR step-up is required.
- Use the current governed Security Site QR.
- QR token is validated server-side by hash/version/revocation/site binding.
- Raw QR token is not logged or retained as Attendance evidence.
- Camera tracks stop after successful scan, close or failure.

A random URL or arbitrary 24-character string is **not** an acceptable governed Site QR for this event test.

## 4. CHECK_IN idempotency / refresh

After a successful CHECK_IN:

1. Refresh or reopen Attendance.
2. Confirm self-service state reflects the committed CHECK_IN.
3. The next authoritative intent must become `CHECK_OUT` for the same open AttendanceSession.
4. Retrying the same capture must return the committed event idempotently rather than creating a duplicate.

STOP/FAIL if the UI shows CHECK_IN again while the server already has an open session with committed CHECK_IN.

## 5. GPS-only CHECK_OUT

Press `ลงเวลา GPS (UAT)` again after the server state has moved to CHECK_OUT.

Expected:

- CHECK_OUT cannot be committed before CHECK_IN.
- Current Site/GPS authority is revalidated; stale prior GPS evidence is not trusted.
- Optional QR step-up follows the same server policy as CHECK_IN.
- Server commits one CHECK_OUT Event with `GPS_ONLY_UAT` provenance.
- The same AttendanceSession closes.
- Employee self-service state/history reflects both events after refresh.

## 6. Negative geofence test

Perform at least one negative test using a location outside the assigned Site geofence, or another safely controlled invalid Site-evidence scenario.

Expected:

- No AttendanceEvent is created.
- UI shows a server-derived blocking reason such as `OUTSIDE_SITE_GEOFENCE`, `LOCATION_REFRESH_REQUIRED`, `SITE_NOT_READY` or an equivalent mapped state.
- No local override can turn the blocked attempt into PASS.

## 7. Offline / interrupted request behavior

After the shell has loaded:

1. Disconnect network.
2. Attempt Attendance.

Expected:

- Attendance mutation is blocked while offline.
- No synthetic success or offline-pending AttendanceEvent is shown.
- Restoring network allows a new server-authoritative attempt.
- If the client loses the response after the server commits an event, refresh/idempotent recovery must prefer the committed server state rather than creating a second event.

## 8. Privacy / retention checks

During this GPS-only UAT:

- no continuous GPS tracking
- no background GPS tracking
- no Face/Active Challenge capture is required
- no live/challenge biometric frame is retained because Face flow is bypassed
- QR camera frames are transient only
- raw QR token is not persisted
- UAT evidence shared in chat/screenshots should avoid exact coordinates, passwords, tokens, receipts and unnecessary personal data

## 9. Stop conditions

Stop and report the exact message/screenshot if any of these occur:

- `ACCOUNT_NOT_ELIGIBLE`
- `SCHEDULE_NOT_READY`
- `SITE_NOT_READY`
- `LOCATION_REFRESH_REQUIRED`
- `OUTSIDE_SITE_GEOFENCE`
- unexpected QR request when server evidence is clearly `GPS_ASSURED`
- CHECK_OUT offered before a committed CHECK_IN
- duplicate AttendanceEvents from one capture/retry
- GPS-only UAT event contains a FaceVerificationSession
- UI claims Face PASS during GPS-only UAT
- Production is modified as part of the test

Do not work around a stop condition by weakening Schedule/Site/GPS/QR authority. Fix the failing layer and rerun from that layer.

## 10. Evidence to send back

For each physical step, send only what is needed:

1. screenshot of the result/blocker
2. broad device/OS description, e.g. `iPhone / iOS`
3. whether precise location was allowed
4. whether QR opened automatically
5. whether this was the first event (CHECK_IN) or second event (CHECK_OUT)

Avoid sending passwords, exact GPS coordinates, QR token content, auth tokens, biometric frames or internal receipts.

## Exit criteria for GPS-only phase

GPS-only Attendance phase is accepted only after physical evidence proves:

- Admin fixture preparation at the real Site succeeds
- CHECK_IN commits on-device
- refresh/self-service reflects CHECK_IN
- next server intent becomes CHECK_OUT
- CHECK_OUT commits and closes the same session
- negative geofence evidence is rejected
- QR is requested only when server policy requires step-up
- no Face/Device success is falsely claimed

After these pass, resume G06 Face debugging in this order:

`Device Proof -> Face Match -> Simple Active Challenge -> final combined Attendance UAT`
