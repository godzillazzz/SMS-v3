# MASTER HANDOFF

## Current state — R2 Production ผ่าน; R3 หยุดที่หลักฐานตรวจ T25 (7 ตุลาคม 2569)

**สถานะ: OPEN — R2 Production สำเร็จและเจ้าของระบบยืนยันการตรวจหน้าจอหลังล็อกอินผ่านแล้ว. R3 เริ่มเฉพาะการอ่าน source สำหรับ T25; ยังตรวจ audit ของบัญชี Sermpong UAT ไม่ได้เพราะ endpoint ต้องใช้ session ADMIN ที่มีสิทธิ์และไม่มี session ที่ได้รับอนุญาตใน execution นี้. สถานะเหตุ token reuse/leak สำหรับบัญชีนี้จึงเป็น UNKNOWN. ยังไม่มีการแก้ code, สร้าง PR หรือปล่อย R3.**

### Production now — R2

- Production source SHA: `2d9a21c9c8d940fbd5c3c8c9dadceae073f0a9ea`.
- Production workflow: [run 37572338555](https://github.com/godzillazzz/SMS-v3/actions/runs/37572338555), completed successfully on source `d868a6003d2e069245a8e166e17ff20211579b64`. ทั้งสอง job ผ่าน; ขั้น Linux artifact guard, immutable candidate, promote/canonical verification, runtime verification และ CORS verification สำเร็จ. Automatic rollback steps ถูก skip.
- Deployment id: `dpl_FbXBhBdjcNLvYEpN9sXs3EV6VEuh`, URL `https://sms-v3-staging-e71ppzlg5-godzillazz.vercel.app`. Run log ยืนยัน `sms-v3-staging` ถูก promote ไป deployment นี้; `CANONICAL_PRODUCTION_RUNTIME_VERIFY=PASS` และ `CANONICAL_PRODUCTION_CORS_VERIFY=PASS`.
- เจ้าของระบบยืนยันว่า R2 ผ่านการตรวจหน้าจอหลังล็อกอิน.
- **Rollback reference ปัจจุบัน:** R2 deployment `dpl_FbXBhBdjcNLvYEpN9sXs3EV6VEuh`, source `2d9a21c9c8d940fbd5c3c8c9dadceae073f0a9ea`. R1B `dpl_ExgyPfG7tYcby5PYDUVwn4iqrygE` เป็น checkpoint ก่อน R2 แล้ว.
- ไม่มีการเขียน/ลบข้อมูลธุรกิจ, เปลี่ยน secret/environment/schema หรือกดส่งฟอร์มบน Production ในงานนี้.

### R2 release evidence

- Application RELEASE_SHA: `2d9a21c9c8d940fbd5c3c8c9dadceae073f0a9ea`; exact-SHA CI run `37570803508` ผ่าน.
- PR #475 → #478 merge เข้า integration ตามลำดับ; รายละเอียด head/CI/Preview/merge commit อยู่ในตารางด้านล่าง.
- Preview ของ R2: `https://sms-v3-staging-jqlzeasds-godzillazz.vercel.app`, deployment `dpl_G5oZbZ39TpUPceR5WiahRLxURGgR`.
- Automated Technical Smoke [run 37571365579](https://github.com/godzillazzz/SMS-v3/actions/runs/37571365579) สำเร็จและผูกกับ source SHA ข้างต้น.
- Release-control PR #486 ปรับ manifest สำหรับ R2 และ merge เป็น `d868a6003d2e069245a8e166e17ff20211579b64`.

| PR | Head หลัง update-branch | Exact-head CI | Vercel Preview | Merge commit |
|---|---|---|---|---|
| #475 | `9bb5d3a098a671ee6a14631546c03ce420f355af` | `37567238651` success | READY — https://sms-v3-staging-git-fix-ux-t01-loading-state-n-77d77f-godzillazz.vercel.app | `5f1f1f72df019fdffbf24d5fd8c221e70a6c5a2e` |
| #476 | `fdf903408a7d1e5d0658869b7fd7520d85523865` | `37567479738` success | READY — https://sms-v3-staging-git-fix-ux-t02-attendance-page-e7112f-godzillazz.vercel.app | `57e81ee9fab3590164da37a7e40e2b902d3149de` |
| #477 | `442ef0562a2d13d27e51e5279a317b0572795af6` | `37567934048` success | READY — https://sms-v3-staging-git-fix-ux-t03-remove-dev-copy-dfd2f3-godzillazz.vercel.app | `3ae26fc39c2c914c75d26daabe1945c946deafae` |
| #478 | `0b392472f1c56aa785b72e8f161ffd137534fbf9` | `37568236186` success | READY — https://sms-v3-staging-git-fix-ux-t06-login-20261006-godzillazz.vercel.app | `ad0cc766bf2e24d81ee025d19cdb9301b0f32809` |

### R3 — T25 security gate

- Read-only source review พบว่า browser `api.ts` มี single-flight เฉพาะ module instance ของ tab นั้น; `attendance-auth-request.ts` มี `refreshPromise` แยกกัน. แต่ละ tab มี state แยกกัน จึงยังมีทางให้ refresh cookie เดียวกันถูกใช้พร้อมกันข้าม tab (ข้อเท็จจริงจาก code; ยังไม่ใช่หลักฐานว่าเกิดกับบัญชี UAT).
- Backend หมุน refresh token และเมื่อพบ token ที่ revoke แล้ว จะบันทึก `TOKEN_REUSE` และเรียก `revokeAllForUser` เพื่อ revoke session ของ user ทั้งหมดและเพิ่ม `tokenVersion`.
- Audit route คือ `GET /api/v1/operations/audit-events`; ใน source กำหนด `authorize('ADMIN')`. ไม่มี authorized ADMIN session ให้ใช้ใน execution นี้. ไม่มีช่องทาง query account-specific audit แบบ read-only จาก GitHub/Vercel ที่ใช้ได้โดยไม่ต้องมี Production Environment approval. `.github/workflows/diagnose-production-database.yml` ต้องผ่าน Environment `production-sms-v3-staging` และ scripts/inputs ที่มีตรวจ LIC-HIST/G06 ไม่ได้ตรวจ refresh-token audit.
- จึง **ยังไม่ได้ตรวจ audit ของ Sermpong UAT**; ไม่พบ/ไม่มีหลักฐานให้สรุปว่า token รั่ว และก็ยังตัดความเป็นไปได้นั้นไม่ได้. ไม่มีการ revoke session, ระงับบัญชี หรือแก้ auth policy. ตาม fail-closed, R3 หยุดก่อน T24 จนกว่าจะมีช่องทางอ่าน audit ที่ได้รับอนุญาต; T24, T26, T27 และ T28 ยังไม่เริ่ม.
- งาน T28 ที่เพิ่มตามคำสั่งให้รวม: (6) ลบ/แสดงข้อมูลจริงแทนการ์ด `AWAITING DATA` (`ROSTER READINESS / SHIFT COVERAGE`); (7) เอาคำ “ไม้กายสิทธิ์” และ `CFG-06` ออกจากข้อความผู้ใช้; (8) แปล 403 ของ `/attendance/simple/bootstrap` สำหรับบัญชีที่ไม่มี employee link เป็นข้อความเฉพาะ; (9) ห้ามแสดง badge `0` ก่อนมีค่าครั้งแรก; (10) ค้นหาและลบ placeholder `••••••••••••` ตาม T06.
- ไม่มี R3 RELEASE_SHA, PR, CI หรือ Preview ในขณะนี้. จะเริ่ม task ถัดไปจาก integration HEAD ล่าสุด หลังผ่าน T25 ตามลำดับ.

### R2 PR / release table

| PR | Head/RELEASE_SHA | CI | Merge / production |
|---|---|---|---|
| #486 (R2 release-control) | source `2d9a21c9c8d940fbd5c3c8c9dadceae073f0a9ea` | merge-SHA CI `37571946527` success; app exact-SHA CI `37570803508` success; Technical Smoke `37571365579` success | merge `d868a6003d2e069245a8e166e17ff20211579b64`; Production run `37572338555` success; deployment `dpl_FbXBhBdjcNLvYEpN9sXs3EV6VEuh` |

---

## Historical handoff

The dated sections below record prior phases and are retained as historical context; they do not supersede the current R1B Production and R2 gate status above.
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
