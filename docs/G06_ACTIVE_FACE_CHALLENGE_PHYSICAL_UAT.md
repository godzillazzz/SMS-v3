# G06 Active Face Challenge — Physical Preview UAT

## Purpose

This UAT validates only the physical front-camera and Active Challenge capture lifecycle on a real device. It does **not** validate a trusted face match, does **not** validate certified Liveness/PAD, does **not** issue a verification receipt, and does **not** create an AttendanceEvent.

The UAT surface is Preview-only and independently gated from the normal Attendance runtime. Production is always disabled.

## Expected Preview safety state

The UAT card may be visible only when both Preview-only UAT gates are enabled for the approved G06 branch build/runtime.

Normal Attendance and real face-verifier routes must remain closed:

- normal Attendance readiness remains HTTP 404 while `ATTENDANCE_API_PREVIEW_ENABLED` is not enabled;
- trusted self-hosted Face runtime remains HTTP 404 while its runtime configuration is not enabled;
- the UAT capture response always reports `verifierCalled=false`, `verificationAccepted=false`, `attendanceAccepted=false`, `receipt=null`, `retained=false`.

## Physical test

1. Open the installed SMS PWA from the stable G06 Preview branch origin.
2. Open `ลงเวลา`.
3. Find the card `ทดสอบกล้องหน้า + Active Challenge` marked `PREVIEW UAT · NO FACE PASS · NO ATTENDANCE WRITE`.
4. Tap `เริ่มทดสอบ Active Challenge`.
5. Confirm that the front camera opens and the instruction says one of:
   - หันหน้าไปทางซ้าย
   - หันหน้าไปทางขวา
   - เงยหน้าขึ้นเล็กน้อย
   - ก้มหน้าลงเล็กน้อย
6. Tap `เริ่ม Active Challenge` and perform the displayed movement, then return to looking straight at the camera.
7. Confirm the UI collects four transient frames and then shows the final still preview.
8. Test `ทำ Challenge ใหม่` once and confirm the camera can be reopened safely.
9. Complete the sequence again and tap `ส่งชุดภาพ UAT และทิ้งทันที`.
10. Expected result: the page states that the Server received the temporary capture and discarded it, with no Face Verifier call, no receipt, and no AttendanceEvent.

## Lifecycle/privacy negative checks

Run these separately; a lifecycle exit intentionally invalidates the current attempt.

- While the front camera is open, switch to another app and return. The camera/temporary capture must be cleared and the UAT attempt must require a fresh start.
- While the front camera is open, lock/unlock the phone. The camera/temporary capture must be cleared and the UAT attempt must require a fresh start.
- Close the camera overlay. The camera privacy indicator must disappear after the media tracks are stopped.
- No Gallery/file picker should be available.

## PASS boundary

Physical UAT may be marked PASS only for the observed camera/challenge lifecycle that was actually tested.

Do **not** infer any of the following from this rehearsal:

- face identity match accuracy;
- printed-photo/screen/video spoof detection effectiveness;
- certified Liveness/PAD performance;
- Attendance CHECK_IN/CHECK_OUT acceptance;
- receipt issuance;
- Production readiness.

Those remain separate gates. The trusted self-hosted verifier must later be tested independently before real Attendance biometric acceptance can be enabled.
