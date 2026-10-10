# SMS-v3 — CURRENT PROJECT BACKLOG / ทะเบียนงานค้าง

**Snapshot:** 2026-10-09 (Asia/Bangkok), after R5-B protected Production SUCCESS.
**Source:** Latest GitHub PR/Issue status, `docs/ux-remediation/PLAN.md`, `MASTER_HANDOFF.md`, and GitHub/Vercel release evidence. This snapshot is not an automated continuously updating view.
**Update rule:** Always recheck GitHub status and Production alias before claims. Update this file in each batch PR after a meaningful task decision/merge, and add a short latest-status pointer at the **top** of `MASTER_HANDOFF.md`. Preserve historical detail; do not silently treat old checkpoints as current.

## Development-first checkpoint — 2026-10-10 (Asia/Bangkok)

Owner has deferred Final Hosted UAT, physical acceptance and complete business acceptance until feature freeze. Development proceeds from Integration `9abc97998f98265605f534de7874607a5f3b5a13`. PR #589/#590 stay unchanged and unmerged. Historical snapshots below remain evidence of their dates, not current priorities. Restricted `MASTER_HANDOFF.md` remains byte-identical to Integration in this reconciliation.

| Status | Work | Verified evidence / remaining action |
|---|---|---|
| BLOCKED | T08 | Owner Windows worktree `fix/t08-approval-details-1008` is unavailable in this managed runtime. No access to unpublished WIP, so no checkpoint or replacement claimed. Preserve work; no Schedule Revision Diff/schema/migration. Continue independent tasks. |
| COMPLETED DEVELOPMENT / READY FOR FINAL UAT | T30a / PR #556 | Reconciled latest Integration into existing feature history without force push, retaining R5-B release/application controls. Frontend 932/932 PASS; production build/bundle PASS (main 399943B, CSS 698900B). Synthetic browser initial full run 47 PASS / 3 FAIL; focused serial rerun of affected suites 7/7 PASS with unchanged assertions/code. Exact head `15861a0d2415afbc32e526d1096dc722db506020`: [Full CI 38008954862](https://github.com/godzillazzz/SMS-v3/actions/runs/38008954862) SUCCESS; Preview `dpl_53eVnBfezmMhPFspggTTMSSdcRBV` native SHA/ref/project READY, health/readiness/CORS PASS in CI. Merged as `e8cb6cbc40762c0a0d40ab595bffb0dc6670a0dd`; no Independent Approval claimed under Solo-Owner policy. |
| COMPLETED DEVELOPMENT / READY FOR FINAL UAT | T32 / PR #591 | Head `767b674cb45a7579eada99b604e60da534fc4477`; [Full CI 38009744926](https://github.com/godzillazzz/SMS-v3/actions/runs/38009744926) SUCCESS, frontend935 PASS, browser61 PASS /0 FAIL/0 SKIP; bundle budgets unchanged. Preview `dpl_2nPy487Q6d9GLMDJTcCDd8SZu1JG` exact SHA/ref/project READY, health/readiness/CORS PASS. Merged as `beabb62f50ec21ea57535e783d76beccf1f6b551`; no hosted/physical acceptance claimed. |
| COMPLETED DEVELOPMENT / READY FOR FINAL UAT | T33 / PR #592 | Exact head `cbad360d160f70c5593384e6943fcfcd21a1fea1`; [Full CI 38010605423](https://github.com/godzillazzz/SMS-v3/actions/runs/38010605423) SUCCESS; frontend939 PASS and browser66 PASS /0 FAIL/0 SKIP. Preview `dpl_GcfyBnnwgURxjsozZoshe2TiRZMT` native SHA/ref/project READY, CI health/readiness/CORS PASS. Merged `dfac6123a1754567828971a067419fa7d2af3ccc`. Historical first CI [38010353938](https://github.com/godzillazzz/SMS-v3/actions/runs/38010353938) FAILED: stale View As test boundary depended on removed Logo function. Fixed next-function boundary and complete-provider return assertion, preserving security assertions. |
| IN PROGRESS | T30b group 1 — Personnel | Four pages adopt PageHeader/SectionCard and semantic light/dark cards; shared MetricCard preserves loading state. Device StepFlow derives readiness from approved device, matching local key and supported capability; a replacement still requires review. API/RBAC/device/GPS/offline behavior unchanged. Browser16/16 PASS at1366/375 light/dark with fonts, every painted large-box radius/text insets, overflow and zero business writes; frontend939 PASS; build/bundle PASS main393584B/CSS699885B with unchanged budgets. Earlier browser failures exposed legacy spacing/precedence and were fixed in scoped presentation rules. Full local browser81 PASS /1 FAIL (cold lazy-login fixture timeout); unchanged affected accessibility suite serial rerun2/2 PASS. Key-state regressions also verify StepFlow never marks missing-key readiness or pending replacement review complete. Full exact-head CI/Preview pending publication. |
| IN PROGRESS | T30b groups 2–4 → T31 | Continue distinct roster/leave, attendance, system PRs before monthly report. No feature freeze, hosted or physical PASS claimed. |
| READY FOR FINAL UAT (acceptance only; audit pending) | Released License / Q13 / approval / roster contracts | Existing local/API/fixture results do not certify hosted business acceptance. Audit current source before classifying any remaining development defects. |
| BLOCKED | T18 | Sanitized current production latency/route telemetry unavailable; no speculative optimization. |
| IN PROGRESS | G06 / G07 / T19 / T20 / T24 | Inspect current source and old PRs to distinguish confirmed gaps from superseded code and final acceptance. |

No Production deployment, aliases, schema, accounts or business data were mutated. Production R5-B application remains `77641a2657aa4fd05276afe645dd32648f5cc56b`, deployment `dpl_Hjo1fTmgjEdmg5G7fZBX9gssenQP`; both canonical aliases were independently read this session. Final Hosted UAT is deferred, never replaced by CI. CI/Preview links and exact new PR head will be added as new evidence becomes available.

## 1. Current production and release boundary

- **Production:** R5-B LIVE. Official protected GitHub Production workflow [#37940068503](https://github.com/godzillazzz/SMS-v3/actions/runs/37940068503) completed SUCCESS on Integration Control SHA `0eb2b1cfc5b2bb47ff9a8cfcc67bced6b6290881`.
- **Frozen Application:** `77641a2657aa4fd05276afe645dd32648f5cc56b`; tree `f67e7a7a6895ca0fbbea8582543882feb36505b3`.
- **Canonical URL:** https://sms-v3-staging-ten.vercel.app; Vercel alias verified pointing to READY R5-B deployment `dpl_Hjo1fTmgjEdmg5G7fZBX9gssenQP`.
- **Rollback checkpoint:** previous R5-A deployment `dpl_HS3R7QJgKgJdL8DkiXncUHarVgPV`, READY. App rollback does not rewind legitimate runtime ShiftAssignment changes.
- **Production verification:** Official workflow completed with candidate/canonical runtime + CORS PASS, UI sentinels 23/23 PASS, no migration step executed, no automatic rollback triggered. This is **not** a substitute for authenticated business/physical UAT.
- **Policy:** No unsanctioned Production deploy/promotion/alias, migration or direct business-data writes. Any new batch requires its own frozen SHA, exact-head CI, Preview/UAT, official Manifest and explicit Owner Production authorization, with mandatory protected Human Environment Approval.

## 2. Main unfinished operational/business acceptance (priority P0/P1)

| Priority | Work | Current honest status | Closure criteria |
|---|---|---|---|
| P0 | G06/G06.1 Attendance: device binding, physical iPhone Home Screen/PWA, GPS/geofence, secure offline queue/sync | Existing runtime released; full physical/security acceptance **NOT VERIFIED**; local private key enrollment/remediation issue remains to resolve | Valid in-shift physical capture, device proof, geofence, offline/online replay and audit; preserve existing security controls |
| P0 | Employee License end-to-end | Local/API evidence exists; Hosted Browser upload/review/renewal **NOT EXECUTED** | Test isolated write-safe lifecycle, expiry/block/renewal/override/roster impacts and role/audit boundaries |
| P0 | Hosted Q13B/Q13C | **NOT EXECUTED** as hosted mutation workflows; previously accepted release exception | Authorized synthetic/disposable hosted business tests and documented results |
| P0 | Authenticated role UAT | [PR #87](https://github.com/godzillazzz/SMS-v3/pull/87) OPEN at head `ccb6b840…`; GitHub reports merge conflict, and the branch diverges from current Integration. Exact harness run [#37881179092](https://github.com/godzillazzz/SMS-v3/actions/runs/37881179092): `validate-uat-harness` PASS, full `validate` SKIPPED. Current PR role matrix contains ADMIN/MANAGER/VIEWER, not SUPERVISOR. Prior protected Preview UAT [#37874884949](https://github.com/godzillazzz/SMS-v3/actions/runs/37874884949) succeeded on Frozen App `77641a…` using older harness `0c03252…`; it does not validate current PR head or SUPERVISOR. Current secret values/state are not accessible through this read path. | Reconcile/port only reviewed harness code onto live Integration; add SUPERVISOR coverage and protected credential contract; run Full CI + exact Preview and protected UAT for all four roles. Do not execute current unmerged PR code with protected secrets. |
| P1 | Dual-entry native approvals / centralized hub | [Issue #551](https://github.com/godzillazzz/SMS-v3/issues/551) OPEN though R5-B code is deployed | Cross-entry consistency for all nine types, role visibility, count refresh/races, audited action/rejection and real browser acceptance |
| P1 | Classic Roster color/state labels / license impact | [Issue #552](https://github.com/godzillazzz/SMS-v3/issues/552) OPEN though R5-B contains corrections | Desktop/mobile light/dark production read-only acceptance; MANUAL, OVERRIDE, License Block provenance correct |
| P1 | License unattended cron / scheduled enforcement | Not certified by existing technical smoke | Verify safe scheduling, Bangkok date cutoffs, future-only reconciliation, alerts and rollback assumptions without modifying Production data as test |
| P1 | G07 Shift Master lifecycle | [Draft #113](https://github.com/godzillazzz/SMS-v3/pull/113) OPEN on old G06 feature base | Reconcile history, inactive/active UI + API, historic references and RBAC; no blind merge of obsolete branch |

**Scope decisions:** Face/QR are intentionally out of G06 simplified attendance scope. Preserve device binding, secure offline and GPS/geofence. Device moves require ADMIN and audit. Never change monthly ShiftAssignment/ScheduleApproval in Production to manufacture a test window; editing one assignment can invalidate an entire month's approval.

## 3. T-series task inventory (remaining and completed)

| Task(s) | Meaning | State at snapshot | Source / next step |
|---|---|---|---|
| T01–T07 | Initial UX, attendance form/Login, approval guards/count and approval hub | Released by R1/R2/R4 | Follow-up authenticated acceptance separate from deploy success |
| **T08** | Standard approval details for Leave/Device + Schedule metadata/month shortcut | **IN PROGRESS / LOCAL WORKTREE BLOCKED** | Owner Windows worktree `fix/t08-approval-details-1008` unpublished; preserve WIP, no schema or invented schedule diff; commit safe checkpoint before cloud review |
| T09–T17 | URL routing, personnel readiness, roster, settings, leave form, onboarding, Thai labels/dates and a11y | Released in R4 (some improved R5-A/B) | Verify real role/browser UX when relevant |
| **T18** | Backend/API latency | **BLOCKED — telemetry** | Obtain sanitized current p50/p95/max/5xx/top routes; measurement before optimization |
| **T19** | Dashboard dedupe + accurate KPI deep links | **DRAFT / BLOCKED** | [PR #530](https://github.com/godzillazzz/SMS-v3/pull/530) needs Owner-approved KPI/action → exact destination/query/filter mapping |
| **T20** | Reusable Playwright E2E | **PROPOSAL / NOT IMPLEMENTED IN FULL** | [PR #546](https://github.com/godzillazzz/SMS-v3/pull/546), reconcile #87 and approval of isolated fixture/write guard plan |
| T21–T23 | Department/employee sort; up to 1000 roster shifts; auto-assign existing-shift protections | Released R1 | T22 real under-15-second performance criterion still needs measurement |
| **T24** | API efficiency, DB connectivity/region/pooling | **PARTIAL** | Existing optimizations released; distinct-department load, current regional and Preview timing evidence pending |
| T25–T29 | Token reuse, Thai state/queue corrections, print A4 | Released R3/R4 | Spot-check production acceptance, no full reimplementation |
| **T30a** | Common PageHeader/SectionCard/StepFlow/MetricCard, 16/10-radius, fonts, light/dark | **DRAFT / CONFLICT** | [PR #556](https://github.com/godzillazzz/SMS-v3/pull/556) exact-head CI #37808613573 SUCCESS but **mergeable_state=dirty** against current Integration; reconcile without force-push and rerun exact CI/Preview |
| **T30b** | Apply unified layout to all pages in 4 batches with T15 text consistency | **NOT COMPLETE** | Personnel; roster/leave; punch/supervisor; system/dashboard/report/settings/public. Must preserve device/offline/GPS behavior |
| **T31** | Monthly timesheet A4 portrait, 1 employee/page | **NOT COMPLETE** | Approved template asset in repo; omit OT/allowances, 28–31 days, print only ADMIN and SUPERVISOR code roles; validate browser/PDF and API 403 for others |
| **T32** | Branded initial/PWA/offline/content loader | **NOT COMPLETE** | Light/dark logo source assets in `docs/ux-remediation/`; accessible splash before JS, reduced-motion, offline service-worker support |
| **T33** | Horizontal SMS brand in sidebar/mobile/PWA/Login/public | **NOT COMPLETE** | Approved light/dark images are in repo; use context-correct tone, retained links, accessible sizing |

Approved UX ordering from established plan: **T08 → T30a → T32 → T33 → T30b → T31** (T19, T18/T24 and T20 in parallel only after their own blockers are satisfied). Legacy ROADMAP ordering in `PLAN.md` reflects older R4/R5 planning; do not treat its historical 'current Production R3' line as fact.

## 4. Engineering, quality, operations and governance

| Work | Status / follow-up |
|---|---|
| Cloud-first release orchestration | [Issue #561](https://github.com/godzillazzz/SMS-v3/issues/561) OPEN; GitHub-only Owner dispatch path proven, general runbook/reusable fallback still requires closure. Khai Hub/owner PC not a cloud release prerequisite |
| Post R5-B Hypercare | Observe Health, Readiness, CORS, 5xx, auth/attendance/approval/license functional signals; incident/rollback plan. Production success not business UAT proof |
| T18/T24 measured optimization | Current latency/region evidence before any performance or schema/index changes; prior T24 implementation only partial |
| E2E and authenticated UAT | Coordinate #87 and #546; no real credentials in source/artifacts and no mutation on Production |
| Old GitHub PR review/cleanup | Review #408, #402, #130, #43, #112, #113, #35 against live Integration, close superseded only after evidence; never blind-merge stale feature code |
| Legacy operational Owner tracker | `docs/OWNER_REVIEW_ACTION_ITEM_TRACKER.md` records 5 OPEN: real data import criteria, backup owner, Production Go/No-Go package, Production notification change plan, notification credential evidence. Reconcile historical record to current operations instead of treating stale signoff as an R5-B blocker |

## 5. GitHub work queues at snapshot

**11 open PRs:** #87 (UAT V3), #556 (T30a), #546 (T20), #530 (T19), #408 (G06 local key), #402 (G06 preview diagnostic), #130 (View-As), #43 (Thai Buddhist date), #113 (G07 shift lifecycle), #112 (old G06 stabilization), #35 (database migration separation). Some old PRs are historical/obsolete; OPEN != unfinished deployable feature.

**4 open Issues:** #551 (Approval UX), #548 (Owner dispatch control **permanent mailbox**, not a bug), #561 (cloud-first orchestration), #552 (Roster). Do not close #548 merely to reduce ticket count.

**Current important drafts:** [#556](https://github.com/godzillazzz/SMS-v3/pull/556) is merge-conflicted, [#530](https://github.com/godzillazzz/SMS-v3/pull/530) requires filter mapping, [#546](https://github.com/godzillazzz/SMS-v3/pull/546) proposal-only, [#87](https://github.com/godzillazzz/SMS-v3/pull/87) open with conflict / missing accounts. Never assume old green CI is green on a newly reconciled head.

## 6. Ordered work plan and definition of done

1. **Business closure (P0)**: controlled authenticated/physical G06 attendance, Employee License lifecycle and hosted Q13B/Q13C. Add evidence per role and avoid Production writes during tests.
2. **UX backlog**: preserve/publish T08 WIP safely, reconcile T30a #556, then implement/verify T32 → T33 → T30b → T31 in isolated PRs.
3. **Quality/operations**: T20/#87 safe E2E; T18/T24 performance baselines; T19 filter contract; G07 architecture/legacy reconciliation; cloud-first workflow/runbook and unattended cron verification.
4. **Governance cleanup**: issue #551/#552 acceptance evidence, audit stale PRs before closure, reconcile five legacy operations tracker OPEN rows.

**Task status vocabulary:** `DEPLOYED`, `VERIFIED_BUSINESS_UAT`, `MERGED_NOT_DEPLOYED`, `DRAFT`, `BLOCKED`, `PARTIAL`, `NOT_EXECUTED`, `SUPERSEDED`. A successful CI, mocked test, Preview smoke or SKIPPED suite is **not** interchangeable with real authorized business acceptance.

**Session restart protocol:** Read this file FIRST, then newest header of `MASTER_HANDOFF.md`, then fetch current GitHub PR/Issues, latest Integration SHA / exact-head CI, Production alias, and protected workflow run. Mark any contradictions/stale data, do not invent state or reset unknown dirty worktrees. Write a fresh dated checkpoint after substantial changes; never overwrite historical evidence to hide failed gates.


## 7. Authenticated UAT and business acceptance matrix — 9 Oct 2026

This matrix records prior verified evidence and current gaps. A prior PASS does not make a different harness head or a skipped scenario pass.

| Workstream / scenario | Result | Evidence and closure gate |
|---|---|---|
| Authenticated Preview UAT — prior harness | PASS, limited to the recorded run | Protected Run [#37874884949](https://github.com/godzillazzz/SMS-v3/actions/runs/37874884949) succeeded against Frozen App `77641a2657aa4fd05276afe645dd32648f5cc56b` / Preview `dpl_6SxGPuH374ogrr2mjzwDkincaMCA`; harness was `0c03252f408bf2f39ff74264f13b35161a179c09`. It is historical evidence for that harness and run only. |
| ADMIN / MANAGER / VIEWER role matrix in open PR #87 | PARTIAL | Current PR source defines these three roles. Its focused harness validator passed on `ccb6b840…`; Full `validate` was SKIPPED. No current full-UAT run is bound to this PR head. |
| SUPERVISOR authenticated role | BLOCKED | SUPERVISOR is absent from PR #87 role/config matrix; no exact role UAT evidence is present. Add coverage and use an authorized role-specific account/secret. |
| G06 online iPhone/PWA and primary-device presentation | PARTIAL — owner evidence only | `docs/G06_PRODUCTION_PHYSICAL_ACCEPTANCE_20261005.md` records owner-supplied online Production iPhone/PWA evidence. This session did not repeat physical UAT or verify device identity independently. |
| G06 GPS/geofence enforcement | NOT EXECUTED in this session | Historical screen documents the flow; a controlled physical positive/negative geofence exercise is still required. |
| G06 secure offline queue/replay/sync | NOT EXECUTED physically | Automated contracts are not physical offline acceptance. Test with a controlled device and isolated approved test target. |
| G06 device replacement and ADMIN approval | NOT EXECUTED | Requires an authorized test role/account and isolated fixture; do not alter a Production device assignment for testing. |
| Employee License API lifecycle | PASS — isolated local API only | [Run #37881816337](https://github.com/godzillazzz/SMS-v3/actions/runs/37881816337): 77/77 synthetic disposable-DB API/integration tests PASS. This is not hosted Browser acceptance. |
| Employee License Browser / documents | PARTIAL; upload/review/renewal NOT EXECUTED | [Run #37885251975](https://github.com/godzillazzz/SMS-v3/actions/runs/37885251975): 2/2 local Chromium smoke tests on isolated fixtures. Hosted employee document upload, review, approval/rejection and renewal remain untested. |
| Q13B / Q13C hosted Preview mutation | BLOCKED / NOT EXECUTED | Local API and Browser evidence above is not hosted mutation acceptance. No isolated disposable Preview database target is verified; do not mutate the shared Preview or Production. |

**Next safe gate:** reconcile PR #87 from current Integration in a dedicated branch after reviewing its changed workflows and security boundaries; add all four role contracts. Before any protected-secret execution, require trusted reviewed workflow/harness code and exact-head CI/Preview. Physical UAT requires the authorized iPhone and approved isolated test account. Hosted Q13B/Q13C mutation remains blocked until a disposable Preview database is proven and its separate test scope is authorized.
