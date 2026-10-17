# T19 — Dashboard metric → destination → API mapping (ข้อเสนอเพื่ออนุมัติ)

**สถานะ:** PROPOSAL — ตรวจจากซอร์สจริง 17 ต.ค. 2569 (`frontend/src/pages/dashboard/*`, `frontend/src/components/dashboard/deep-links.ts`, `src/routes/operations.routes.js`) · ยังไม่ใช่ "อนุมัติแล้ว"
**ที่มา:** T19 เดิม = "Metric/action → destination → exact API query/filter mapping" · PR #530 ปิดโดยไม่ merge

## 1. กลไกที่มีอยู่จริงในโค้ดวันนี้

- การ์ดแดชบอร์ดทุกใบกดได้ และพาไปหน้า `dashboardDetails` พร้อม query ที่สร้างจาก `dashboardDetailQuery(metric, filters, role, selector)`
- Query ที่สร้างเสมอ: `metric`, `date`, `month`, `page=1`, `pageSize=20` + `department` **เฉพาะเมื่อ role = ADMIN** + selector ของการ์ดนั้น
- Backend: `GET /api/v1/dashboard` (สรุป) และ `GET /api/v1/dashboard/details` (รายละเอียด) · ทั้งคู่ใช้ `authenticate` + scope ตาม `requestUser` (role/employeeId/department) · details ตั้ง `Cache-Control: no-store` · query ผิดรูป → **400** `Dashboard detail filter is invalid.`

## 2. Metric ที่ backend รองรับ (zod enum — ตัวจริง)

`activeEmployees`, `totalEmployees`, `schedule`, `leaveToday`, `pendingLeaves`, `leaveMonth`, `leaveMonthStatus`, `licenseStatus`, `licenseExpiry`, `pendingUsers`, `unmatchedQuota`

## 3. ตัวกรองที่ backend รับ + เงื่อนไขบังคับ (superRefine)

| ตัวกรอง | ค่าที่รับ | บังคับเมื่อ |
|---|---|---|
| `date` | วันที่ | — |
| `month` | เดือน | — |
| `department` | ≤100 ตัวอักษร | — (FE ส่งเฉพาะ ADMIN) |
| `status` | PENDING · APPROVED · REJECTED · CANCELLED · RETURNED_FOR_CORRECTION · EXPIRED · SUPERSEDED | **`licenseStatus` ต้องมี** · **`leaveMonthStatus` ต้องเป็น PENDING/APPROVED/REJECTED/CANCELLED** |
| `expiryBucket` | EXPIRED · EXPIRING_0_30 · EXPIRING_31_90 · VALID · PENDING_REVIEW | **`licenseExpiry` ต้องมี** |
| `workforce` | SCHEDULED · ON_DUTY · NO_SHIFT | — |
| `shiftTypeCode` / `shiftTypeName` | ≤40 / ≤100 | — |
| `licenseId` | UUID | — |
| `page` / `pageSize` | 1–100000 / 1–100 (default 20) | — |

## 4. ตาราง mapping ที่มีอยู่จริง (การ์ด 4 ใบที่ต่อสายแล้ว)

| การ์ด (UI) | metric | destination | selector ที่ส่ง | endpoint |
|---|---|---|---|---|
| พนักงานปฏิบัติงาน | `activeEmployees` | `dashboardDetails` | — | `GET /api/v1/dashboard/details` |
| ทำงานวันนี้ | `schedule` | `dashboardDetails` | `workforce=ON_DUTY` | เดียวกัน |
| ลาวันนี้ | `leaveToday` | `dashboardDetails` | — | เดียวกัน |
| ใบอนุญาตใกล้หมดอายุ | `licenseExpiry` | `dashboardDetails` | `expiryBucket=EXPIRING_0_30` | เดียวกัน |
| ปุ่ม "ดูตารางกะ" | `schedule` | `schedule` (หน้า roster) | — | — |

## 5. ช่องว่างที่ต้องให้ OWNER ตัดสิน (จึงจะปิด T19 ได้)

1. **การ์ดอีก 7 metric ที่ backend รองรับแต่ยังไม่มีปุ่มบนแดชบอร์ด**: `totalEmployees`, `pendingLeaves`, `leaveMonth`, `leaveMonthStatus`, `licenseStatus`, `pendingUsers`, `unmatchedQuota` — ต้องการให้เพิ่มการ์ด/ลิงก์ทั้งหมดหรือไม่ หรือคงไว้เป็น API-only
2. **ค่าเริ่มต้นของตัวกรอง**: `date`/`month` เริ่มที่ "วันนี้/เดือนนี้" หรือให้ผู้ใช้เลือก (ตอนนี้ขึ้นกับ `filters` ของหน้า)
3. **`pageSize`**: กำหนด 20 คงที่ หรือให้ผู้ใช้เลือก (25/50/100)
4. **สิทธิ์การเห็นการ์ด**: การ์ดใดควรเห็นเฉพาะ ADMIN/MANAGER/SUPERVISOR/VIEWER (ตอนนี้ backend scope ตาม role แต่ FE ยังแสดงทุกใบตาม response)
5. **การพิมพ์/ส่งออกจากหน้ารายละเอียด** (ถ้าต้องการ) — ยังไม่มีในโค้ด

## 6. เกณฑ์ปิด T19 (เมื่อ OWNER อนุมัติข้อ 5)

- ทุก metric ที่อนุมัติว่า "ต้องมี" มีการ์ด + ลิงก์ + query ตรงตามตารางข้อ 4
- เทสต์: unit ของ `dashboardDetailQuery` ต่อ metric/role + HTTP test ของ `/dashboard/details` (ค่า default, 400 เมื่อขาดตัวกรองบังคับ, scope ตาม role)
- E2E: เปิดการ์ดแต่ละใบ → หน้ารายละเอียดแสดงข้อมูลชุดเดียวกับตัวเลขบนการ์ด (positive control)
- CI เขียว + SENTINEL review
