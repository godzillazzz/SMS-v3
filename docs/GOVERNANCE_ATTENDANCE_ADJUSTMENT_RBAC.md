# GOVERNANCE — Attendance Adjustment RBAC change (OWNER approved 17 Oct 2026)

**คำสั่ง OWNER (17 ต.ค. 2569):** "หัวหน้างานแก้เวลาไม่ได้ · พนักงานต้องยื่นยันเองผ่านสายบังคับบัญชา · จบที่ Admin เป็นผู้อนุมัติขั้นสุดท้าย"
**OWNER อนุมัติให้แก้ RBAC:** ใช่ (18 ต.ค. 2569 เวลา ~00:30 BKK)
**ขอบเขต:** เฉพาะ attendance adjustment (`src/routes/attendance-adjustment.routes.js` + `src/services/attendance-adjustment.service.js`) · **ไม่มี schema/migration change**
**ต้องผ่าน:** CI เขียว + SENTINEL review ก่อนปิดงาน

## สภาพปัจจุบัน (ตรวจจากซอร์ส 17 ต.ค.)

| จุด | โค้ดวันนี้ | ตรงคำสั่ง OWNER? |
|---|---|---|
| router-level | `authorize('ADMIN','MANAGER','SUPERVISOR')` | ❌ SUPERVISOR หลุดเข้ามาได้, EMPLOYEE เข้าไม่ได้ |
| maker (`assertMakerScope`) | ADMIN/MANAGER/SUPERVISOR (MANAGER/SUPERVISOR ผูก department) | ❌ |
| approve/reject/return (`assertAdmin`) | ADMIN เท่านั้น | ✅ |
| read (`list`/`get`) | ADMIN ทั้งหมด · MANAGER/SUPERVISOR ตาม department · อื่น 403 | ต้องขยายให้ EMPLOYEE อ่านของตัวเอง |

## เป้าหมายหลังแก้

| action | ADMIN | MANAGER | SUPERVISOR | EMPLOYEE | VIEWER |
|---|---|---|---|---|---|
| สร้างคำขอ (POST /) | ✅ | ✅ (แผนกตัวเอง) | ❌ 403 | ✅ **เฉพาะกะของตัวเอง** | ❌ 403 |
| แก้ไขคำขอ (PUT /:id) | ✅ | ✅ (แผนก) | ❌ 403 | ✅ เฉพาะของตัวเอง + สถานะ DRAFT | ❌ |
| ส่งคำขอ (POST /:id/submit) | ✅ | ✅ | ❌ 403 | ✅ เฉพาะของผู้สร้าง | ❌ |
| อนุมัติ/ส่งกลับ/ปฏิเสธ | ✅ | ❌ 403 | ❌ 403 | ❌ 403 | ❌ |
| อ่านรายการ (GET /) | ทั้งหมด | แผนก | แผนก (อ่านได้ คงเดิม) | **เฉพาะของตัวเอง** | ❌ 403 |

## การแก้ที่ต้องทำ (แม่นยำ)

1. **Route** — เลิกใช้ `authorize` ระดับ router; ใส่ authorize ต่อ route:
   - `GET /` และ `GET /:id` → `authorize('ADMIN','MANAGER','SUPERVISOR','EMPLOYEE')`
   - `POST /`, `PUT /:id`, `POST /:id/submit` → `authorize('ADMIN','MANAGER','EMPLOYEE')`
   - `POST /:id/approve|reject|return` → `authorize('ADMIN')` (คงเดิม)
   - ยังต้องมี `requireAttendanceApi` + `authenticate` ที่ router-level
2. **Service `assertMakerScope`**
   - รับ ADMIN/MANAGER/EMPLOYEE
   - **SUPERVISOR → 403** (`ATTENDANCE_ADJUSTMENT_FORBIDDEN`)
   - EMPLOYEE → อนุญาตเฉพาะเมื่อ `actor.employeeId` ตรงกับ `assignment.employeeId`; ไม่ตรง → 403 `ATTENDANCE_ADJUSTMENT_SCOPE_FORBIDDEN`
   - MANAGER → ผูก department เหมือนเดิม
3. **Service read scope (`list` / `get`)** — เพิ่ม EMPLOYEE: เห็นเฉพาะแถวที่ `employeeId = actor.employeeId`; SUPERVISOR คงเดิม (แผนก)
4. **Service `submit`** — ผู้ส่งต้องเป็น maker ของคำขอนั้น (ถ้ามีอยู่แล้วให้คงไว้และเพิ่มเทสต์ยืนยัน)
5. **Frontend** — ปุ่ม/ทางเข้า "ยืนยันการปฏิบัติงาน" แสดงเฉพาะ EMPLOYEE (กะของตัวเอง) และ ADMIN/MANAGER; **ซ่อนสำหรับ SUPERVISOR** · ไม่ต้องแตะหน้าาอื่น
6. **ห้าม:** เปลี่ยน `assertAdmin` · เปลี่ยน schema · แตะ Production · ลบ/ทำให้เทสต์เดิมอ่อนลง

## เทสต์ที่ต้องมี (backend เป็นหลัก — ห้ามใช้เทสต์ที่แต่งคำตอบเอง)

`test/attendance-adjustment-authz.route.test.js` (มีอยู่ — ขยาย):
- SUPERVISOR `POST /` → **403** (จากของเดิม 201)
- EMPLOYEE `POST /` กะของตัวเอง → **201** (positive control)
- EMPLOYEE `POST /` กะของคนอื่น → **403**
- EMPLOYEE `PUT`/`submit` ของตัวเอง → 2xx · ของคนอื่น → 403
- ADMIN approve → 200; MANAGER/SUPERVISOR/EMPLOYEE approve → 403
- VIEWER ทุก action → 403

เพิ่ม `test/attendance-adjustment.maker-scope.test.js` (service-level):
- EMPLOYEE ผูก assignment ของตัวเองได้ / ของคนอื่นไม่ได้
- MANAGER แผนกเดียวกันได้ / ต่างแผนกไม่ได้
- SUPERVISOR ไม่ได้ทุกกรณี

**Mutation proof (บังคับใน clone แยก `/tmp/mut-gov` — ห้าม commit):**
- ถอดเงื่อนไข SUPERVISOR ออกจาก `assertMakerScope` → เทสต์ SUPERVISOR 403 ต้องตก
- ถอดเงื่อนไข employee ownership → เทสต์ "กะของคนอื่น" ต้องตก
รายงานผลก่อน/หลังทั้ง 2 กรณี

## Acceptance
- เทสต์ทั้งหมดผ่าน · CI เขียว (validate + t22)
- SENTINEL review verdict = APPROVED ก่อนปิดงาน
- บันทึกผลลง `MASTER_HANDOFF.md` (สถานะ + commit + run id)
