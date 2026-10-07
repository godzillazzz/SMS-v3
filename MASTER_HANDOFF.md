# MASTER HANDOFF

## Current engineering task — T29 Printing / A4 (7 ตุลาคม 2569)

**สถานะ: OPEN — PR #497 อยู่บน branch `codex/t29-printing-a4-20261007` จาก integration base `fd4c7a1b110bee9a9ee77bc5eb2510cb772ee40b`; implementation commit `9ad835c238b3fbd06a197742515bbd2f69b9a3e1`. Production ไม่ถูก deploy/promote และยังคง R2 ตามด้านล่าง.**

- Current-HEAD audit ยืนยัน root cause: `frontend/src/styles.css` มี global `@page` บังคับ A4 landscape; Leave ใช้ `body.printing-leave` ซ่อน shell และเรียก `window.print()`; generic table และ Audit เรียก `window.print()` จาก application document; Executive/Attendance มี `@page` ของตนเอง; Attendance report จำกัดความสูง 210mm และ `overflow:hidden` จึงอาจตัดแถว/เนื้อหา.
- Implementation: เปลี่ยนงานพิมพ์เป็น isolated iframe ที่ clone เฉพาะ print document; กำหนด `@page A4` ต่อการพิมพ์ครั้งนั้นหลังโหลด stylesheets; ลบ global/report `@page` ที่ชนกัน; Leave เป็น portrait margin 12mm ใช้ leave-type display authority, มีข้อมูลผู้แทน/รายละเอียดและลายเซ็น; generic table/Audit แสดงชื่อรายงาน ตัวกรอง วันเวลา ผู้พิมพ์ และพิมพ์เฉพาะ table โดยไม่รวม shell; roster ใช้ landscape, 31 date columns กว้างรวมตามค่ากำหนด 268mm, shift code 7pt, header repeat และคุม department group; Attendance report ปล่อยความสูงไหลต่อหน้าและ repeat header.
- Local evidence ณ ตอนนี้: focused Vitest 30/30, frontend full suite 880/880, TypeScript check ผ่านด้วย `npx tsc --noEmit` ใน frontend และ `npm --prefix frontend run build`, bundle verification ผ่าน (`FRONTEND_PRODUCTION_BUNDLE=PASS`), `git diff --check` ผ่าน. Playwright/Chromium 151 local fixture 4/4 ผ่าน; config กำหนด Vite working directory แบบ absolute เพื่อให้ CI ที่เรียกจาก root ใช้ fixture ถูกต้อง. PDF ตรวจด้วย `pdfinfo`: Leave 1 หน้า A4 portrait, Roster 1 หน้า A4 landscape, Generic table 5 หน้า A4 landscape, Executive/Attendance fixture 4 หน้า A4 landscape. CI จะอัปโหลดภาพ page-1 และ PDF; fixture ใช้ข้อมูลสังเคราะห์และไม่เรียก API/DB.
- CI browser job ใช้ `@playwright/test` และ `pdf-lib` ที่มีอยู่แล้วใน repo; ไม่มีการเพิ่ม dependency. เครื่อง local ใช้ Node 24.19.0 ขณะที่ package กำหนด Node 22.x (npm แสดง EBADENGINE warning); authoritative CI ใช้ Node 22. Exact-head CI run `37588694778` สำหรับ commit `9ad835c` เริ่มแล้ว; Vercel check ยัง pending ที่ https://vercel.com/godzillazz/sms-v3-staging/E7mABEVVCCr8MSLDBv9SRBc9sWKT. Handoff update นี้จะสร้าง head ใหม่ จึงต้องยืนยัน CI/Preview ซ้ำกับ SHA ล่าสุดก่อน merge.
- Acceptance ที่ยังค้าง: exact PR head หลัง handoff update, CI, Vercel Preview READY/provenance. ไม่มีการแตะ backend API, schema/migration, RBAC, auth/Attendance/device/GPS policy, Production data, secret หรือ environment.

## Current state — R3 Technical Smoke ผ่าน; เตรียม release-control manifest แล้ว (7 ตุลาคม 2569)

**สถานะ: OPEN — Production ยังคงเป็น R2 (2d9a21c9c8d940fbd5c3c8c9dadceae073f0a9ea) และ rollback reference คือ dpl_FbXBhBdjcNLvYEpN9sXs3EV6VEuh. R3 T25 → T24 → T26 → T27 → T28 และ PR แก้ auth-refresh-lock fallback #495 merge เข้า integration แล้ว. R3 RELEASE_SHA คือ b3e70834977a1b29b367e8a1d3b3cfebac0d74c8; exact-SHA CI 37581186514 ผ่าน. ใช้ Preview https://sms-v3-staging-r01nag9m3-godzillazz.vercel.app / dpl_GhzQTqwXtvN28GUntKXEEtgximw9 (ไม่ใช่ Preview ของ PR head 0ced553f). Technical Smoke 37581750104 ผ่าน. Release-control manifest/test ของ R3 ถูกเตรียมให้ชี้ source, CI, Preview, Smoke และ rollback/canonical ของ R2; เมื่อ PR นี้ merge แล้ว ขั้นถัดไปคือให้ Owner dispatch Deploy Approved Production Manifest V2. ไม่มีการ dispatch Production workflow หรือ promote ในขั้นนี้.**

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
| T28 / #492 | `f7c86882b10822e1277f68ec977a092c639b7784` | `37578638934` success | Vercel success — [deployment dashboard](https://vercel.com/godzillazz/sms-v3-staging/5mi7x24MXR4j3ccL4eS4wP823mQ3); alias/dpl id unavailable. Combined status on merge SHA is now success; connector target is a Vercel dashboard, not an alias/dpl record. | `dad05e83ad4fa44affa8175c520b087a5f94b509` |

### R3 — outcomes and unresolved read-only checks

- **T25 security:** source review confirmed refresh attempts could race between browser tabs; #488 adds cross-tab coordination via Web Locks. The follow-up lock-fallback correction changes unavailable `navigator.locks` to call refresh directly and warn once; `api.ts` `refreshAuth()` retains same-tab single-flight. Account-specific `Sermpong UAT` audit was not queryable: the audit endpoint requires ADMIN authorization and no authorized session was available. No evidence of token theft was found in accessible sources; the audit conclusion is UNKNOWN. No session was revoked and no account was suspended.
- **T24 performance:** #489 completed batching for supervisor/daily event-policy and actual-site reads; query-count test reduced policy reads from 72 per 12 assignments to one batch query and site reads from three queries to one. Approval summary polling is 60 seconds and visible-tab only. Focused backend 63/63, frontend 859/859, build and diff-check passed. Still deferred to the next round: readiness/employee-center query work, dashboard aggregation, DB/function region comparison, and before/after Preview timing. Database region and measured Preview timings remain UNKNOWN. Full local backend tests needing PostgreSQL could not complete in this sandbox; exact-head CI passed.
- **T26 labels:** null/blank approval `status` and `change_type` display `ไม่ระบุ`; other unmapped values display `อื่น ๆ`. Production read-only approval query was unavailable, so concrete unknown non-null values remain UNKNOWN; no Production DB rows were queried.
- **T27 queue/device UI:** #491 hides request UUIDs, shows sender and people icon, localizes event/status enums and avoids default device counts while loading. CI passed; local frontend suite 863/863, build and diff-check passed. Authenticated browser inspection was unavailable; jsdom fixture used. Vercel alias and dpl id were not returned.
- **T28 additions (6–10):** #492 removes schedule `AWAITING DATA` readiness/coverage cards; removes visible “ไม้กายสิทธิ์” and `CFG-06` wording; regression-tests the employee-link-specific Thai response for `/attendance/simple/bootstrap` 403; leaves bell/approval badges unset until a valid initial value (and hides zero); removes fake `••••••••••••` masked-token placeholder. Focused T28 regressions 14/14, frontend 871/871, build and diff-check passed. Exact-head CI run `37578638934` succeeded and Vercel status is success for the PR head. Authenticated schedule/settings pages were not opened; no credentials or Production data were used.

- **Next step:** after the R3 release-control PR passes CI and merges, the manifest is ready for Owner to run Deploy Approved Production Manifest V2. Production remains R2 until that separately approved workflow is run.

### R3 release candidate identity and P5 release-control

- RELEASE_SHA: b3e70834977a1b29b367e8a1d3b3cfebac0d74c8; tree SHA 4601da889216edba0b2d4d80b0af77acda65f14c.
- Application PR #495 head 0ced553f6e7dbc3b9047b3fe2a8e64f8f0fd4408 merged as b3e70834977a1b29b367e8a1d3b3cfebac0d74c8; exact-SHA CI [run 37581186514](https://github.com/godzillazzz/SMS-v3/actions/runs/37581186514) succeeded.
- Use exact integration Preview https://sms-v3-staging-r01nag9m3-godzillazz.vercel.app, deployment dpl_GhzQTqwXtvN28GUntKXEEtgximw9; the PR-head Preview for 0ced553f is not the release candidate.
- Automated Technical Smoke [run 37581750104](https://github.com/godzillazzz/SMS-v3/actions/runs/37581750104) completed successfully on GitHub-hosted runner. Its inputs pin URL, source SHA, and expected deployment ID above. Logs show health/readiness and credentialed CORS smoke checks passed; 11 smoke tests passed.
- R2 remains Production and rollback checkpoint: deployment dpl_FbXBhBdjcNLvYEpN9sXs3EV6VEuh, source SHA 2d9a21c9c8d940fbd5c3c8c9dadceae073f0a9ea.
- The R3 release-control PR updates the manifest/test to this exact release SHA, PR #495, CI 37581186514, Preview/deployment, Smoke 37581750104, and R2 canonical/rollback reference. Existing database, environment, secret, auth-policy, CORS, deployment, and rollback policies remain unchanged; batch size remains 500.
- Production workflow has not been dispatched. After release-control PR CI passes and it is merged, the manifest is ready for Owner to run Deploy Approved Production Manifest V2. Authenticated pages were not tested in Technical Smoke; account audit remains UNKNOWN. T24 timing, readiness/dashboard work, and DB/function region comparison remain deferred as recorded above.
- No Production release or rollback has occurred in R3; rollback reference remains the R2 deployment above.

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
