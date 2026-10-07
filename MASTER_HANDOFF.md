# MASTER HANDOFF

## Current state — R2 Production ผ่าน; R3 application work พร้อมให้เจ้าของระบบหา Preview และรัน Technical Smoke (7 ตุลาคม 2569)

**สถานะ: OPEN — Production ยังเป็น R2 (`2d9a21c9c8d940fbd5c3c8c9dadceae073f0a9ea`), เจ้าของระบบยืนยันหน้าจอหลังล็อกอินผ่าน และ rollback reference คือ `dpl_FbXBhBdjcNLvYEpN9sXs3EV6VEuh`. งาน R3 T25 → T24 → T26 → T27 → T28 อยู่บน integration แล้ว. Application RELEASE_SHA สำหรับ Smoke คือ `dad05e83ad4fa44affa8175c520b087a5f94b509` (merge #492). Exact-head CI และ Vercel status ของ PR #492 head `f7c86882b10822e1277f68ec977a092c639b7784` ผ่าน; tree ของ PR head ตรงกับ merge SHA. Status check โดยตรงบน merge SHA ยังเป็น Vercel `pending` และ connector ไม่ได้ให้ Preview alias/deployment id ดังนั้นเจ้าของระบบต้องยืนยัน Preview ที่ native SHA/ref/project/READY ตรงกับ RELEASE_SHA ก่อน Technical Smoke. ยังไม่มี R3 Smoke หรือ Production release.**

### Production now — R2

- Production source SHA: `2d9a21c9c8d940fbd5c3c8c9dadceae073f0a9ea`.
- Production workflow: [run 37572338555](https://github.com/godzillazzz/SMS-v3/actions/runs/37572338555), completed successfully. Workflow output ระบุ deployment `dpl_FbXBhBdjcNLvYEpN9sXs3EV6VEuh`, URL `https://sms-v3-staging-e71ppzlg5-godzillazz.vercel.app`; runtime, readiness/database, canonical SHA และ CORS checks ผ่าน.
- เจ้าของระบบยืนยันว่าตรวจหน้าจอหลังล็อกอินของ R2 ผ่านแล้ว.
- **Rollback reference ปัจจุบัน:** R2 deployment `dpl_FbXBhBdjcNLvYEpN9sXs3EV6VEuh`, source `2d9a21c9c8d940fbd5c3c8c9dadceae073f0a9ea`.
- ไม่มีการเขียน/ลบข้อมูลธุรกิจ, เปลี่ยน secret/environment/schema หรือส่งฟอร์มบน Production ระหว่าง R3.

### R2 release evidence

- Application RELEASE_SHA: `2d9a21c9c8d940fbd5c3c8c9dadceae073f0a9ea`; exact-SHA CI run `37570803508` ผ่าน.
- Preview: `https://sms-v3-staging-jqlzeasds-godzillazz.vercel.app`, deployment `dpl_G5oZbZ39TpUPceR5WiahRLxURGgR`.
- Automated Technical Smoke [run 37571365579](https://github.com/godzillazzz/SMS-v3/actions/runs/37571365579) ผ่าน. Release-control PR #486 merge `d868a6003d2e069245a8e166e17ff20211579b64`.

| PR | Head หลัง update | Exact-head CI | Vercel Preview | Merge commit |
|---|---|---|---|---|
| #475 | `9bb5d3a098a671ee6a14631546c03ce420f355af` | `37567238651` success | READY — https://sms-v3-staging-git-fix-ux-t01-loading-state-n-77d77f-godzillazz.vercel.app | `5f1f1f72df019fdffbf24d5fd8c221e70a6c5a2e` |
| #476 | `fdf903408a7d1e5d0658869b7fd7520d85523865` | `37567479738` success | READY — https://sms-v3-staging-git-fix-ux-t02-attendance-page-e7112f-godzillazz.vercel.app | `57e81ee9fab3590164da37a7e40e2b902d3149de` |
| #477 | `442ef0562a2d13d27e51e5279a317b0572795af6` | `37567934048` success | READY — https://sms-v3-staging-git-fix-ux-t03-remove-dev-copy-dfd2f3-godzillazz.vercel.app | `3ae26fc39c2c914c75d26daabe1945c946deafae` |
| #478 | `0b392472f1c56aa785b72e8f161ffd137534fbf9` | `37568236186` success | READY — https://sms-v3-staging-git-fix-ux-t06-login-20261006-godzillazz.vercel.app | `ad0cc766bf2e24d81ee025d19cdb9301b0f32809` |

### R3 PRs

| Task / PR | Head | Exact-head CI | Vercel status / Preview | Merge commit |
|---|---|---|---|---|
| T25 / #488 | `a846541aea13b6e27fb4963be65a5f69acd3ff55` | `37575249077` success | READY — https://sms-v3-staging-git-codex-r3-t25-secure-refres-0a8bee-godzillazz.vercel.app | `47c1628a092e8bc02fbc608500bcf6fc58abd1f5` |
| T24 / #489 | `d420ce2f3977d32e93f6a35e320f86f915635e38` | `37575658761` success | READY — https://sms-v3-staging-git-codex-r3-t24-performance-20261007-godzillazz.vercel.app | `70e807b8982277a0617552229ae6c7d993336be9` |
| T26 / #490 | `86923ed517ad61f6d05eb13e684f6f38e3db5ea5` | `37576069884` success | READY — https://sms-v3-staging-git-codex-r3-t26-approval-labe-a17eee-godzillazz.vercel.app | `c582eabb824b2fabcda734c387c0d4af3be3866d` |
| T27 / #491 | `bad8d3856d1d5018436da2455b513cb18e12d14b` | `37577516049` success | Vercel success — dashboard target only; alias and dpl id unavailable from connector | `463b1650eadde1b55345f2f1ca3244d9bf9ae713` |
| T28 / #492 | `f7c86882b10822e1277f68ec977a092c639b7784` | `37578638934` success | Vercel success — [deployment dashboard](https://vercel.com/godzillazz/sms-v3-staging/5mi7x24MXR4j3ccL4eS4wP823mQ3); alias/dpl id unavailable. Merge SHA status remains pending in connector. | `dad05e83ad4fa44affa8175c520b087a5f94b509` |

### R3 — outcomes and unresolved read-only checks

- **T25 security:** source review confirmed refresh attempts could race between browser tabs; #488 adds same-origin single-flight via Web Locks with fail-closed behavior when unavailable. Account-specific `Sermpong UAT` audit was not queryable: the audit endpoint requires ADMIN authorization and no authorized session was available. No evidence of token theft was found in accessible sources; the audit conclusion is UNKNOWN. No session was revoked and no account was suspended.
- **T24 performance:** #489 batches supervisor/daily event-policy and actual-site reads; query-count test reduces policy reads from 72 per 12 assignments to one batch query and site reads from three queries to one. Approval summary polling is 60 seconds and visible-tab only. Focused backend 63/63, frontend 859/859, build and diff-check passed. Protected Preview timing before/after was not measured without an authorized session. Function region is `sin1`; database region remains UNKNOWN. Full local backend tests needing PostgreSQL could not complete in this sandbox; exact-head CI passed.
- **T26 labels:** null/blank approval `status` and `change_type` display `ไม่ระบุ`; other unmapped values display `อื่น ๆ`. Production read-only approval query was unavailable, so concrete unknown non-null values remain UNKNOWN; no Production DB rows were queried.
- **T27 queue/device UI:** #491 hides request UUIDs, shows sender and people icon, localizes event/status enums and avoids default device counts while loading. CI passed; local frontend suite 863/863, build and diff-check passed. Authenticated browser inspection was unavailable; jsdom fixture used. Vercel alias and dpl id were not returned.
- **T28 additions (6–10):** #492 removes schedule `AWAITING DATA` readiness/coverage cards; removes visible “ไม้กายสิทธิ์” and `CFG-06` wording; regression-tests the employee-link-specific Thai response for `/attendance/simple/bootstrap` 403; leaves bell/approval badges unset until a valid initial value (and hides zero); removes fake `••••••••••••` masked-token placeholder. Focused T28 regressions 14/14, frontend 871/871, build and diff-check passed. Exact-head CI run `37578638934` succeeded and Vercel status is success for the PR head. Authenticated schedule/settings pages were not opened; no credentials or Production data were used.

- **Next step:** Owner locates a READY Preview with native SHA `dad05e83ad4fa44affa8175c520b087a5f94b509`, ref `fix/serverless-database-reliability`, and the expected `sms-v3-staging` project; then Owner dispatches Technical Smoke. No workflow was dispatched by Codex. If smoke passes, record its run ID before any later release-control work. Production remains R2 throughout.

### R3 release candidate identity

- Application RELEASE_SHA: `dad05e83ad4fa44affa8175c520b087a5f94b509` (integration after #492; tree `8ae480e51f544694278ff1d65d9a97e439d23292`).
- Exact PR-head CI `37578638934` passed for `f7c86882b10822e1277f68ec977a092c639b7784`; its tree is identical to the merge SHA. Vercel status on that PR head succeeded. Combined status on `dad05e8…` currently reports Vercel `pending`; exact-SHA Preview alias and deployment ID must be obtained by Owner before Smoke.
- R3 has not been released to Production; rollback reference remains `dpl_FbXBhBdjcNLvYEpN9sXs3EV6VEuh`.

### R2 application PRs

| PR | Head / RELEASE_SHA | Exact-head CI | Merge commit |
|---|---|---|---|
| #475 | `9bb5d3a098a671ee6a14631546c03ce420f355af` | `37567238651` success | `5f1f1f72df019fdffbf24d5fd8c221e70a6c5a2e` |
| #476 | `fdf903408a7d1e5d0658869b7fd7520d85523865` | `37567479738` success | `57e81ee9fab3590164da37a7e40e2b902d3149de` |
| #477 | `442ef0562a2d13d27e51e5279a317b0572795af6` | `37567934048` success | `3ae26fc39c2c914c75d26daabe1945c946deafae` |
| #478 | `0b392472f1c56aa785b72e8f161ffd137534fbf9` | `37568236186` success | `ad0cc766bf2e24d81ee025d19cdb9301b0f32809` |
| #486 release control | source `2d9a21c9c8d940fbd5c3c8c9dadceae073f0a9ea` | exact CI `37570803508`; smoke `37571365579`; release-control merge CI `37571946527` — all success | `d868a6003d2e069245a8e166e17ff20211579b64`; Production run `37572338555`; deployment `dpl_FbXBhBdjcNLvYEpN9sXs3EV6VEuh` |

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
