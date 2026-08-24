# G06 — Attendance Readiness / UX State Contract

Status: **INTERNAL CONTRACT ONLY / NO PUBLIC ROUTE / NO ATTENDANCE PAGE**

Owner decision remains: AWS/provider integration is paused. Biometric runtime remains closed.

## Purpose

This contract gives the future Attendance UI one stable, provider-neutral vocabulary for server-owned readiness and failure outcomes. It does not decide biometric PASS and does not create AttendanceEvent records.

The only authoritative Attendance success is a committed AttendanceEvent returned by the future governed event-write API. The readiness mapper therefore always returns `attendanceAccepted: false`, including `READY_TO_START_VERIFICATION`.

## Trust boundary

- Runtime enabled/disabled must come from server-owned configuration, never a client flag.
- Backend domain codes are mapped to public UX states; raw provider errors, stack traces, secrets, receipt values and QR tokens are never copied into the UX contract.
- `READY_TO_START_VERIFICATION` means only that verification may begin. It does not mean Face Verification passed and does not mean Attendance was recorded.
- `CAPTURE_INJECTION_RISK` and provider-session mismatch are non-retryable Security review states; no browser fallback is allowed.
- Unknown/unmapped failures are fail-closed as `ATTENDANCE_UNAVAILABLE`.
- The mapper must remain internal until the future Attendance API/page contract is separately reviewed.

## Stable states

| State | Blocking | Retryable | Primary action | Suggested Thai UX |
| --- | --- | --- | --- | --- |
| BIOMETRIC_RUNTIME_DISABLED | yes | no | WAIT_FOR_PROVIDER_ACTIVATION | ระบบยืนยันใบหน้ายังไม่เปิดใช้งาน กรุณารอการเปิดใช้งานจากผู้ดูแลระบบ |
| READY_TO_START_VERIFICATION | no | yes | START_VERIFICATION | พร้อมเริ่มขั้นตอนยืนยันตัวตนเพื่อการลงเวลา |
| ACCOUNT_NOT_ELIGIBLE | yes | no | CONTACT_ADMIN | บัญชีหรือสถานะพนักงานยังไม่พร้อมสำหรับการลงเวลา กรุณาติดต่อผู้ดูแลระบบ |
| DEVICE_SETUP_REQUIRED | yes | no | ENROLL_DEVICE | ต้องลงทะเบียนอุปกรณ์สำหรับลงเวลาก่อน |
| DEVICE_REVIEW_REQUIRED | yes | no | CONTACT_ADMIN | ข้อมูลอุปกรณ์ไม่สอดคล้อง กรุณาติดต่อผู้ดูแลระบบ |
| DEVICE_PROOF_RETRY | yes | yes | RESTART_DEVICE_PROOF | การยืนยันอุปกรณ์ไม่สำเร็จ กรุณาเริ่มยืนยันอุปกรณ์ใหม่ |
| REFERENCE_PHOTO_REQUIRED | yes | no | CONTACT_ADMIN | ยังไม่มีรูปอ้างอิงที่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ |
| REFERENCE_PHOTO_REVIEW_REQUIRED | yes | no | CONTACT_ADMIN | รูปอ้างอิงต้องได้รับการตรวจสอบก่อนใช้งาน |
| SCHEDULE_NOT_READY | yes | no | CONTACT_MANAGER | ตารางเวรยังไม่พร้อมหรือยังไม่ได้รับอนุมัติ กรุณาติดต่อผู้จัดการ |
| SITE_NOT_READY | yes | no | CONTACT_MANAGER | จุดปฏิบัติงานยังไม่พร้อมสำหรับการลงเวลา |
| QR_RESCAN_REQUIRED | yes | yes | SCAN_CURRENT_SITE_QR | QR จุดปฏิบัติงานไม่ถูกต้องหรือหมดอายุ กรุณาสแกน QR ปัจจุบันอีกครั้ง |
| LOCATION_REFRESH_REQUIRED | yes | yes | REFRESH_LOCATION | ไม่สามารถยืนยันตำแหน่งได้ กรุณาเปิดตำแหน่งและลองใหม่ |
| OUTSIDE_SITE_GEOFENCE | yes | yes | MOVE_INSIDE_ASSIGNED_SITE | คุณอยู่นอกพื้นที่ลงเวลาที่กำหนด กรุณาอยู่ภายในจุดปฏิบัติงาน |
| BIOMETRIC_TEMPORARILY_UNAVAILABLE | yes | yes | RETRY_LATER | ระบบยืนยันตัวตนไม่พร้อมชั่วคราว กรุณาลองใหม่ภายหลัง |
| VERIFICATION_EXPIRED | yes | yes | RESTART_VERIFICATION | ขั้นตอนยืนยันตัวตนหมดเวลา กรุณาเริ่มใหม่ |
| VERIFICATION_REPLAY_BLOCKED | yes | no | START_NEW_ATTENDANCE_ATTEMPT | รายการยืนยันนี้ถูกใช้แล้ว กรุณาเริ่มการลงเวลาใหม่ |
| CONTEXT_CHANGED_RESTART | yes | yes | RESTART_ATTENDANCE | ข้อมูลการลงเวลาเปลี่ยนระหว่างดำเนินการ กรุณาเริ่มใหม่ |
| LIVENESS_NOT_VERIFIED | yes | yes | RETRY_FACE_VERIFICATION | ไม่สามารถยืนยันว่าเป็นบุคคลจริงขณะนี้ได้ กรุณาลองใหม่ |
| FACE_NOT_MATCHED | yes | yes | RETRY_FACE_VERIFICATION | ใบหน้าไม่ตรงกับรูปอ้างอิง กรุณาลองใหม่ |
| SECURITY_REVIEW_REQUIRED | yes | no | CONTACT_ADMIN_OR_SECURITY | พบความเสี่ยงในการยืนยันตัวตน กรุณาติดต่อผู้ดูแลระบบหรือหน่วยงานความปลอดภัย |
| CHECK_IN_REQUIRED | yes | no | START_CHECK_IN | ต้องลงเวลาเข้าให้เรียบร้อยก่อนลงเวลาออก |
| ATTENDANCE_STATE_REFRESH_REQUIRED | yes | yes | REFRESH_ATTENDANCE_STATUS | สถานะการลงเวลาเปลี่ยนแปลง กรุณาโหลดสถานะล่าสุดแล้วลองใหม่ |
| ATTENDANCE_UNAVAILABLE | yes | no | CONTACT_SUPPORT | ไม่สามารถดำเนินการลงเวลาได้ กรุณาติดต่อผู้ดูแลระบบ |

## Domain mapping highlights

- Employee/account authority → `ACCOUNT_NOT_ELIGIBLE`.
- No ACTIVE Attendance device → `DEVICE_SETUP_REQUIRED`.
- Device authority conflict → `DEVICE_REVIEW_REQUIRED`.
- Missing/stale Reference Photo → Reference Photo setup/review states.
- Missing/invalid/unapproved Shift/Schedule → `SCHEDULE_NOT_READY`.
- Site authority failure → `SITE_NOT_READY`.
- QR lifecycle failure → `QR_RESCAN_REQUIRED`.
- GPS freshness/accuracy failure → `LOCATION_REFRESH_REQUIRED`; geofence failure has its own state.
- Provider unavailable → retryable `BIOMETRIC_TEMPORARILY_UNAVAILABLE`, never PASS.
- Receipt/session expiry → `VERIFICATION_EXPIRED`.
- Receipt/capture replay → `VERIFICATION_REPLAY_BLOCKED`.
- Employee/device/reference/schedule/site/context drift → `CONTEXT_CHANGED_RESTART`.
- PAD fail → `LIVENESS_NOT_VERIFIED`.
- 1:1 mismatch → `FACE_NOT_MATCHED`.
- Injection/provider-session integrity risk → `SECURITY_REVIEW_REQUIRED`.
- Unknown code → fail closed `ATTENDANCE_UNAVAILABLE`.

## Future UI/API integration rule

When a future Attendance page is implemented, it may render these states and actions but must not construct or override them from local biometric inference. A future event-write endpoint may only show an Attendance success UI after the server has committed the corresponding AttendanceEvent transaction.

No frontend/page/API route is introduced by this checkpoint.
