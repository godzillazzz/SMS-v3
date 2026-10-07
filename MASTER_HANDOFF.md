# MASTER HANDOFF

## HOTFIX — R1B release-control and Production status (7 ตุลาคม 2569 เวลาไทย)

**สถานะ: OPEN — เจ้าของระบบแจ้งว่าเรียบร้อยแล้ว แต่ยังไม่มีหลักฐาน run/deployment สำหรับบันทึกผล Production**

สถานะนี้เป็นข้อมูลล่าสุด; เนื้อหาด้านล่างเป็นบันทึกประวัติ ณ วันที่ 6 ตุลาคม และไม่ใช่สถานะปัจจุบันของ R1B.

### R1B และ release-control

- Integration branch `fix/serverless-database-reliability` ปัจจุบันอยู่ที่ merge commit `aa8e8bb42ffd7f920fb4275e3c4aea9be69c582b` จาก PR #482.
- PR #481 แก้ Linux `libc` metadata ของ sharp 0.35.5; R1B source SHA `31b17868642b3b653630ad5356b8d26c08fde55d`, tree `24e8cd0052818c41cb6e0dd17a19f333b342baa0`.
- CI exact SHA ของ R1B: run `37557051194` สำเร็จ. Vercel status ของ R1B เป็น success: https://vercel.com/godzillazz/sms-v3-staging/9iVQBHyiTUzffBBqCtHncbAzSjR9.
- R1B Preview: https://sms-v3-staging-chd2sa7ey-godzillazz.vercel.app, deployment `dpl_9iVQBHyiTUzffBBqCtHncbAzSjR9`.
- Technical Smoke run `37557641064` สำเร็จ; workflow ยืนยัน source SHA, target URL และ deployment ID ข้างต้นตรงกัน. ผล Playwright: 11 ผ่าน, 23 ข้าม.
- Release-control PR #482 merged; head `852773e07c4e55764a22991c67b9438afe88d319`, merge SHA `aa8e8bb42ffd7f920fb4275e3c4aea9be69c582b`. PR CI run `37560247568` ผ่าน และ Vercel status เป็น success: https://vercel.com/godzillazz/sms-v3-staging/2ZTV7Jrffroc5L4xxEVXrZFznubo.
- Manifest ที่ merge แล้วชี้ R1B SHA/tree, application PR #481, CI run `37557051194`, Technical Smoke run `37557641064`, Preview deployment ข้างต้น และ `schedule_large_batch_postgres_batch_size = 500`. Policy เดิมยังคงอยู่: `NO_DATABASE_CHANGES`, schema/data mutation `NONE`, `NO_ENVIRONMENT_CHANGES`, secrets `NONE`.

### Production release evidence

- Production release run `37555538076` ก่อนหน้า R1B ล้มที่ step `Build exact prebuilt Production artifact` เพราะพบแพ็กเกจ sharp musl บน Linux/glibc. ตามรายงานในงานนั้น Production ไม่ถูกแตะ.
- หลังได้รับแจ้งว่า manifest พร้อม เจ้าของระบบตอบว่า “เรียบร้อยแล้ว”. ข้อความนั้นไม่ได้ให้ Production workflow run ID, deployment ID/SHA ที่ปล่อยจริง หรือผลตรวจหลังปล่อย.
- Codex ไม่ได้ dispatch Production workflow ในขั้นตอนนี้ และยังไม่ได้ตรวจ canonical หรือทำ post-release checks หลังข้อความดังกล่าว. ดังนั้นสถานะ Production หลังการดำเนินการของเจ้าของระบบยังเป็น `UNKNOWN` ใน handoff นี้; “เรียบร้อยแล้ว” เป็นรายงานจากเจ้าของระบบ ไม่ใช่ผลตรวจอิสระ.
- Manifest เก็บ pre-release checkpoint เป็น source `f63c785e8af1d63f3d27754c66709e6a0d9b3443` / deployment `dpl_F4E5kVXqpYuhQjcQSDP49ViJJvpK`. ใช้เป็น rollback reference ก่อนปล่อยเท่านั้น; ยังยืนยันไม่ได้ว่าเป็น canonical หรือ rollback target ปัจจุบันหลังการปล่อยที่เจ้าของระบบรายงาน.
- ปิดสถานะ release ได้เมื่อบันทึก workflow run ID, ผล gate, deployment ID/native SHA และผลตรวจหลังปล่อยแบบ read-only จากหลักฐานที่ตรวจสอบได้. ไม่มีการเขียน/ลบข้อมูล Production, แก้ secret/env/schema หรือ dispatch release workflow ในขั้นตอนนี้.

---


อัปเดต 6 ตุลาคม 2569 (เวลาไทย)

## สถานะงาน

- Integration base หลัง Phase B: `fix/serverless-database-reliability` @ `3ed0585567091e88135bdbc3f7087a589c30e7d4`.
- เฟส A: เสร็จ; เฟส B: merge #470 → #471 → #472 → #473 สำเร็จตามลำดับ.
- เฟส C: กำลังทำ T05 บน branch `fix/ux-t05-schedule-approvals-count-20261006` ซึ่งเริ่มจาก base SHA ข้างต้น; ยังไม่มี commit, push หรือ PR ของ T05.
- Vercel ของ merge SHA ล่าสุดในโปรเจกต์ `sms-v3-staging` แสดง deployment completed: https://vercel.com/godzillazz/sms-v3-staging/4XYyB1Quoqw4ivM5P2X41vc8aAU2. ตรวจ URL staging `/api/v1/health` และ `/api/v1/ready` โดยตรงไม่ได้เพราะ proxy ตอบ HTTP 403 CONNECT; จึงยังยืนยัน runtime health/provenance ผ่าน alias ไม่ได้.
- ไม่ได้ deploy Production, promote, แตะ Environment approval หรือเขียนข้อมูลลงฐานข้อมูล staging/Production.

## เฟส A+B — สถานะ PR

| PR | SHA ก่อน rebase → หลัง rebase | CI ของ SHA หลัง rebase | Merge | Preview | Acceptance |
|---|---|---|---|---|---|
| #470 | `26eeee832ea3e9cd0e6b0c171b46cd0680b9ac03` → `26eeee832ea3e9cd0e6b0c171b46cd0680b9ac03` (rebase no-op) | CI run `37457419185` success; Vercel success/Ready | merged `adb94c9135dbac9e0b94e3461869f7a7e8b20c10` | https://sms-v3-staging-git-fix-schedule-approval-stat-155f07-godzillazz.vercel.app | ผ่าน: label `changeType` ครบ 12 ค่าและมี test; ปุ่มไม่อนุมัติ disabled จนเหตุผลหลัง trim ≥5 ตัวอักษรพร้อม test. Frontend 828/828 และ build ผ่าน. |
| #471 | `739bb43590a89dbc696e4973d07bbbf90cc9ae6c` → `667666afc742df80aca1dac13dba666f47e240b4` | CI run `37457947822` success; Vercel success/Ready | merged `da6b44d302abee0ff1dc5575164da03b966ea2ac` | https://sms-v3-staging-git-fix-schedule-department-ro-7ffe45-godzillazz.vercel.app | ผ่าน: group-row CSS ครบธีมสว่าง/มืด/print และ sticky; fixture 1366×768/375×812 ไม่มี page overflow. พนักงาน `AN1,AN2,AN3` คงเป็นค่าเดียวพร้อม test. ไม่มี authenticated roster session จึงทดสอบด้วย fixture. |
| #472 | `06adee290b2fe2be4a359fdab2772a92d574f278` → `923447d7c7da6661463c64c2195dae01ad374cda` | CI run `37458878815` success; Vercel success/Ready | merged `5a0fbe299bedd165a580995dc326b54e946aaaa3` | https://sms-v3-staging-git-fix-schedule-auto-preview-108969-godzillazz.vercel.app | ผ่าน: conflict resolution คงการจัดกลุ่ม/print จาก #471 และ auto-schedule preview; frontend 833/833, focused backend 18/18, build ผ่าน. |
| #473 | `2282dda340bef35ec830a46e53be5f7bd09a3a80` → `d8c8ad0706c5d7feb9b038c6dde8204f622c1235` | CI run `37459833957` success; Vercel success/Ready | merged `3ed0585567091e88135bdbc3f7087a589c30e7d4` | https://sms-v3-staging-git-fix-schedule-batch-save-10-c701ee-godzillazz.vercel.app | ผ่านสำหรับ batch save จาก CI, frontend 835/835, build และ browser fixture ที่ 1366×768/375×812. Browser เข้า Preview จริงไม่ได้จาก proxy. ไม่ได้วัด benchmark 1,000 รายการ; ดู T22. |

## ตรวจ deployment หลัง Phase B

- Vercel project `sms-v3-staging` แสดง deployment ของ merge SHA `3ed0585567091e88135bdbc3f7087a589c30e7d4` ว่า completed ตาม dashboard link ในสถานะงาน.
- การยืนยันว่า staging alias เสิร์ฟ SHA นี้และ `/api/v1/health`, `/api/v1/ready` ทำงานยังไม่สำเร็จ: outbound proxy ปิด CONNECT ด้วย HTTP 403 ก่อนถึง Vercel. สถานะนี้เป็น UNKNOWN ไม่ใช่ PASS.

## T22 benchmark

เลือกข้อ (ข): งด benchmark ในรอบนี้. เกณฑ์ 15 วินาทียังรอวัดจากการใช้งานจริงบน staging. ไม่มีการเขียนหรือลบข้อมูลทดสอบในฐานข้อมูลใด.

## เฟส C — T05 กำลังดำเนินการ

- เพิ่ม `SCHEDULE_APPROVAL` ใน policy matrix ด้วย safe default ADMIN/SUPERVISOR; ถ้าคีย์ policy ทั้งหมดไม่อยู่ ใช้ default ในโค้ด ส่วน partial/invalid settings ยังคง fail-closed. ไม่มี migration หรือ DB write.
- Approval Center summary/list หา max revision ต่อเดือน แล้วนับ/แสดงเฉพาะแถว `PENDING` ที่ตรงกับ revision ล่าสุด; รายการมีชื่อเดือน/ฉบับ, ใช้ `changedAt` และปุ่มเปิดหน้าอนุมัติตารางกะ.
- Local verification: focused backend 26/26, focused frontend 6/6, frontend full suite 835/835, frontend build และ `git diff --check` ผ่าน.
- Full backend `npm test` บน URL เฉพาะ `127.0.0.1:5432/smsv3_test` (port ปิด): 1,319/1,327 ผ่าน; 8 ล้มเหลวในกลุ่ม DB-backed leave/schedule/shift ที่ต้องมี PostgreSQL และ backup script 2 tests ที่เรียก PowerShell (`pwsh` ไม่มีในเครื่อง). CI ของ T05 ยังไม่เริ่ม.
- Browser fixture ใช้ข้อมูล API จำลองแบบ read-only เพราะไม่มี authenticated session; ที่ 1366×768 และ 375×812 ปุ่มเปิดหน้าอนุมัติทำงาน, ไม่มี horizontal overflow/page error/failed request, API requests เป็น GET ทั้งหมด.
- ยังไม่มี commit, push หรือ PR ของ T05. ต้องได้ CI success และ Vercel Preview READY ก่อนเริ่ม T01.

## งานค้าง / ข้อจำกัด

- Runtime health/provenance ของ staging alias ยัง UNKNOWN เพราะ proxy ปิด CONNECT ด้วย HTTP 403 ก่อนถึง Vercel. หากต้องยืนยัน health ผ่าน alias ต้องมี network path ที่เข้าถึง staging ได้.
- T22 ยังไม่มี benchmark จริง; เกณฑ์ 15 วินาทีรอวัดจากการใช้งานจริงบน stagingตามตัวเลือก (ข).
- ไม่มีการตัดสินใจจาก Owner ที่ต้องใช้เพื่อทำ T05 ต่อในขณะนี้. ลำดับ Phase C ที่เหลือ: T01 → T02 → T03 → T06; แต่ละงานต้องได้ CI success และ Preview READY ก่อนเริ่มงานถัดไป.
