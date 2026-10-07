# MASTER HANDOFF

## Current release status — R2 blocked before Technical Smoke (7 ตุลาคม 2569)

**สถานะ: OPEN — R2 PRs merged and exact-SHA CI passed; release stopped before Technical Smoke because the exact Preview deployment metadata and workflow dispatch capability are unavailable through the connected tools. Production was not touched in this work.**

### Production now — R1B

- Production source SHA: `31b17868642b3b653630ad5356b8d26c08fde55d`.
- Production workflow: [run 37561130901](https://github.com/godzillazzz/SMS-v3/actions/runs/37561130901) completed successfully. Both jobs succeeded; the exact-source, governance, database-target, CORS baseline, rollback-checkpoint, Linux artifact, immutable-candidate, promote/canonical-verification, and release-summary steps passed. Automatic rollback steps were skipped.
- Production deployment: `dpl_ExgyPfG7tYcby5PYDUVwn4iqrygE`, URL `https://sms-v3-staging-wl7nutl57-godzillazz.vercel.app`.
- R1B application CI: run `37557051194` succeeded; Technical Smoke: run `37557641064` succeeded; release-control PR #482 merged as `aa8e8bb42ffd7f920fb4275e3c4aea9be69c582b`.
- Owner confirmed the authenticated R1 screen checks passed. This is the current Production and rollback reference for a future R2 release.
- Previous `f63c785` / `dpl_F4E5kVXqpYuhQjcQSDP49ViJJvpK` is the historical pre-R1B checkpoint, not the current R2 rollback target.

### R2 — application PRs merged

All four PRs were updated by merge (no rebase/force-push), passed CI on their updated heads, had a successful Vercel Preview status, and were then merged in order.

| PR | Head before → updated head | Exact-head CI | Vercel Preview | Merge commit |
|---|---|---|---|---|
| #475 | `116dd0a92b7377a2b570d09f144f8f3b4215cd61` → `9bb5d3a098a671ee6a14631546c03ce420f355af` | `37567238651` success | READY — https://sms-v3-staging-git-fix-ux-t01-loading-state-n-77d77f-godzillazz.vercel.app | `5f1f1f72df019fdffbf24d5fd8c221e70a6c5a2e` |
| #476 | `b817d8a9eaa4c148c6541e2a399b3d5338732ab0` → `fdf903408a7d1e5d0658869b7fd7520d85523865` | `37567479738` success | READY — https://sms-v3-staging-git-fix-ux-t02-attendance-page-e7112f-godzillazz.vercel.app | `57e81ee9fab3590164da37a7e40e2b902d3149de` |
| #477 | `6b6a488462f2098f79d47cc7470ec968dbc98bfa` → `442ef0562a2d13d27e51e5279a317b0572795af6` | `37567934048` success | READY — https://sms-v3-staging-git-fix-ux-t03-remove-dev-copy-dfd2f3-godzillazz.vercel.app | `3ae26fc39c2c914c75d26daabe1945c946deafae` |
| #478 | `22c1209c74440626b9862941fca033bec88216ac` → `0b392472f1c56aa785b72e8f161ffd137534fbf9` | `37568236186` success | READY — https://sms-v3-staging-git-fix-ux-t06-login-20261006-godzillazz.vercel.app | `ad0cc766bf2e24d81ee025d19cdb9301b0f32809` |

- R2 application RELEASE_SHA / integration head after these four merges: `ad0cc766bf2e24d81ee025d19cdb9301b0f32809`.
- Exact-SHA CI run `37568415124` succeeded, including clean `npm ci`, Linux sharp/musl artifact guard, root and frontend audits, tests, integration tests, TypeScript, and frontend build.
- Exact-SHA Vercel status is success: https://vercel.com/godzillazz/sms-v3-staging/7AFHKtuPEfTUnJksbU51PryrYexY. The status feedback links to Preview host `https://sms-v3-staging-git-fix-serverless-database-re-662e13-godzillazz.vercel.app`.

### R2 — release gate results

- P1: PASS at the time the four application PRs were merged; `ad0cc766bf2e24d81ee025d19cdb9301b0f32809` was the integration head and exact-SHA CI passed.
- P2: BLOCKED. The available evidence shows the Vercel status and Preview host, but the GitHub Deployment record fields `environment_url` and exact Vercel `dpl_...` ID for this SHA could not be retrieved through the connected GitHub interface. Those values are required to bind Technical Smoke to the exact deployment.
- P3: NOT RUN. The connected tools expose GitHub read operations but no Actions workflow-dispatch action. Technical Smoke was not dispatched without verified P2 provenance.
- P4: Current rollback reference is R1B Production deployment `dpl_ExgyPfG7tYcby5PYDUVwn4iqrygE` / source `31b17868642b3b653630ad5356b8d26c08fde55d`.
- P5–P8: NOT REACHED. No R2 manifest PR was created, no Environment review was sent, no Production workflow was dispatched, and no R2 post-release checks or rollback occurred.
- No Production business data, secret, environment, schema, or migration was changed.

### R3 and remaining checks

- R3 has not started because R2 did not pass P8. T25 token-reuse/audit inspection, T24 region/performance work, T26 unknown approval-label query, and T27/T28 UI work are all pending.
- There is no conclusion yet about refresh-token reuse or leakage. No session revocation or account suspension was performed.
- T24 DB/function-region comparison and before/after Preview timings have not been collected; no region or infrastructure change was made.
- Protected UI checks requiring an authenticated session remain “ยังไม่ได้ตรวจ (ไม่มี session)”; no credential was requested or created.

### T22 benchmark and next unblock

- T22 was not benchmarked. The 15-second target remains unmeasured before release; no benchmark data was written to any database.
- To resume R2, the execution path needs to expose the exact GitHub Deployment `environment_url` and Vercel deployment ID for the release SHA and an authorized Actions dispatch operation. No approval or policy gate should be changed.
- Because this handoff is recorded through a documentation PR, if it is merged after this entry, rerun P1 against the resulting integration HEAD before preparing any release manifest.

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
