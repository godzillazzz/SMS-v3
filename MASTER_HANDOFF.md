# MASTER HANDOFF

อัปเดต 6 ตุลาคม 2569 (เวลาไทย)

## สถานะงาน

- Integration base หลัง Phase B: `fix/serverless-database-reliability` @ `3ed0585567091e88135bdbc3f7087a589c30e7d4`.
- เฟส A: เสร็จ; เฟส B: merge #470 → #471 → #472 → #473 เข้า integration branch สำเร็จตามลำดับ.
- เฟส C: T05 ผ่าน CI และ Preview Ready แล้ว; T01 กำลังดำเนินการบน branch แยกจาก base SHA ข้างต้น. ยังไม่ merge PR ของ Phase C.
- Vercel project `sms-v3-staging` แสดง deployment ของ merge SHA ล่าสุดว่า completed: https://vercel.com/godzillazz/sms-v3-staging/4XYyB1Quoqw4ivM5P2X41vc8aAU2. การตรวจ alias `/api/v1/health` และ `/api/v1/ready` ถูก outbound proxy ปฏิเสธด้วย HTTP 403 CONNECT ก่อนถึง Vercel จึงยืนยัน runtime health/provenance ผ่าน alias ไม่ได้ (UNKNOWN).
- ไม่ได้ deploy Production, promote, แตะ Environment approval หรือเขียนข้อมูลลงฐานข้อมูล staging/Production.

## เฟส A+B — สถานะ PR

| PR | SHA ก่อน rebase → หลัง rebase | CI ของ SHA หลัง rebase | Merge | Preview | Acceptance |
|---|---|---|---|---|---|
| #470 | `26eeee832ea3e9cd0e6b0c171b46cd0680b9ac03` → `26eeee832ea3e9cd0e6b0c171b46cd0680b9ac03` (rebase no-op) | run `37457419185` success; Vercel Ready | merged `adb94c9135dbac9e0b94e3461869f7a7e8b20c10` | https://sms-v3-staging-git-fix-schedule-approval-stat-155f07-godzillazz.vercel.app | ผ่าน: ครบ 12 `changeType` labels พร้อม test; ปุ่มไม่อนุมัติ disabled จนเหตุผลหลัง trim ยาว ≥5 พร้อม test. Frontend 828/828 และ build ผ่าน. |
| #471 | `739bb43590a89dbc696e4973d07bbbf90cc9ae6c` → `667666afc742df80aca1dac13dba666f47e240b4` | run `37457947822` success; Vercel Ready | merged `da6b44d302abee0ff1dc5575164da03b966ea2ac` | https://sms-v3-staging-git-fix-schedule-department-ro-7ffe45-godzillazz.vercel.app | ผ่าน: department group-row CSS ธีมสว่าง/มืด/print และ sticky; fixture ที่ 1366×768/375×812 ไม่มี overflow. `AN1,AN2,AN3` ยังเป็นค่าเดียวพร้อม test. |
| #472 | `06adee290b2fe2be4a359fdab2772a92d574f278` → `923447d7c7da6661463c64c2195dae01ad374cda` | run `37458878815` success; Vercel Ready | merged `5a0fbe299bedd165a580995dc326b54e946aaaa3` | https://sms-v3-staging-git-fix-schedule-auto-preview-108969-godzillazz.vercel.app | ผ่าน: คงพฤติกรรมจัดกลุ่ม/print จาก #471 และ auto-schedule preview; frontend 833/833, backend focused 18/18, build ผ่าน. |
| #473 | `2282dda340bef35ec830a46e53be5f7bd09a3a80` → `d8c8ad0706c5d7feb9b038c6dde8204f622c1235` | run `37459833957` success; Vercel Ready | merged `3ed0585567091e88135bdbc3f7087a589c30e7d4` | https://sms-v3-staging-git-fix-schedule-batch-save-10-c701ee-godzillazz.vercel.app | ผ่าน gates ของ batch save: frontend 835/835, build และ browser fixture ที่ 1366×768/375×812. Preview จริงเข้าจาก network นี้ไม่ได้. |

## ตรวจ deployment หลัง Phase B

- Vercel project `sms-v3-staging` แสดง deployment ของ merge SHA `3ed0585567091e88135bdbc3f7087a589c30e7d4` ว่า completed ตาม dashboard ด้านบน.
- การตรวจ `sms-v3-staging-ten.vercel.app/api/v1/health` และ `/api/v1/ready` ถูก proxy ตอบ HTTP 403 CONNECT ก่อนถึง Vercel; runtime health/provenance จึงยังเป็น UNKNOWN.

## T22 benchmark

เลือกข้อ (ข): ไม่ทำ benchmark ในรอบนี้. เกณฑ์ 15 วินาทีรอวัดจากการใช้งานจริงบน staging. ไม่มีการเขียนหรือลบข้อมูลทดสอบในฐานข้อมูลใด.

## เฟส C — ความคืบหน้า

### T05 — ผ่าน gates, ยังไม่ merge

- Branch `fix/ux-t05-schedule-approvals-count-20261006`, base `3ed0585567091e88135bdbc3f7087a589c30e7d4`, commit `917e158dcf325481789595415bc9a65d1661cf37`, PR #474.
- CI run `37465310567` success; Vercel Preview Ready: https://sms-v3-staging-git-fix-ux-t05-schedule-approv-752411-godzillazz.vercel.app.
- Preview health endpoints ถูก proxy ปฏิเสธด้วย HTTP 403 CONNECT; runtime health เป็น UNKNOWN. PR #474 ยังไม่ merge.
- Backend focused 26/26, frontend focused 6/6, frontend suite 835/835 และ build ผ่าน; browser fixture ใช้ API mock read-only ที่ 1366×768/375×812, ไม่มี page errors/overflow และใช้ GET เท่านั้น.

### T01 — local verification ผ่าน, รอ PR gates

- Branch `fix/ux-t01-loading-state-no-stale-20261006`, base `3ed0585567091e88135bdbc3f7087a589c30e7d4`; ขั้นถัดไปคือเปิด PR และรอ CI/Preview.
- Response, loading และ error ผูกกับ active page/query; เปลี่ยนหน้า/ตัวกรองแล้วซ่อนผลเก่าทันที. Personnel, Audit, Data Quality, Leave History และ operational pagination แสดง placeholder ขณะรอ; เพิ่ม regression test ที่ rerender จาก Audit ไป Data Quality ก่อน response ใหม่มา.
- Frontend suite 837/837, production build และ `git diff --check` ผ่าน. Chromium API-mock fixture ที่ 1366×768/375×812 ตรวจ Audit → Data Quality → Personnel → Leave History: ตัวเลขเก่าหายระหว่างรอ response, ไม่มี page errors/overflow และไม่มี API mutation call.
- ต้องสร้าง PR, รอ CI ของ SHA ปัจจุบันผ่าน และ Vercel Preview Ready ก่อนเริ่ม T02.

## งานค้าง / ข้อจำกัด

- Health/provenance ของ staging และ Preview alias ยัง UNKNOWN เพราะ proxy ปิด CONNECT ด้วย HTTP 403 ก่อนถึง Vercel; Vercel deployment status แสดง Ready/completed แยกต่างหาก.
- T22 ไม่มีผล benchmark จริงตามตัวเลือก (ข); รอวัดจากการใช้งานจริงบน staging.
- ลำดับ Phase C ที่เหลือหลัง T01: T02 → T03 → T06. แต่ละ Task ต้องมี PR แยกและผ่าน CI กับ Preview Ready ก่อนเริ่ม Task ถัดไป; ห้าม merge PR ใน Phase C.
