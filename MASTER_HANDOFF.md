# MASTER HANDOFF

อัปเดต 2026-10-07 00:18 UTC

## OPEN — R1 dispatch blocked; latest Owner instructions (2026-10-07 00:18 UTC)

- Latest Owner instruction cancels ALL release time restrictions. Production release is authorized immediately; only Owner will submit GitHub Environment approval. Do not submit reviews on Owner's behalf.
- Re-verified remote integration head: `60f6109a09eb8e27c5d8b83820d7df8014667ae5` (`R1_SHA`). GitHub CI run [37546753747](https://github.com/godzillazzz/SMS-v3/actions/runs/37546753747) is completed/SUCCESS on this exact SHA; tree `b38d8b333629d752d7716b89b2295314e1a2e8f4`.
- Sandbox proxy denial is NOT an outage signal and is NOT a rollback trigger. Owner permits runner health/ready/canonical evidence and workflow expected-previous-canonical gate in place of unavailable local fetches. Keep that gate enabled, expecting `dpl_F4E5kVXqpYuhQjcQSDP49ViJJvpK` / `f63c785e8af1d63f3d27754c66709e6a0d9b3443`.
- Dispatch capability blocker: `gh api repos/godzillazzz/SMS-v3/actions/workflows` returns Forbidden; removing inherited GH_TOKEN leaves no logged-in GitHub account. Available GitHub connector tools support reads/merges/reruns but no workflow dispatch. Managed environment reports no configured ready secrets/runtime identities. Normal Git transport is available but does not establish Actions API authorization. No credential values were printed or changed.
- Release-control mismatch found before dispatch: R1's `.github/releases/approved-production.json` still selects source `f63c785`, previous source `85a080c`, rollback `dpl_6vduk7ttKLL6sw2y5FDE6xYu42TY`, and an old Preview. `deploy-approved-production-v2.yml` creates a strictly verified Git-sourced immutable candidate, but must not be dispatched with that stale manifest for R1. No manifest fields were fabricated or changed. `deploy-production.yml` accepts R1 inputs and stage-only, but its prebuilt path does not by itself establish all DoD Git-source provenance gates; do not substitute a missing-provenance candidate.
- Phase E remains blocked before dispatch: no R1 workflow run/deployment/Environment request, no post-release E1–E3 results, and no Owner confirmation. Phase F must wait for explicit Owner message `R1 ผ่าน`; #475–#478 were not updated or merged. R2 workflow/deployment/G1–G4 are not started.
- Benchmark T22 is skipped as instructed; the 15-second criterion remains unmeasured before release.
- Production source remains `f63c785` according to Owner-provided facts; canonical association has not been independently re-verified this session. No deploy/promote/rollback, business-data mutation, or secret/env/schema change occurred.
- Rollback reference remains Owner-provided `dpl_F4E5kVXqpYuhQjcQSDP49ViJJvpK`, URL `https://sms-v3-staging-bgyhhtjad-godzillazz.vercel.app`, SHA `f63c785e8af1d63f3d27754c66709e6a0d9b3443`. Rollback only on runner health/ready/canonical failure or Owner instruction.
- Required continuation: an authorized workflow-dispatch channel and a governed release-control manifest/evidence matching R1, with exact Preview provenance and runner checks. No Environment approval is pending yet. Owner decision about October PENDING `G06 UAT` remains open; no schedule action was performed.

## Historical — R1 source merged; Production release not started (7 October 2026, 06:34 Bangkok / 6 October 2026, 23:34 UTC)

- Phase C ใช้วิธี update branch แบบ merge ตามคำสั่งล่าสุด: #474 head หลัง update `a6c46bfc324745b5e3b6900c1fce408075b37d01`, CI `37546460311` SUCCESS, และ Vercel Preview Ready: [deployment](https://sms-v3-staging-git-fix-ux-t05-schedule-approv-752411-godzillazz.vercel.app). Merge ปกติเป็น `60f6109a09eb8e27c5d8b83820d7df8014667ae5`.
- `R1_SHA=60f6109a09eb8e27c5d8b83820d7df8014667ae5`; `fd14d4557bb76bc02d81e0acb32829090595db89` เป็นบรรพบุรุษ. CI push ของ SHA นี้ `37546753747` SUCCESS; Vercel status บน SHA นี้ SUCCESS ที่ [Vercel deployment details](https://vercel.com/godzillazz/sms-v3-staging/5qew6AwyrzooDgGA8JXBfVrPPNHz). ไม่มี Prisma schema/migration diff ระหว่าง `f63c785` กับ R1_SHA.
- Vercel status ของ commit `f63c785e8af1d63f3d27754c66709e6a0d9b3443` เป็น SUCCESS และ URL รายละเอียดลงท้าย `F4E5kVXqpYuhQjcQSDP49ViJJvpK`, ตรงกับ deployment id ที่ handoff เดิมบันทึกเป็น `dpl_F4E5kVXqpYuhQjcQSDP49ViJJvpK`. หลักฐานนี้ยืนยัน Vercel deployment record ของ SHA ดังกล่าว; การผูก alias canonical กับ deployment id ยังไม่ได้ตรวจตรงผ่าน Vercel API.
- Production preflight `node scripts/ci/verify-health.js` ล้มด้วย `fetch failed`; direct request ถูก outbound proxy บล็อกด้วย HTTP 403. ดังนั้น canonical `/api/v1/health`, `/api/v1/ready`, หน้าเว็บ และ live alias/native SHA ยังไม่ได้ตรวจในงานนี้. ไม่มี Vercel CLI/token ใน workspace และ `gh` CLI ใช้ `GH_TOKEN` ที่ไม่ถูกต้อง; จึงยัง dispatch workflow จาก workspace นี้ไม่ได้.
- เวลาไทยขณะหยุดคือ 06:34 น. ซึ่งอยู่นอกช่วงปล่อย 10:00–16:00. ยังไม่ได้เริ่ม Production stage/deploy, promote, Environment approval หรือ rollback. E1–E3 ยังไม่ได้ตรวจหลังปล่อยเพราะไม่มีการปล่อย.
- Phase D: งด benchmark T22 ตามคำสั่ง; เกณฑ์ 15 วินาทียังไม่ถูกวัด. Phase F ยังไม่เริ่มเพราะต้องให้ R1 ผ่านก่อน.
- Production ยังเป็น SHA `f63c785` ตามข้อเท็จจริงที่เจ้าของระบบให้ไว้; ไม่มีการเขียน/ลบข้อมูลธุรกิจหรือแก้ secret/env/schema/migration.
- สถานะ handoff OPEN: R1_SHA และ CI พร้อม แต่ต้องตรวจ alias/health ผ่านเส้นทางที่เข้าถึง Vercel ได้ และเริ่ม workflow ภายในช่วงเวลาที่อนุญาต. ไม่มี Environment approval request ที่รออยู่.

### PR และ release evidence ณ เวลาหยุด

| PR | Head หลัง update | CI หลัง update | Merge commit | สถานะ |
|---|---|---|---|---|
| #474 | `a6c46bfc324745b5e3b6900c1fce408075b37d01` | `37546460311` SUCCESS | `60f6109a09eb8e27c5d8b83820d7df8014667ae5` | Merged; Vercel Preview Ready |
| #475 | ยังไม่ update; `116dd0a92b7377a2b570d09f144f8f3b4215cd61` | ยังไม่มี CI หลัง update | — | รอ R1 ผ่าน |
| #476 | ยังไม่ update; `b817d8a9eaa4c148c6541e2a399b3d5338732ab0` | ยังไม่มี CI หลัง update | — | รอ R1 ผ่าน |
| #477 | ยังไม่ update; `6b6a488462f2098f79d47cc7470ec968dbc98bfa` | ยังไม่มี CI หลัง update | — | รอ R1 ผ่าน |
| #478 | ยังไม่ update branch กับ integration; มี handoff-status commit(s) บน branch | ยังไม่มี CI หลัง update branch; CI `37506838166` SUCCESS บน head `9600e2fbd5a1c5071dc25016d3bf70652b9362bf` ก่อน handoff-status commit(s) | — | รอ R1 ผ่าน |

| Release | SHA | CI run | Production workflow | Deployment ID / เวลา | Post-release checks |
|---|---|---|---|---|---|
| R1 | `60f6109a09eb8e27c5d8b83820d7df8014667ae5` | `37546753747` SUCCESS | ยังไม่เริ่ม | — | E1–E3 ยังไม่ได้ตรวจ; ไม่มี rollback |
| R2 | ยังไม่ถึงขั้น | — | ยังไม่เริ่ม | — | G1–G4 ยังไม่ได้ตรวจ; ไม่มี rollback |

Rollback reference ตามข้อมูลเจ้าของระบบ: `https://sms-v3-staging-bgyhhtjad-godzillazz.vercel.app`, SHA `f63c785`, deployment ID ที่บันทึกไว้ `dpl_F4E5kVXqpYuhQjcQSDP49ViJJvpK`; Vercel status URL ของ commit นี้ตรงกับ suffix ของ deployment ID แต่ canonical alias mapping ยังไม่ได้ยืนยันตรงจาก Vercel API.

## Historical handoff status before update-branch method (6 October 2026, 17:50 UTC / 7 October 2026, 00:50 Bangkok)

- Owner-provided Production facts: `sms-v3-staging-ten.vercel.app` is live Production at `f63c785e8af1d63f3d27754c66709e6a0d9b3443` (`VERCEL_ENV=production`); `3ed0585567091e88135bdbc3f7087a589c30e7d4` was Preview only. The rollback URL for R1 is `https://sms-v3-staging-bgyhhtjad-godzillazz.vercel.app` at `f63c785`.
- Phase A: handoff facts corrected.
- Phase B complete: PR #479 pinned sharp to 0.35.5, made the Linux guard read an exact root `dependencies.sharp` pin, added mismatch/range tests, and corrected the Production workflow's schema/migration baseline from stale `70d1113` to the actual live source `f63c785`. Verified `f63c785..3ed0585` has no Prisma schema/migration diff. The two excluded workflows remain unchanged and still hard-code sharp 0.35.4: `.github/workflows/deploy-date-format-preview.yml` and `.github/workflows/one-time-g06-v4-staged-production.yml`; they are not the R1/R2 deploy/promote path.
- PR #479 head `839891cf7ef40202d5e5be303e3f67bfa03375d2`: CI `37505539698` SUCCESS; Preview READY: [deployment](https://sms-v3-staging-git-fix-maintenance-sharp-0-35-1c06ac-godzillazz.vercel.app); normal merge commit `fd14d4557bb76bc02d81e0acb32829090595db89`.
- CI on the new integration base `fd14d4557bb76bc02d81e0acb32829090595db89` also passed: run `37505866684`. Integration branch currently points to this SHA.
- Linux evidence after clean Node 22/npm 10 `npm ci`: sharp 0.35.5 and `@img/sharp-linux-x64/sharp.node` loaded; the Linux libvips binary resolved; root/frontend high-level audits found 0 vulnerabilities; focused Linux guard tests passed 8/8; frontend tests passed 835/835 and production build passed. Local root `npm test` had 1,254 pass / 24 fail due absent local test DB/config and PowerShell service; exact CI passed with its disposable test environment.
- No local Vercel CLI/artifact was available. The exact `.vercel/output --require-sharp-load` gate remains in the protected `deploy-production.yml` release workflow and must pass before promotion (fail-closed).
- Phase C stopped before rebasing #474. Its remote head `917e158dcf325481789595415bc9a65d1661cf37` is based on `3ed0585`; new base `fd14d45` is not its ancestor. Rebase would rewrite the published PR head and require a non-fast-forward update, which the task expressly forbids. No force-push or alternative PR/merge path was attempted. Phase C merge and dependent Phases D–G remain OPEN; no R1/R2 SHA exists.
- Phase D instruction is to skip T22 benchmarking; no benchmark was run, and the 15-second threshold remains unmeasured.
- No Production workflow, promotion, Environment review, rollback, or Production business-data mutation occurred in this run. Current Production is still reported as `f63c785`. Last documented Production deployment ID is `dpl_F4E5kVXqpYuhQjcQSDP49ViJJvpK` (from the 6 October release handoff); re-verify its live association before any future release.
- Owner decision: October Schedule item in `PENDING` with note `G06 UAT` is expected to appear in the bell after R1; Owner must decide how that pending item should be handled. No approval or business-data change was performed.
- Overall handoff state remains **OPEN** until an authorized no-force method for updating/replacing PR #474 is decided and the gated releases are completed.

### PR evidence at stop

| PR | SHA after rebase | CI run for this sequence | Merge commit | State |
|---|---|---|---|---|
| #479 | N/A — created from base `3ed0585` | `37505539698` SUCCESS | `fd14d4557bb76bc02d81e0acb32829090595db89` | Merged normally; Preview READY |
| #474 | Not rebased | Not run after rebase | — | Open; blocked by no-force rebase update |
| #475 | Not rebased | Not run after rebase | — | Open; Phase F not reached |
| #476 | Not rebased | Not run after rebase | — | Open; Phase F not reached |
| #477 | Not rebased | Not run after rebase | — | Open; Phase F not reached |
| #478 | Not rebased | Not run after rebase | — | Open; Phase F not reached |

### R1 / R2 release evidence at stop

| Release | SHA | CI run | Production workflow run | Deployment ID / time | Post-release checks |
|---|---|---|---|---|---|
| R1 | Not assigned; Phase C did not complete | — | Not started | — | E1–E4 not checked; no rollback |
| R2 | Not reached | — | Not started | — | G1–G5 not checked; no rollback |

Rollback reference is the owner-provided canonical target `https://sms-v3-staging-bgyhhtjad-godzillazz.vercel.app` at SHA `f63c785`. The 6 October handoff last recorded Production deployment ID `dpl_F4E5kVXqpYuhQjcQSDP49ViJJvpK` for that source; verify its live association before a future release.

### Owner decisions still open

- Resolve the no-force update path for PR #474 (for example, authorize a replacement PR/branch workflow in a future task). Do not force-update the existing remote PR branch under this task.
- Review the October Schedule item in `PENDING` with note `G06 UAT`; it is expected to appear in the bell after R1. No approval, cancellation, or data change was performed.

## สถานะก่อนงาน R1/R2 (ข้อมูลย้อนหลัง ณ 6 ตุลาคม 2569)

- Integration branch `fix/serverless-database-reliability` currently points to `fd14d4557bb76bc02d81e0acb32829090595db89` after PR #479; base CI `37505866684` passed. The earlier SHA `3ed0585567091e88135bdbc3f7087a589c30e7d4` had only a Vercel Preview deployment.
- Production URL `sms-v3-staging-ten.vercel.app` ซึ่งผู้ใช้จริงใช้งานยังรัน SHA `f63c785` (`VERCEL_ENV=production`). Canonical deployment/rollback target คือ `sms-v3-staging-bgyhhtjad-godzillazz.vercel.app` ที่ SHA `f63c785`.
- กติกางานล่าสุด: ห้ามเริ่ม Production release รอบใหม่หลัง 07:00 เวลาไทย; หากยังไม่เริ่มเมื่อถึงเวลา ให้หยุดที่พร้อมปล่อย. Rollback ฉุกเฉินทำได้ทุกเวลา.
- เฟส A: ปิดรายการที่ระบุใน #470 และ #471 โดยไม่เปิด PR ใหม่.
- เฟส B: merge #470 → #471 → #472 → #473 เข้า integration branch ตามลำดับ; CI หลัง rebase ผ่านทุก PR. Integration SHA มี Preview deployment เท่านั้น; ไม่ได้ปล่อย SHA นี้ไป Production.
- เฟส C: เปิด PR แยกตามลำดับ T05 → T01 → T02 → T03 → T06. #474–#477 ผ่าน CI และ Vercel Preview READY; ไม่ merge. #478 เปิดแล้วและ Preview READY บน implementation SHA `cf45f3aadbde45a8855ca055526e1e52503dcb81`; CI ถูกหยุดที่ dependency audit ก่อนเริ่ม tests/build เพราะ `sharp` เวอร์ชันใน base ต่ำกว่าเวอร์ชันแก้ CVE. จึงยังไม่ผ่านเงื่อนไข CI ของ T06.
- ณ เวลาที่อัปเดต handoff นี้ ยังไม่ได้ปล่อย Production, promote, แตะ Environment approval หรือเขียนข้อมูลธุรกิจลงฐานข้อมูล Production.

## เฟส A+B — PR ค้างและ integration

| PR | SHA ก่อน rebase | SHA หลัง rebase | CI หลัง rebase | Merged | Vercel Preview | Acceptance criteria |
|---|---|---|---|---|---|---|
| #470 | `80af2825a636f35cb5a3d1d6fe67b50efc631b80` | `26eeee832ea3e9cd0e6b0c171b46cd0680b9ac03` | `37457419185` ผ่าน | ใช่ — merge SHA `adb94c9135dbac9e0b94e3461869f7a7e8b20c10` | [READY](https://sms-v3-staging-git-fix-schedule-approval-stat-155f07-godzillazz.vercel.app) | ผ่าน: change type ครบ 12 labels; เหตุผลไม่อนุมัติหลัง trim ต้องยาวอย่างน้อย 5 ตัวอักษรและมี regression tests. |
| #471 | `739bb43590a89dbc696e4973d07bbbf90cc9ae6c` | `667666afc742df80aca1dac13dba666f47e240b4` | `37457947822` ผ่าน | ใช่ — merge SHA `da6b44d302abee0ff1dc5575164da03b966ea2ac` | [READY](https://sms-v3-staging-git-fix-schedule-department-ro-7ffe45-godzillazz.vercel.app) | ผ่าน: แถวแผนกเด่นและ sticky ในธีมสว่าง/มืด/print; ค่า department หลายค่าเช่น `AN1,AN2,AN3` คงเป็นค่าเดียวตามพฤติกรรมเดิม. |
| #472 | `06adee290b2fe2be4a359fdab2772a92d574f278` | `923447d7c7da6661463c64c2195dae01ad374cda` | `37458878815` ผ่าน | ใช่ — merge SHA `5a0fbe299bedd165a580995dc326b54e946aaaa3` | [READY](https://sms-v3-staging-git-fix-schedule-auto-preview-108969-godzillazz.vercel.app) | ผ่านจาก tests/build: preview คงข้อมูลเดิมและเติมเฉพาะช่องว่าง; path บันทึกไม่ลบ/แก้ assignment เดิม. |
| #473 | `2282dda340bef35ec830a46e53be5f7bd09a3a80` | `d8c8ad0706c5d7feb9b038c6dde8204f622c1235` | `37459833957` ผ่าน | ใช่ — merge SHA / integration base `3ed0585567091e88135bdbc3f7087a589c30e7d4` | [READY](https://sms-v3-staging-git-fix-schedule-batch-save-10-c701ee-godzillazz.vercel.app) | ผ่าน: batch save และ regression tests. เวลา 1,000 รายการยังไม่ได้วัดตามตัวเลือก (ข). |

สถานะ deployment หลัง Phase B: `3ed0585567091e88135bdbc3f7087a589c30e7d4` มี Preview deployment เท่านั้น. Production URL `sms-v3-staging-ten.vercel.app` ยังเป็น `f63c785` (`VERCEL_ENV=production`); canonical rollback target คือ `sms-v3-staging-bgyhhtjad-godzillazz.vercel.app` ที่ SHA เดียวกัน.

## เฟส C — PR แยกตาม task (ยังไม่ merge)

| Task | PR | SHA | CI | Vercel Preview | Acceptance criteria |
|---|---|---|---|---|---|
| T05 | #474 | `917e158dcf325481789595415bc9a65d1661cf37` | `37465310567` ผ่าน | [READY](https://sms-v3-staging-git-fix-ux-t05-schedule-approv-752411-godzillazz.vercel.app) | ผ่าน: นับเฉพาะ revision ล่าสุดและแสดงคิวอนุมัติตามประเภทคำขอ. |
| T01 | #475 | `116dd0a92b7377a2b570d09f144f8f3b4215cd61` | `37470176135` ผ่าน | [READY](https://sms-v3-staging-git-fix-ux-t01-loading-state-n-77d77f-godzillazz.vercel.app) | ผ่าน: loading state ผูกกับ page/query ปัจจุบันและไม่แสดงค่าค้าง. |
| T02 | #476 | `b817d8a9eaa4c148c6541e2a399b3d5338732ab0` | `37474817059` ผ่าน | [READY](https://sms-v3-staging-git-fix-ux-t02-attendance-page-e7112f-godzillazz.vercel.app) | ผ่าน: contrast และข้อความสถานะ/ข้อผิดพลาดภาษาไทย; mobile layout ผ่าน fixture. |
| T03 | #477 | `6b6a488462f2098f79d47cc7470ec968dbc98bfa` | `37482896586` ผ่าน | [READY](https://sms-v3-staging-git-fix-ux-t03-remove-dev-copy-dfd2f3-godzillazz.vercel.app) | ผ่าน: ลบข้อความ/การ์ด placeholder ที่ไม่มีความสามารถรองรับ; ตรวจ browser fixture ที่ 1366×768 และ 375×812. |
| T06 | #478 | `cf45f3aadbde45a8855ca055526e1e52503dcb81` (implementation SHA) | `37486534701` ไม่ผ่านที่ `npm audit`; tests/build ถูกข้าม | [READY](https://sms-v3-staging-git-fix-ux-t06-login-20261006-godzillazz.vercel.app) | ผ่านในเครื่อง: 839 frontend tests, build, browser smoke ที่ 1366×768/375×812, Lighthouse Accessibility 100. CI acceptance ยัง blocked. |

ทุก PR เฟส C ยังเปิดอยู่และไม่ merge.

## T22 benchmark

เลือกข้อ (ข): งด benchmark รอบนี้; เกณฑ์ 15 วินาทีรอวัดจากการใช้งานจริงบน staging. ไม่มีการสร้างหรือลบข้อมูลทดสอบในฐานข้อมูลใด.

## Blockers / การตัดสินใจจากเจ้าของระบบ

- T06 CI `37486534701` ล้มที่ root `npm audit --audit-level=high`: `sharp <0.35.5` มี high severity advisory `CVE-2026-96889` (`GHSA-wq5f-xc86-pv6w`). CI ยังไม่เริ่ม tests/build. ไม่มี package/dependency change ใน T06; ต้องตัดสินใจว่าจะอัปเดต dependency ในงานแยกหรือแก้ที่ base ก่อน จึงจะผ่าน CI gate ได้.
- T03 มีบันทึก G06 UAT ที่ระบุว่า owner-authorized test data ใช้สำหรับ demo; เจ้าของระบบต้องยืนยันข้อมูล UAT บน staging ก่อนมีการทดสอบข้อมูลจริง. ไม่มีการเขียน staging DB.
- T22 ไม่มี benchmark; เกณฑ์ 15 วินาทีรอวัดจากการใช้งานจริงบน staging ตามตัวเลือก (ข).
