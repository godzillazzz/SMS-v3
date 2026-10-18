# GOVERNANCE — Attendance Adjustment authority (ฉบับ OWNER 18 ต.ค. 2569)

> **ฉบับนี้แทนที่ฉบับ 17 ต.ค. 2569 ทั้งหมด** (OWNER ปรับนโยบาย: หัวหน้างานคีย์ยืนยันให้ลูกน้องได้)

**คำสั่ง OWNER (18 ต.ค. 2569):**
1. **หัวหน้างาน (SUPERVISOR) ผู้จัดการ (MANAGER) และ ADMIN เป็นผู้บริหารของทุกแผนก** → ไม่จำกัดแผนก
2. **หัวหน้างานคีย์ยืนยันการมาปฏิบัติงานให้ลูกน้องได้**
3. **หัวหน้างานและผู้จัดการคีย์ย้อนหลังได้ไม่เกิน 3 วัน**
4. **ADMIN ไม่จำกัดเวลา**
5. **การอนุมัติขั้นสุดท้ายจบที่ ADMIN เท่านั้น**
6. พนักงาน (role `VIEWER` ที่ผูก employee) ยื่นยันของตัวเองได้ — เลือกทาง **A** (ไม่เพิ่ม role/migration)

## ตารางสิทธิ์ (เป้าหมาย)

| action | ADMIN | MANAGER | SUPERVISOR | VIEWER + ผูก employee | VIEWER ไม่ผูก employee |
|---|---|---|---|---|---|
| สร้าง/แก้/ส่ง คำขอ (`CONFIRM_WORK_PERFORMED`, `ADJUST_WORK_TIME`) | ✅ ไม่จำกัดเวลา/แผนก | ✅ **ย้อนหลัง ≤ 3 วัน** / ทุกแผนก | ✅ **ย้อนหลัง ≤ 3 วัน** / ทุกแผนก | ✅ **เฉพาะกะตัวเอง** (≤ 3 วัน)* | ❌ 403 |
| ตรวจ/ส่งต่อขั้นถัดไป | ✅ (ทุกขั้น) | ✅ เฉพาะขั้นผู้จัดการ | ✅ เฉพาะขั้นหัวหน้างาน | ❌ |
| ส่งกลับแก้ไข | ✅ ทุกขั้น | ✅ ขั้นตัวเอง | ✅ ขั้นตัวเอง | ❌ |
| อนุมัติ / ปฏิเสธ (ขั้นสุดท้าย) | ✅ | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 |
| อ่านรายการ / ดูรายละเอียด | ทุกแผนก | ทุกแผนก | ทุกแผนก | เฉพาะของตัวเอง | ❌ 403 |

\* **สมมติฐานที่ต้องยืนยัน:** พนักงานยื่นของตัวเองได้ภายใน 7 วันเช่นกัน (ถ้าต้องการไม่จำกัด แจ้งได้ — แก้ที่ค่าคงที่จุดเดียว)

## การแก้ที่ต้องทำ

1. **Role model (ทาง A — ไม่มี migration)**
   - "employee maker" = role `VIEWER` ที่มี `employeeAuthority.id` (จาก `authenticate`) — **ไม่ใช่ `EMPLOYEE`** (role นี้ไม่มีในระบบ; `UserRole` = ADMIN/MANAGER/SUPERVISOR/VIEWER)
   - `VIEWER` ที่ไม่มี employee → 403 ทุก action
2. **Route** (`src/routes/attendance-adjustment.routes.js`)
   - `GET /`, `GET /:id` → `authorize('ADMIN','MANAGER','SUPERVISOR','VIEWER')`
   - `POST /`, `PUT /:id`, `POST /:id/submit` → `authorize('ADMIN','MANAGER','SUPERVISOR','VIEWER')`
   - `POST /:id/approve|reject|return` → `authorize('ADMIN')`
   - **ห้าม** ใช้ authorize ระดับ router ที่กลืน per-route
3. **Approval chain (OWNER 18 ต.ค. 2569)** — พนักงานคีย์ → หัวหน้างาน (คนใดก็ได้) → ผู้จัดการ (คนใดก็ได้) → **ADMIN อนุมัติขั้นสุดท้าย**
   - สถานะ: `PENDING_SUPERVISOR` → `PENDING_MANAGER` → `PENDING_ADMIN` → `APPROVED`
   - ผู้คีย์เป็น SUPERVISOR → เริ่มที่ `PENDING_MANAGER` (ข้ามขั้นตัวเอง) · ผู้คีย์เป็น MANAGER/ADMIN → เริ่มที่ `PENDING_ADMIN`
   - ทุกขั้น **ส่งกลับแก้ไขได้** (เฉพาะ reviewer ของขั้นนั้น หรือ ADMIN) · **ปฏิเสธได้เฉพาะ ADMIN**
   - ทุกก้าวบันทึก event `REVIEWED` (ผู้ทำ + บทบาท + เวลา) เพื่อ audit
   - Migration: `202610180002_attendance_adjustment_multilevel_approval` (ขยาย CHECK ของ status + event_type)
4. **Service — maker authority** (`assertMakerScope`)
   - ADMIN: ผ่านเสมอ (ไม่จำกัดแผนก/เวลา)
   - MANAGER / SUPERVISOR: ผ่านทุกแผนก แต่ **`assignment.workDate` ต้องไม่เก่ากว่า 7 วัน** (เทียบวันตาม Asia/Bangkok กับ `clock()`); เกิน → 403 `ATTENDANCE_ADJUSTMENT_BACKDATE_FORBIDDEN`
   - VIEWER+employee: ผ่านเฉพาะ `assignment.employeeId === actor.employeeAuthority.id` และภายใน 7 วัน
   - **ลบการผูก department ออกจากการตัดสินสิทธิ์** (ปิดช่อง GOV-RBAC-003 — ไม่ต้องพึ่ง `actor.department` ที่ไม่มีใน `req.user`)
4. **Service — read scope** (แยกฟังก์ชันจาก maker scope — **ห้ามเรียก `assertMakerScope`**)
   - ADMIN/MANAGER/SUPERVISOR: อ่านได้ทุกแผนก (list ไม่กรอง department; get ได้ทุก id)
   - VIEWER+employee: เฉพาะแถวที่ `employeeId` ของตัวเอง (ทั้ง list และ get) — ต้องมีเทสต์กันข้อมูลรั่ว
5. **Submit**: ผู้ส่งต้องเป็น maker ของคำขอนั้น (`makerUserId`) ไม่งั้น 403 `ATTENDANCE_ADJUSTMENT_NOT_MAKER`
6. **Frontend**: คอนโทรลสำหรับ SUPERVISOR แสดงได้ (คีย์ให้ลูกน้อง) · VIEWER ที่ผูก employee เห็นปุ่มของตัวเอง · ปรับเทสต์ `frontend/src/attendance-supervisor-wave4c-authority.test.ts` ให้ตรงนโยบายใหม่

## เทสต์ที่ต้องมี (ยิง implementation จริง — ห้าม mock service)

1. `test/attendance-adjustment-authz.route.test.js` (ยิง router + service จริง, mock เฉพาะ prisma/auth):
   - ADMIN create ที่ workDate 30 วันก่อน → 2xx
   - MANAGER create 3 วันก่อน → 2xx · 10 วันก่อน → 403 (backdate)
   - SUPERVISOR create 3 วันก่อน (ลูกน้องแผนกอื่นก็ได้) → 2xx · 10 วันก่อน → 403
   - VIEWER+employee create กะตัวเอง → 2xx · กะคนอื่น → 403
   - VIEWER ไม่มี employee → 403
   - approve: ADMIN 2xx · MANAGER/SUPERVISOR/VIEWER → 403
2. `test/attendance-adjustment.read-scope.test.js`:
   - VIEWER เห็นเฉพาะของตัวเอง (list + get ของคนอื่น → 403/ไม่พบ)
   - SUPERVISOR/MANAGER อ่านได้ทุกแผนก
3. `test/attendance-adjustment.maker-ownership.test.js`:
   - submit โดยไม่ใช่ maker → 403 `ATTENDANCE_ADJUSTMENT_NOT_MAKER`
4. **Mutation proof (clone แยก `/tmp/mut-gov2` — ห้าม commit)** ต้องพิสูจน์ 4 แบบ:
   a) ถอด backdate check → เทสต์ 10 วันต้องตก
   b) ถอด VIEWER employee ownership → เทสต์กะคนอื่นต้องตก
   c) ถอด read-scope ของ VIEWER → เทสต์อ่านของคนอื่นต้องตก
   d) ถอด makerUserId check → เทสต์ submit ownership ต้องตก

## Acceptance
- เทสต์ทั้งหมดผ่าน · CI เขียว (validate + t22) บน SHA เดียว · SENTINEL APPROVED
- ไม่มี schema/migration change · ไม่แตะ Production
