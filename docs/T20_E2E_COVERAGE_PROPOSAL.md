# T20 — E2E coverage scope (ข้อเสนอเพื่ออนุมัติ)

**สถานะ:** PROPOSAL — สำรวจจริง 17 ต.ค. 2569 · **ยังไม่ได้รับอนุมัติให้ implement** (T20 = proposal, ไม่ใช่ฟีเจอร์)
**ที่มา:** Issue #647 · ข้อกำหนดเดิม: เลือก role/fixture coverage ให้ชัดก่อนเขียนเทสต์ ห้าม reset บัญชี/ห้ามเขียนข้อมูล hosted ที่ไม่ปลอดภัย

## 1. สิ่งที่มีอยู่จริงวันนี้ (inspected)

**19 spec / 32 เทสต์** ใน `frontend/e2e/**`:

| กลุ่ม | spec | เทสต์ | role ที่อ้างถึง |
|---|---|---|---|
| Routing | `routing/t09-routing.pw.ts` | 4 | ADMIN, VIEWER |
| Approvals | `approvals/dual-entry.pw.ts` · `approvals/approval-badges.pw.ts` | 3 · 7 | ADMIN/MANAGER/SUPERVISOR/VIEWER |
| Roster | `roster/t11-roster.pw.ts` · `roster/shift-editor.pw.ts` · `roster-layout/roster-layout.pw.ts` | 0 · 0 · 0 | ADMIN, MANAGER |
| Leave | `leave/t13-leave-request.pw.ts` | 2 | MANAGER, VIEWER |
| Settings | `settings/t12-settings.pw.ts` | 2 | ADMIN |
| Personnel | `personnel/readiness.pw.ts` · `personnel/t14-onboarding.pw.ts` · `personnel-layout/personnel-layout.pw.ts` | 2 · 0 · 0 | ADMIN |
| Attendance | `attendance-layout/attendance-layout.pw.ts` | 0 | ADMIN |
| Print | `print/t29-printing.pw.ts` · `print/t31-timesheet.pw.ts` | 4 · 2 | — |
| Branding/Loading/Layout | `branding/brand-logo.pw.ts` (T33) · `loading/loading.pw.ts` (T32) · `layout/layout-foundation.pw.ts` (T30a) | 1 · 1 · 1 | ADMIN, VIEWER |
| Accessibility | `accessibility/t17-accessibility.pw.ts` | 2 | ADMIN |
| Release acceptance | `r71-validation/r71-browser-acceptance.pw.ts` | 1 (parameterized 4 roles) | ADMIN/MANAGER/SUPERVISOR/VIEWER |

**ข้อสังเกตสำคัญ:** 5 spec มี **0 เทสต์ที่ตรวจพบด้วย pattern ปัจจุบัน** (`t11-roster`, `shift-editor`, `t14-onboarding`, `attendance-layout`, `personnel-layout`, `roster-layout`) ⇒ ต้องยืนยันว่าเป็น Page-Object/step-based จริง หรือเป็นซากที่ไม่มี assertion (จะกลายเป็น "เกตหลอก")

## 2. ช่องว่างที่เสนอให้ปิด (ลำดับความสำคัญ)

| ลำดับ | ช่องว่าง | ทำไมสำคัญ | ข้อเสนอ |
|---|---|---|---|
| P1 | **Attendance adjustment governance** (คำสั่ง OWNER 17 ต.ค.: หัวหน้างานแก้เวลาไม่ได้ · พนักงานยื่นยันเอง · Admin อนุมัติขั้นสุดท้าย) | เป็นกฎธุรกิจใหม่ที่ยังไม่มีเทสต์เลย | spec ใหม่: SUPERVISOR ถูกบล็อก (403) · employee self-submit ผ่านสายบังคับบัญชา · ADMIN อนุมัติได้ · negative control ทุกข้อ |
| P1 | **ปุ่มพิมพ์ใบลงเวลาจาก `/app/employees`** (เพิ่งทำเสร็จ) | งานใหม่ที่ยังไม่มี E2E | spec: เปิดโปรไฟล์พนักงาน → กด 🖨️ → ตรวจใบ A4 (1 หน้า, มีชื่อ/เดือน/31 วัน) + negative (ไม่มีข้อมูล → ไม่ crash) |
| P2 | **Approval details 9 ประเภท** (ปุ่ม "ดูรายละเอียด") | ปิดด้วย unit/HTTP แล้ว แต่ยังไม่มี E2E ครบ 9 ประเภท | spec: เปิด detail ทีละประเภท ตรวจว่ามีข้อมูลจริง (ไม่ใช่ zero envelope) + View-As ได้ zero envelope |
| P2 | **Role matrix ครบ 4 บทบาทต่อหน้า** | ปัจจุบัน r71 parameterize แล้ว แต่หน้าอื่นใช้ role เดียว | parameterize: sidebar/menu visibility + badge count ต่อ role |
| P3 | **Offline/GPS/PWA (G06.1)** | ยังไม่เริ่ม (Phase 0) | **ไม่ทำในรอบนี้** — ต้องมี threat model + physical device ก่อน |

## 3. ขอบเขตที่เสนอ (scope gate)

- **ในรอบนี้:** P1 จำนวน 2 spec + P2 จำนวน 2 spec รวม **≈ 4 spec ใหม่ / ~20 เทสต์** ใช้ fixture อ่านอย่างเดียว (read-only) หรือข้อมูลสังเคราะห์ที่ลบใน `finally`
- **ไม่ทำ:** การ reset บัญชี · การเขียนข้อมูลจริงบน hosted · การสร้างบัญชีใหม่ · offline/GPS
- **ต้องมีก่อนเริ่ม:** OWNER อนุมัติ scope นี้ + ยืนยันว่าจะใช้บัญชีเดิม 4 บทบาท (ห้ามสร้างใหม่ตาม Issue #640)

## 4. เกณฑ์ปิด T20

- CI job `e2e` รัน 4 spec ใหม่ได้แบบ hermetic (ไม่พึ่ง Production)
- แต่ละเทสต์มี **positive control** (actor ที่ควรได้ 2xx ต้องได้ 2xx) ไม่ใช่ตรวจแค่ว่า "ไม่พบปุ่ม"
- Mutation check: ถอด guard/สิทธิ์ออกแล้วเทสต์ต้องตก (พิสูจน์ว่าเกตจริง)
- SENTINEL review + CI เขียว
