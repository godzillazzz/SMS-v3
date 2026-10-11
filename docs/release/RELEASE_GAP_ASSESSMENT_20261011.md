# SMS-v3 Release Gap Assessment — 2026-10-11

**Assessment status:** COMPLETE FOR RELEASE PLANNING; NO CANDIDATE IS APPROVED FOR PRODUCTION. This is a read-only assessment plus documentation. No Production deployment, dispatch, promotion, rollback, alias/configuration change, database operation, live Cron execution, shared-hosted mutation, or Hosted UAT was performed.

**Evidence timestamp:** 2026-10-11 11:57 Asia/Bangkok (04:57 UTC). GitHub was rechecked before this revision: Integration still points to `5b764d0d471ecd426c21e6043d6eb526a2e7780b`; PR #609 still targets that exact base.

## 1. Verified baselines

| Surface | Verified state | Evidence |
|---|---|---|
| Frozen Production source | SHA `77641a2657aa4fd05276afe645dd32648f5cc56b`; tree `f67e7a7a6895ca0fbbea8582543882feb36505b` | [GitHub commit](https://github.com/godzillazzz/SMS-v3/commit/77641a2657aa4fd05276afe645dd32648f5cc56b) |
| Production deployment | `dpl_Hjo1fTmgjEdmg5G7fZBX9gssenQP`, state READY, target `production`; Vercel metadata reports the frozen SHA above | [Deployment URL](https://sms-v3-staging-700wcjlov-godzillazz.vercel.app) |
| Production canonical aliases | `sms-v3-staging-ten.vercel.app` and `sms-v3-staging-godzillazzz.vercel.app` are attached to the frozen deployment | Read-only Vercel deployment alias listing for `dpl_Hjo1fTmgjEdmg5G7fZBX9gssenQP` |
| Integration | `fix/serverless-database-reliability` at `5b764d0d471ecd426c21e6043d6eb526a2e7780b`; tree `92a93bb35123509b69e76912a35734f2d8e05958`; 107 commits ahead / 0 behind Production | [GitHub commit](https://github.com/godzillazzz/SMS-v3/commit/5b764d0d471ecd426c21e6043d6eb526a2e7780b), [Production-to-Integration compare](https://github.com/godzillazzz/SMS-v3/compare/77641a2657aa4fd05276afe645dd32648f5cc56b...5b764d0d471ecd426c21e6043d6eb526a2e7780b) |
| Integration exact-head CI | Run `38104726470`, event `push`, conclusion SUCCESS; `validate` job SUCCESS. Unit, integration, Prisma, frontend, build, and Playwright steps succeeded. Preview health/readiness/CORS step was SKIPPED because this was a push run, not a PR run. | [CI run](https://github.com/godzillazzz/SMS-v3/actions/runs/38104726470) |
| Integration Vercel Preview | `dpl_Bgc6xgQECCkh6GZJYfwxnLdmbM6E`, READY, `target=null`, ref `fix/serverless-database-reliability`, exact SHA `5b764d0d471ecd426c21e6043d6eb526a2e7780b` | [Preview URL](https://sms-v3-staging-6oe8da8hr-godzillazz.vercel.app) |
| Trusted `main` | SHA `85f4707a3e3afc0ad65c90a9117410c6f742179c`; exact SHA CI run `38104061988` SUCCESS | [Main CI](https://github.com/godzillazzz/SMS-v3/actions/runs/38104061988) |
| Main ruleset | Repository ruleset ID `20230372`, name `main`, enforcement `active`, target `refs/heads/main`; PR required, approvals `0`, required check `validate`, deletion and non-fast-forward blocked, no bypass actor (`current_user_can_bypass=never`). | [Ruleset](https://github.com/godzillazzz/SMS-v3/rules/20230372) |
| Cloud-first operations | Issue `#561` is CLOSED. Read-only control run `38109986188` is SUCCESS at trusted-main SHA `85f4707…`; it is control evidence, not feature UAT. | [Issue #561](https://github.com/godzillazzz/SMS-v3/issues/561), [run](https://github.com/godzillazzz/SMS-v3/actions/runs/38109986188) |

The GitHub ruleset read is authoritative for `main`; it is a Solo-Owner rule with no independent approval requirement. That does not replace the separate Production Environment approval. The connected GitHub API rejected the repository `/environments` endpoint as unsupported, so environment reviewers and branch restrictions were not independently refreshed here. The Vercel Project read confirmed project `prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s`, current Preview identity and SSO settings, but did not return `productionBranch` or `autoAssignCustomDomains`; the Owner-reported values (`vercel-production-manual`, auto-assign disabled) remain Owner evidence, not a fresh API observation in this assessment.

The local base checkout was not used for edits. Read-only status still shows the pre-existing 559 staged deletions and untracked `.worktrees/` entry, plus existing worktrees including T08-related work; none were changed. The report is being written on a separate remote documentation branch.

## 2. Production-to-Integration gap

The GitHub compare is exact: **107 commits, 169 changed paths, Integration ahead by 107 and not behind**. Classification by path and reviewed content is 73 application files, 6 static assets, 74 test/fixture files, 7 governance/CI files, and 9 documentation files. The requested eight product groups account for the application/asset feature changes; the rest are tests, release-control changes, cloud-only operational checks, and documents.

**Schema:** no `prisma/schema.prisma`, `prisma/migrations/**`, or migration file is in the 169-path compare. `vercel.json` is byte-for-byte identical at Production and Integration. This proves there is no migration in this source delta; it does not prove live Production DB schema/data matches the checked-in Prisma schema. CI validates and exercises disposable databases only.

**Layer assessment:**

- **Frontend/shared UI:** PageHeader, SectionCard, MetricCard, StepFlow, tokens/theme, Dashboard, approval, attendance, personnel, report, settings, audit, data-quality, system-health and public/login/PWA surfaces change. `frontend/src/main.tsx` is touched by eight feature PRs; `styles.css`, shared layout components and the same page components are also shared conflict points.
- **Backend/API:** T19 adds authenticated read-only `GET /dashboard/details` plus matching server predicates, role/department scope and pagination. Leave guard adds authenticated read-only overlap preflight and repeats the overlap check in the leave-creation transaction under an employee row lock. T31 adds a read-only official attendance report endpoint/export.
- **Middleware/RBAC:** no file under `src/middlewares/` changes. Role enforcement is added/used at routes/services: dashboard roles and metric denial/scope; Attendance official report ADMIN/SUPERVISOR only and server-side supervisor department scope; Leave preflight binds VIEWER to own employee and checks manager/supervisor scope. No global authentication middleware change.
- **Cron:** four existing `vercel.json` schedules remain unchanged. Integration changes the License Reconciliation route to GET with exact `Authorization: Bearer $CRON_SECRET`, explicit GET-only method check, fail-closed when the secret is absent, and registration before user-JWT middleware. Vercel documents that Cron sends GET to the Production deployment URL and uses UTC; `5 17 * * *` is therefore 00:05 Asia/Bangkok. [Vercel Cron documentation](https://vercel.com/docs/cron-jobs)
- **Service Worker/PWA:** T32/T33 modify `frontend/public/sw.js` and bump cache versions in sequence; T32 caches only same-origin static branding/shell assets per PR scope, T33 adds horizontal logo assets. No business records are cached by these changes in the inspected diff. Real device update/offline lifecycle remains unverified.
- **Reporting:** T31 reads validated, certified Attendance month snapshots and checks certification metadata/digest. It does not certify, unlock, or mutate attendance records. Workbook and report endpoints are separately authorized.

### Changed files outside the eight product groups

The 7 governance/CI files contain: `.github/releases/approved-production.json`, the R5-A archive and R5-B draft manifests, `.github/workflows/cloud-preview-operations.yml`, `.github/workflows/r5b-readonly-release-preflight.yml`, and the two corresponding `scripts/ci/*.cjs` read-only controls. The new cloud Preview operation is issue-comment triggered and validates pinned CI/deployment identity, Preview health/readiness/CORS and unchanged canonicals; it does not authorize Production dispatch. The R5-B workflow is explicitly read-only (`GET`/`OPTIONS`) and checks the non-dispatchable draft. No Production deploy/promotion workflow was changed in this compare. These control files still expand the trusted-main operational surface and must be reviewed as part of a full-Integration release.

There are 9 documentation paths in the compare, including `MASTER_HANDOFF.md`. That file is restricted and was not edited during this assessment. Documentation-only PRs are not counted as product features.

### Hidden dependencies and conflict hot spots

- `frontend/src/main.tsx`: PRs #556, #591, #592, #593, #594, #596, #601, #602. The selected R6-B must apply only the first six relevant UI hunks and the #602 dashboard routing hunk from the frozen Production tree.
- `frontend/public/sw.js`: #591 and #592; the cache generation must remain monotonic and both asset sets travel together.
- Shared layout components: #556/#593/#594; attendance pages and browser contracts: #595/#596; DashboardPage: #596/#602; ReportCenterPage: #596/#597.
- `src/routes/operations.routes.js`: #601/#602/#604; `src/services/dashboard.service.js`: #602/#604. The same files contain distinct feature hunks, so copying either whole file from current Integration would import unrelated changes.
- #604 adds a new `security-guard-scope.service.js` and extracts the T19 relation predicate from `dashboard.service.js`; Cron uses the employee predicate for guard-only reconciliation. That extraction is a source-level overlap, not a runtime dependency on T19's Dashboard detail API. A Cron-only reconstruction can include the employee predicate and Cron service hunks without the dashboard-service extraction, but must retain and retest the original T19 scope contract if both candidates are composed.
- No schema migration is a hidden dependency in Git. Runtime use of existing fields and the live Production schema was not inspected against the database, by design.

### Selective R6-B dependency closure and shared-file audit

The **Selective R6-B Candidate** is reconstructed from frozen Production SHA `77641a2657aa4fd05276afe645dd32648f5cc56b`. Its complete feature set is #556 (T30a), #593–#596 (T30b), #591 (T32), #592 (T33), and #602 (T19). It explicitly excludes #601 (Leave Duplicate Guard), #604 (License Cron), and #597 (T31 / R6-C).

Dependency order and closure:

1. #556 supplies shared layout primitives required by the T30b layout PRs #593–#596.
2. #593, #594, #595, and #596 travel as the reconciled T30b page/layout set because they overlap in `main.tsx`, shared components/styles, attendance pages, and browser contracts.
3. #591 precedes #592: the splash/PWA assets and Service Worker cache version changes form one ordered asset/cache chain.
4. #602 travels with the #596 DashboardPage base and its own dashboard detail page, route/filter wiring, authenticated read-only API, and server-side query/count scope. Use the #602 patch's inline `securityGuardRelationScope` contract; do not take #604's later helper extraction as an implicit prerequisite.
5. #597 is excluded. Its Report Center and horizontal-logo dependencies (#596 and #592) are in R6-B; T31 remains a later R6-C candidate after that base.

Shared-file review was against each constituent PR diff, not the merged Integration file snapshot. In #602, the `operations.routes.js` hunk adds the authenticated, read-only `GET /dashboard/details` handler. Its `dashboard.service.js` hunks compute filtered dashboard summaries/details; they do not perform writes. The #602 diff contains no `/internal/license-reconciliation` route, `CRON_SECRET` handler, scheduled-service import, `reconcileAllEmployeeLicenseSchedules`, `expireDueLicenseDocuments`, or `cleanupDueLicenseDocuments`.

Those Cron GET/HEAD guards and the schedule/expiry/Storage cleanup calls are in #604's separate hunks. The employee-row lock, overlap preflight, and leave conflict response are in #601's separate hunks. Neither set is required to serve the selected #602 Dashboard details route. A generic `data-retention` Settings section remains in #596's frontend layout diff; it is an existing UI section selection, not the License Cron service or an invocation path.

Therefore the **current Full Integration SHA is not an R6-B-only release**: it already contains merged PR #601 and #604 in addition to all R6-B and R6-C features. Do not copy `operations.routes.js` or `dashboard.service.js` wholesale from Integration when building Selective R6-B. Apply the reviewed R6-B PR-specific hunks to the frozen Production source, then inspect the resulting exact tree for absence of #601/#604 routes, imports, and runtime side effects. No such reconstructed candidate tree has been built or tested yet; the patch audit establishes the intended closure, not final candidate CI/Preview evidence.

### Exact merged feature heads, merge commits, and CI

| Group | PR | Exact PR head → Integration merge SHA | Exact-head CI |
|---|---:|---|---|
| T30a | #556 | `15861a0d2415afbc32e526d1096dc722db506020` → `e8cb6cbc40762c0a0d40ab595bffb0dc6670a0dd` | [38008954862 SUCCESS](https://github.com/godzillazzz/SMS-v3/actions/runs/38008954862) |
| T30b personnel/licence/device/access | #593 | `b1d3bdce9a5e0994192064c71bdf3162a858db40` → `6d651315913647f4a38ff3fb560d6a5d892ff9ae` | [38012191258 SUCCESS](https://github.com/godzillazzz/SMS-v3/actions/runs/38012191258) |
| T30b roster/leave | #594 | `aec01ff3a4216edc8cd2518cdf1d3cc5c7e5cfbe` → `6b60219647d923e9d9cb76a12570ace03178729d` | [38017284288 SUCCESS](https://github.com/godzillazzz/SMS-v3/actions/runs/38017284288) |
| T30b attendance | #595 | `96a83fb6f3b4efa52168d8fb00575e98bd429b3d` → `d04dd19cb69a4a3b3c66a7cbaf2f26f11bdd1882` | [38018555424 SUCCESS](https://github.com/godzillazzz/SMS-v3/actions/runs/38018555424) |
| T30b system/dashboard/approval/report layouts | #596 | `e706b05321ac0b7fed61e3c76be71de513d90c10` → `321647e381e76819d78966ad9aa555cc12f80a66` | [38021214253 SUCCESS](https://github.com/godzillazzz/SMS-v3/actions/runs/38021214253) |
| T31 certified monthly timesheet/PDF | #597 | `63ba9204742cbc8218be220b841a835c20f6fa4b` → `451e667bf52541f9eba74383facbc5043c3936d2` | [38034542272 SUCCESS](https://github.com/godzillazzz/SMS-v3/actions/runs/38034542272) |
| T32 loading/offline splash | #591 | `767b674cb45a7579eada99b604e60da534fc4477` → `beabb62f50ec21ea57535e783d76beccf1f6b551` | [38009744926 SUCCESS](https://github.com/godzillazzz/SMS-v3/actions/runs/38009744926) |
| T33 horizontal SMS branding | #592 | `cbad360d160f70c5593384e6943fcfcd21a1fea1` → `dfac6123a1754567828971a067419fa7d2af3ccc` | [38010605423 SUCCESS](https://github.com/godzillazzz/SMS-v3/actions/runs/38010605423) |
| Leave duplicate guard | #601 | `08c4653a173b30c393eeee83d2945f223b8723f9` → `f6ecd99d2037725acf383791d8a7c3f225880a3d` | [38048242486 SUCCESS](https://github.com/godzillazzz/SMS-v3/actions/runs/38048242486) |
| T19 dashboard KPI deep links | #602 | `4d9b438bfc7ef7b64c4176321f1144e86f6ec6d5` → `2370e6000b5e6671d5935c897def92215f2214bb` | [38093645627 SUCCESS](https://github.com/godzillazzz/SMS-v3/actions/runs/38093645627) |
| License Cron contract | #604 | `85db9f6a3125422cdd151b05c6c9978040c8c8e9` → `1bde6d908098de97706f25d0ca7c0a259d7323d2` | [38098449395 SUCCESS](https://github.com/godzillazzz/SMS-v3/actions/runs/38098449395) |

All 11 exact PR-head `validate` jobs above completed SUCCESS with no failed or skipped job steps; the Preview health/readiness/CORS step was SUCCESS on those PR runs. This is development/PR evidence only. It does not make any batch approved or replace post-reconstruction CI, Hosted/Business/Physical acceptance, or Production Environment approval.

## 3. Release batch verification matrix

### Candidate R6-A — License Cron #604 + Leave Duplicate Guard #601

- **Included exact PRs/commits:** #601 head `08c4653a…`, merge `f6ecd99d…`, CI [38048242486](https://github.com/godzillazzz/SMS-v3/actions/runs/38048242486); #604 head `85db9f6a…`, merge `1bde6d9…`, CI [38098449395](https://github.com/godzillazzz/SMS-v3/actions/runs/38098449395).
- **Minimum dependency closure:** These are two independent behaviors and should not be treated as a single inseparable release. A Leave-only candidate needs the #601 create-transaction lock/conflict check, read-only overlap preflight and client flow. A Cron-only candidate needs the #604 Cron GET/HEAD/CRON_SECRET contract, guard-only employee predicate, Bangkok-date helper, schedule/expiry/Storage services and their tests. It does not require T19's Dashboard detail endpoint. Because #604's merged patch also extracts a predicate shared with #602 into `security-guard-scope.service.js`, construct Cron from its Cron-specific hunks; do not copy the Integration `dashboard.service.js` refactor as a Cron dependency.
- **Risk / blast radius:** HIGH for #604; LOW–MEDIUM for #601. Keep their release approvals and verification independent.
- **Runtime writes / reversibility:** #601 prevents overlapping PENDING/APPROVED/RETURNED_FOR_CORRECTION Leave requests by locking the employee row before checking conflicts. It still creates the normal accepted request/attachment/audit/quota records; rollback does not undo accepted requests. #604 is materially stateful: at 00:05 Bangkok it can update future ShiftAssignments for security-guard employees, write audit events, transition expired current license documents, and permanently remove storage objects for due documents. A code rollback cannot restore deleted files or reverse database writes.
- **Cron auth/date/guard-only evidence:** exact GET and Bearer CRON_SECRET; explicit HEAD/POST rejection; missing/untrusted secret and all four user JWT roles return 401 without invoking scheduled work; secret absence fails closed. `securityGuardEmployeeWhere` scopes to active/nondeleted guard employees. Bangkok inclusive expiry boundary is covered at 16:59:59Z versus 17:05Z (23:59:59 vs 00:05 Bangkok); daily schedule itself is 17:05Z. Disposable PostgreSQL regression verifies non-guard/inactive rows and approval state remain unchanged; no live Production Cron was invoked.
- **Leave duplicate/concurrency evidence:** mock regression verifies the raw employee-row lock is called before overlap detection, 409 on conflict, and read-only preflight. No actual two-connection/parallel PostgreSQL race test is present in the changed test set; this is a missing release regression for the feature’s concurrency guarantee. Role scoping is enforced in route code (VIEWER self-only, MANAGER/SUPERVISOR department approval policy) but should be covered by candidate-level authorization tests.
- **CI/Preview:** both exact PR CI runs and PR Preview health/readiness/CORS steps PASS. Current Integration preview is READY. No hosted Cron run, shared-hosted mutation, or actual Production CRON_SECRET verification was performed. Vercel Cron invocation is Production-only; deploying the GET route will activate the already configured schedule on the next eligible tick.
- **Hosted/Business/Physical gaps:** no unattended Cron observation against disposable hosted infrastructure; no protected-secret metadata or production setting verification; no signed business acceptance of license-driven schedule changes and irreversible file retention; no parallel real-DB leave race test. Physical acceptance is not applicable to Cron/Leave code, but end-user Leave acceptance remains absent.
- **Rollback:** route/code can be reverted; database schedule/document changes and object deletions are not automatically reversible. Capture a pre-release inventory/backup and define a stop/repair procedure before any real Cron activation.
- **Required gate:** keep Leave and Cron gates separate. Before Leave: exact Production-base candidate, role/department authorization coverage and a true concurrent disposable-DB race regression. Before Cron: exact Production-base candidate, GET/HEAD/secret/guard/date checks, disposable side-effect regression, final Preview readiness and explicit Owner acceptance of unattended schedule, document-expiry and permanent Storage-deletion effects. Verify the protected Production Environment approval before any eventual release. Never run the live Cron as a test.
- **Decision: HOLD.** Neither behavior is included in Selective R6-B. Full Integration also remains HOLD until both behaviors pass their own release gates.

### Candidate R6-B — Selective T30a/T30b + T32/T33 + T19

- **Included exact PRs:** #556, #593–#596, #591, #592, #602; exact heads/merge SHAs/CI are in Section 2. Explicitly **exclude #601, #604, and #597**.
- **Minimum dependency closure:** build the complete Selective R6-B closure from frozen Production as listed in Section 2: #556 before #593–#596; #591 before #592; #596 DashboardPage with #602 detail/API scope. #601 Leave guard, #604 License Cron and #597 T31 are outside this candidate.
- **Risk / blast radius:** MEDIUM–HIGH; broad UI/PWA surface and a new read-only dashboard endpoint, across employees, device, roster, leave, approvals, attendance, dashboard, reports, settings and system-health pages.
- **Runtime writes:** T19 details use GET/read-only server filters with totals before pagination; T30a/T30b/T32/T33 are presentation/static/PWA changes. Existing roster, leave, attendance, approval, device and security-site actions remain callable from the UI, so preserve existing RBAC/guards and verify the real role-specific mutation boundaries. The selected patch closure adds no Cron handler or License schedule/document/Storage mutation code. No schema change.
- **Security/RBAC:** T19 backend role and department scope tests exist; viewer self-scope and denied metric cases are checked. T30b PR descriptions/tests preserve existing device binding, GPS/geofence, offline-key and approval logic. No middleware source changed. End-user authorization across actual accounts, department data, mutation surfaces and all four roles is not yet UAT evidence.
- **Unit/integration/browser evidence:** all exact PR validation runs passed (backend tests/integration, frontend tests/typecheck/build); PR Preview readiness/health/CORS step passed for each. The current Integration SHA CI passed but its Preview step was skipped on push; a separate Vercel Preview deployment with exact SHA is READY. Browser tests are fixture-based Playwright, not authenticated hosted-role tests.
- **Missing/skipped checks:** one current Integration CI substep (PR Preview health/readiness/CORS) is SKIPPED because the workflow event was `push`; the exact current deployment metadata is READY but no CORS/readiness HTTP smoke at this current final SHA is evidenced here. No real desktop/mobile role walkthrough, four-role cross-scope test, physical PWA install/offline/update test, or Final Hosted UAT. No full exact-tree Selective R6-B candidate run exists.
- **Rollback:** code rollback is feasible, but Service Worker cache version changes can remain on clients until their next update/activation; validate cache cleanup/old-client behavior and avoid assuming alias rollback alone restores client state.
- **Hosted/Business/Physical gaps:** Final Hosted UAT remains deferred until Feature Freeze; Business and Physical acceptance are not inferred from fixture CI.
- **Required gate:** Feature Freeze; reconstruct from frozen Production SHA using only the reviewed PR-specific R6-B patches; inspect exact resulting tree to confirm no #601/#604 code/side effects; run full exact-head CI + Preview health/readiness/CORS on that exact tree; authenticated role/department UAT after disposable DB isolation and Environment approval; desktop/mobile/light/dark/PWA regression; confirm approval/roster/device/GPS/offline mutation contracts; fresh Production and Environment metadata before any separate release decision.
- **Decision: CONDITIONAL — RECOMMENDED SELECTIVE R6-B CANDIDATE, NOT READY FOR PRODUCTION.** This recommendation is specifically the frozen-Production reconstruction excluding #601/#604/#597. It is not the current Full Integration tree and does not authorize dispatch.

### Candidate R6-C — T31 Monthly Timesheet / PDF

- **Included exact PR:** #597 head `63ba9204742cbc8218be220b841a835c20f6fa4b`, merge `451e667bf52541f9eba74383facbc5043c3936d2`; CI [38034542272 SUCCESS](https://github.com/godzillazzz/SMS-v3/actions/runs/38034542272).
- **Minimum dependency closure:** R6-B shared layout/Report Center foundation (`#556`, T30b #596) and T33 horizontal SMS logo/assets (`#592`); T31 explicitly references `/brand/sms-logo-horizontal.webp` and modifies the Report Center changed by #596. Include the T31 change after its dependencies and test the combined print tree.
- **Risk / blast radius:** MEDIUM; read-only access to sensitive attendance and employee data, generated report/export and printed copy disclosure risk.
- **Authority/RBAC:** report requires a structurally valid certified Attendance snapshot and verifies its digest/metadata; report JSON permits ADMIN/SUPERVISOR only, supervisor rows/summary are scoped to persisted department, missing/mismatched scope fails closed; MANAGER/VIEWER denied. XLSX is ADMIN-only. No certification or DB mutation is performed by report GET.
- **Print evidence:** frontend unit tests cover 28/29/30/31 calendar lengths and an overnight check-in/out displayed on one Bangkok work date. Playwright fixture checks one employee/31-day month yields one portrait A4 page and a two-employee report yields two pages; it checks logo, columns, signatures and no shell chrome. Browser command matches `**/*.pw.ts`, so the T31 fixture is included in exact CI run #38034542272.
- **Missing/skipped checks:** browser-generated PDF geometry is directly asserted for 31 days, not for each 28/29/30-day PDF output; overnight date logic is unit-tested, not shown as a full exported-PDF boundary test. Save-as-PDF is exercised via Chromium PDF generation, not a human print dialog, a real printer, or iOS/Android print pipeline. No authenticated hosted role acceptance or physical-device acceptance.
- **Data writes / rollback:** read-only report/export; no schema migration. Code rollback is straightforward; already downloaded/printed exports cannot be recalled.
- **Required gate:** include R6-B dependencies, candidate exact-head CI/Preview, server-side 403 tests for all roles/scopes, inspect a certified snapshot in isolated UAT, browser PDF 28/29/30/31-day and overnight boundary coverage, Owner acceptance of report contents/privacy, and physical/browser Save-as-PDF checklist as applicable.
- **Decision: HOLD as a standalone release; CONDITIONAL after R6-B dependency closure and acceptance.**

## 4. Recommended release order

The corrected recommendation is **Selective R6-B from frozen Production**, not Full Integration. The current Integration source already contains #601 and #604, so it cannot serve as an R6-B-only artifact.

1. **Selective R6-B first** after Feature Freeze: reconstruct from frozen Production with #556, #593–#596, #591, #592 and #602 only; exclude #601, #604 and #597. Exact candidate CI, Preview and full acceptance gates remain outstanding.
2. **R6-C / T31 next** after Selective R6-B supplies the Report Center and #592 horizontal-logo dependencies. Validate the combined print candidate separately.
3. **Leave guard #601 separately** after Production-base reconstruction, scoped authorization coverage and a real concurrent disposable-DB race regression.
4. **License Cron #604 separately and last** after Cron-specific authorization/date/guard/side-effect tests and explicit Owner acceptance of unattended schedule, DB and irreversible Storage effects.
5. **Full Integration remains HOLD** until #601 and #604 each pass their own gates and every other candidate-level release/acceptance gate is complete. Its current SHA is broader than R6-B and includes R6-C plus cloud release-control changes.

Do not cherry-pick historical merge commits blindly or copy shared Integration files wholesale. Each candidate needs an exact source SHA, exact-head CI and Preview evidence, and the required Environment approval before any separate release decision.

## 5. Release architecture

### A. Minimum-diff Selective R6-B candidate from frozen Production — recommended

- **Source and closure:** begin at frozen Production SHA/tree `77641a…` / `f67e7a…`; apply only #556, #593–#596, #591, #592 and #602 feature hunks. Exclude #601, #604 and #597. This is the recommended release candidate shape; no candidate branch/tree has been created.
- **Reproducibility/conflicts:** exact source base is known, but the candidate has not been reconstructed. Shared `main.tsx`, layout, DashboardPage, `operations.routes.js` and `dashboard.service.js` overlaps mean whole-file copies or merge commits are unsafe. Use PR-specific hunks and record the resulting tree/SHA.
- **CI/Preview:** constituent PR-head CI/Preview evidence exists. No exact Selective R6-B candidate CI or Preview exists; both are mandatory after reconstruction and Feature Freeze.
- **Database compatibility:** no migration exists in the Integration source delta, but actual Production schema/runtime compatibility has not been checked. This candidate excludes Cron DB/Storage writes.
- **Rollback/security:** smaller blast radius than Full Integration. Service Worker cache changes may remain on client devices through update/activation; rollback of server code alone does not instantly restore old client caches. Preserve existing RBAC, approval, roster, device binding, GPS/geofence, and offline contracts.
- **Human approval:** any future Production release still requires the protected Production Environment approval and a separate Owner Production Release decision. This assessment did not initiate either.
- **Relative risk:** lower application/runtime blast radius than Full Integration, with higher reconstruction/conflict risk until the exact tree is built and validated. **Recommended planning direction; not approved or ready to deploy.**

### B. Full Integration candidate — HOLD

- **Exact contents:** Integration `5b764d…` contains the full feature stack, the cloud-first/read-only release-control changes, and both merged PR #601 (Leave Duplicate Guard) and #604 (License Cron), as well as #597 (T31). It is therefore **not R6-B-only**.
- **Reproducibility:** exact Integration source tree is known (`92a93b…`), 107 commits/169 paths ahead of frozen Production, and current Integration exact-head CI passes. It also has unrelated governance/documentation delta and broad shared-file changes.
- **CI/Preview:** constituent PR exact-head CI/Preview checks and Integration exact-head CI are evidence. The Integration push run skipped its inline Preview health/readiness/CORS step; a separate exact-SHA Preview deployment is READY, but no current final-SHA CORS/readiness smoke is recorded.
- **Database/runtime effects:** no schema/migration changed. Full Integration includes #604's unattended License Cron route and side effects, plus #601's write-path Leave guard. The Cron becomes active on the configured Production schedule when that code serves Production; schedule reconciliation, license expiry and object deletion are not undone by code rollback.
- **Rollback/security:** fewer cherry-pick conflicts than selective reconstruction but substantially greater application and operational blast radius. Code rollback does not reverse database writes or recreate deleted Storage objects.
- **Human approval:** requires protected Production Environment approval and the separate Owner Production Release decision. The Human Environment gate cannot be inferred from Integration CI or PR merge status.
- **Relative risk/decision:** HOLD until #601 and #604 pass their own independent release gates, followed by exact Full-Integration candidate validation and final Business/Hosted/Physical acceptance. Full Integration is a future broader alternative, not the recommended R6-B candidate.

## 6. Production effects and rollback caveats

No Production changes were performed by this assessment. Current Vercel reads still identify R5-B deployment `dpl_Hjo1fTmgjEdmg5G7fZBX9gssenQP`, SHA `77641a2657aa4fd05276afe645dd32648f5cc56b`, READY/production, with both canonical aliases attached. No deploy, promotion, rollback, alias mutation, environment setting, secret, database, schema, attendance, schedule, or business-data action occurred.

R6-A/#604 is the principal irreversible runtime risk: application rollback cannot reverse `ShiftAssignment` and license-document/audit DB writes or recreate objects permanently removed from storage. Vercel's existing Cron schedule means the fixed GET endpoint becomes unattended Production behavior as soon as that version serves Production. Deployment approval must therefore include operational ownership for its schedule, guard classification, retention policy, backup/recovery, alerts and stop/contain procedure.

The production alias list and deployment identity were read-only verified. Vercel Project settings did not expose Production Branch/auto-assign values through the current read; previously supplied Owner evidence says manual Production Branch `vercel-production-manual` and auto-assign disabled. Reconfirm those settings and the exact Environment reviewer rules at release time. GitHub active main ruleset ID `20230372` requires PR + `validate`, with zero approvals; an Owner merge/sign-off under that ruleset must not be represented as an independent security review.

## 7. Explicit Owner decisions before any Production release

1. The recommended planning direction is Architecture A: Selective R6-B reconstructed from frozen Production and excluding #601/#604/#597. Full Integration (Architecture B) remains HOLD; its eventual use requires both #601 and #604 release gates plus full candidate acceptance.
2. Decide whether the License Cron’s automatic future-shift changes, license-document expiry timing, and permanent storage deletion are approved business behavior. Keep #604 out until this is explicit; deployment will activate the existing daily schedule.
3. Decide if Leave guard ships separately or alongside R6-B; require a genuine concurrent disposable-DB test before accepting its concurrency guarantee.
4. Approve final Hosted/Business/Physical acceptance after Feature Freeze and require disposable DB isolation before any authenticated or mutating UAT.
5. Before a release action, re-read Vercel Production Branch/custom-domain auto-assignment, confirm Production and Environment gates/reviewers, obtain the protected Environment approval, and issue a separate Owner Production Release authorization. None is granted by this planning request.

## 8. Evidence links and status semantics

- Current Integration compare: https://github.com/godzillazzz/SMS-v3/compare/77641a2657aa4fd05276afe645dd32648f5cc56b...5b764d0d471ecd426c21e6043d6eb526a2e7780b
- Exact current Integration CI: https://github.com/godzillazzz/SMS-v3/actions/runs/38104726470
- Exact current Integration Preview: https://sms-v3-staging-6oe8da8hr-godzillazz.vercel.app (`dpl_Bgc6xgQECCkh6GZJYfwxnLdmbM6E`, READY, exact SHA `5b764d…`)
- Frozen Production deployment: https://sms-v3-staging-700wcjlov-godzillazz.vercel.app (`dpl_Hjo1fTmgjEdmg5G7fZBX9gssenQP`, READY, frozen SHA `77641a…`)
- Main ruleset: https://github.com/godzillazzz/SMS-v3/rules/20230372

SUCCESS on a development CI run is not Hosted/Business/Physical acceptance, Production compatibility proof, or deployment approval. SKIPPED and UNVERIFIED evidence is listed as such above.

## Appendix A — Exact 107-commit Production-to-Integration inventory

- [ef5c753a8a93ecfe3be912ea00bf03f4dbe414b6](https://github.com/godzillazzz/SMS-v3/commit/ef5c753a8a93ecfe3be912ea00bf03f4dbe414b6) — feat(ui): add T30a shared layout foundation with verified theme and accessibility
- [cf8f4f7024fa8926e7b18a410dbca955ff233eb5](https://github.com/godzillazzz/SMS-v3/commit/cf8f4f7024fa8926e7b18a410dbca955ff233eb5) — release(r5b): stage non-dispatchable manifest with accepted alternate evidence and explicit STOP gates
- [37edc8c4ef2e484830c2ce57e8ee4376e2092081](https://github.com/godzillazzz/SMS-v3/commit/37edc8c4ef2e484830c2ce57e8ee4376e2092081) — test(r5b): enforce non-dispatchable production draft and alternate acceptance coverage
- [1da9bd05007ec8ced34cdc0a613210107ddc54c7](https://github.com/godzillazzz/SMS-v3/commit/1da9bd05007ec8ced34cdc0a613210107ddc54c7) — ci(r5b): add safe no-credentials read-only readiness and CORS runtime probe
- [9f90e7e2a321595217da19b45b2e51ece5f39e93](https://github.com/godzillazzz/SMS-v3/commit/9f90e7e2a321595217da19b45b2e51ece5f39e93) — ci(r5b): read-only canonical and Preview readiness gate without any deployment authority
- [9701ee23fa37f3ae44c51c2f1f18fc20c3723a1d](https://github.com/godzillazzz/SMS-v3/commit/9701ee23fa37f3ae44c51c2f1f18fc20c3723a1d) — docs(r5b): preserve Owner alternate acceptance exceptions and explicit production STOP gates
- [0fdd6261f9945aa2b8eed9dfe3902238a7b16cec](https://github.com/godzillazzz/SMS-v3/commit/0fdd6261f9945aa2b8eed9dfe3902238a7b16cec) — ci(r5b): restrict scoped runtime preflight to GET and OPTIONS only
- [91a1ee36583341142357a40f05400232256e2b85](https://github.com/godzillazzz/SMS-v3/commit/91a1ee36583341142357a40f05400232256e2b85) — test(r5b): verify read-only probe allowlist, no mutation methods and strict response guards
- [f527ba6a2d64389d931ef00af1bae3f8d71f39d1](https://github.com/godzillazzz/SMS-v3/commit/f527ba6a2d64389d931ef00af1bae3f8d71f39d1) — ci(r5b): emit status-only preview diagnostic without response bodies or URLs
- [c4e88bcc5c12bc498a6262aa2fb1dc7922ef386d](https://github.com/godzillazzz/SMS-v3/commit/c4e88bcc5c12bc498a6262aa2fb1dc7922ef386d) — release(r5b): record Production PASS and protected Preview fresh-check STOP without changing deploy authority
- [b9a487d127a5002a73c69a950ff486764f27575f](https://github.com/godzillazzz/SMS-v3/commit/b9a487d127a5002a73c69a950ff486764f27575f) — release(r5b): record Production PASS and protected Preview fresh-check STOP without changing deploy authority
- [eddc5903c6e1ccdbcd9d559176ca17368e758dfc](https://github.com/godzillazzz/SMS-v3/commit/eddc5903c6e1ccdbcd9d559176ca17368e758dfc) — release(r5b): record Production PASS and protected Preview fresh-check STOP without changing deploy authority
- [3e5e553c78a97a137d20d17ff6ab6d76d279ebf1](https://github.com/godzillazzz/SMS-v3/commit/3e5e553c78a97a137d20d17ff6ab6d76d279ebf1) — release(r5b): refresh draft manifest evidence without dispatch authority
- [fefe526a49f8fc17a77d4ef5962f6aa4c30687b1](https://github.com/godzillazzz/SMS-v3/commit/fefe526a49f8fc17a77d4ef5962f6aa4c30687b1) — release(r5b): record verified protected Vercel config in non-dispatchable draft
- [e3ff848f0b5aa0e8f15887bef02ce81e6a9b165b](https://github.com/godzillazzz/SMS-v3/commit/e3ff848f0b5aa0e8f15887bef02ce81e6a9b165b) — release(r5b): finalize non-dispatchable control evidence
- [7639791a0fd2cad89799657c8e0b442ac74a159e](https://github.com/godzillazzz/SMS-v3/commit/7639791a0fd2cad89799657c8e0b442ac74a159e) — docs(r5b): record exact protected Preview Technical Smoke and CORS evidence in draft manifest
- [8c1d65e7fa7c74eeb2d779eaec2bd75d8dc44774](https://github.com/godzillazzz/SMS-v3/commit/8c1d65e7fa7c74eeb2d779eaec2bd75d8dc44774) — merge: reconcile R5-B draft control with current integration
- [679db42b9a593a9a280a6984f3ec75b468ab4650](https://github.com/godzillazzz/SMS-v3/commit/679db42b9a593a9a280a6984f3ec75b468ab4650) — docs(handoff): update R5-B release governance checkpoint
- [06cfb4805af5fc7c4ea4ac93c00da3749d7793ca](https://github.com/godzillazzz/SMS-v3/commit/06cfb4805af5fc7c4ea4ac93c00da3749d7793ca) — merge(r5b): integrate audited draft release control evidence (#581)
- [676d36b4aec860383979c69662adb5081d2ffa40](https://github.com/godzillazzz/SMS-v3/commit/676d36b4aec860383979c69662adb5081d2ffa40) — docs(release): archive exact R5-A Production manifest before R5-B proposal
- [eb89d443426a839b896465b2733340fa62eb4d43](https://github.com/godzillazzz/SMS-v3/commit/eb89d443426a839b896465b2733340fa62eb4d43) — release(r5b): stage official Production decision manifest only in unmerged PR
- [87640d8d8c6396d63e099be7a4a50879f4074458](https://github.com/godzillazzz/SMS-v3/commit/87640d8d8c6396d63e099be7a4a50879f4074458) — test(release): preserve R5-A archive coverage and validate staged R5-B official decision manifest
- [9cf4e50c13ee18dfd9984a8840a926e01c708b88](https://github.com/godzillazzz/SMS-v3/commit/9cf4e50c13ee18dfd9984a8840a926e01c708b88) — test(r5b): distinguish rejected draft from unmerged official decision proposal
- [0a46e8a84b5a02eb519d18dabd9a05ad53bcf8a6](https://github.com/godzillazzz/SMS-v3/commit/0a46e8a84b5a02eb519d18dabd9a05ad53bcf8a6) — docs(r5b): prepare separate Owner Production decision handoff with no dispatch
- [afb1302d70b7f36fe920cdd9e46a51008ec5cfdb](https://github.com/godzillazzz/SMS-v3/commit/afb1302d70b7f36fe920cdd9e46a51008ec5cfdb) — test(release): retain R5-A attendance policy assertions against immutable archive
- [0eb2b1cfc5b2bb47ff9a8cfcc67bced6b6290881](https://github.com/godzillazzz/SMS-v3/commit/0eb2b1cfc5b2bb47ff9a8cfcc67bced6b6290881) — release(r5b): activate official Owner-decision manifest (#586)
- [2f7984a0cefb852a21d3fa75d2b667b127b19910](https://github.com/godzillazzz/SMS-v3/commit/2f7984a0cefb852a21d3fa75d2b667b127b19910) — docs(project): create canonical current backlog and session resume protocol after R5-B
- [19f2109f911808df9c010a7c8bda36196236bcae](https://github.com/godzillazzz/SMS-v3/commit/19f2109f911808df9c010a7c8bda36196236bcae) — docs(project): establish canonical SMS-v3 backlog
- [9abd151801e26cd3f139618bd397b76e8fc04f36](https://github.com/godzillazzz/SMS-v3/commit/9abd151801e26cd3f139618bd397b76e8fc04f36) — docs(uat): reconcile authenticated UAT evidence and open gaps
- [9abc97998f98265605f534de7874607a5f3b5a13](https://github.com/godzillazzz/SMS-v3/commit/9abc97998f98265605f534de7874607a5f3b5a13) — docs(project): reconcile authenticated UAT evidence
- [15861a0d2415afbc32e526d1096dc722db506020](https://github.com/godzillazzz/SMS-v3/commit/15861a0d2415afbc32e526d1096dc722db506020) — fix(t30a): reconcile layout foundation with current R5-B integration
- [e8cb6cbc40762c0a0d40ab595bffb0dc6670a0dd](https://github.com/godzillazzz/SMS-v3/commit/e8cb6cbc40762c0a0d40ab595bffb0dc6670a0dd) — Merge pull request #556 from godzillazzz/feature/t30a-layout-foundation-1008
- [767b674cb45a7579eada99b604e60da534fc4477](https://github.com/godzillazzz/SMS-v3/commit/767b674cb45a7579eada99b604e60da534fc4477) — feat(ui): T32 accessible branded loading and offline splash
- [beabb62f50ec21ea57535e783d76beccf1f6b551](https://github.com/godzillazzz/SMS-v3/commit/beabb62f50ec21ea57535e783d76beccf1f6b551) — Merge pull request #591 from godzillazzz/feature/t32-branded-loading-20261010
- [29df9b4112560a4b20a8fbe7366b555ca887eb6d](https://github.com/godzillazzz/SMS-v3/commit/29df9b4112560a4b20a8fbe7366b555ca887eb6d) — feat(ui): T33 approved horizontal brand across all six surfaces
- [cbad360d160f70c5593384e6943fcfcd21a1fea1](https://github.com/godzillazzz/SMS-v3/commit/cbad360d160f70c5593384e6943fcfcd21a1fea1) — test(ui): preserve View As source checks after approved brand extraction
- [dfac6123a1754567828971a067419fa7d2af3ccc](https://github.com/godzillazzz/SMS-v3/commit/dfac6123a1754567828971a067419fa7d2af3ccc) — Merge pull request #592 from godzillazzz/feature/t33-horizontal-brand-20261010
- [b1d3bdce9a5e0994192064c71bdf3162a858db40](https://github.com/godzillazzz/SMS-v3/commit/b1d3bdce9a5e0994192064c71bdf3162a858db40) — feat(T30b): unify personnel layouts and truthful device workflow states
- [6d651315913647f4a38ff3fb560d6a5d892ff9ae](https://github.com/godzillazzz/SMS-v3/commit/6d651315913647f4a38ff3fb560d6a5d892ff9ae) — Merge pull request #593 from godzillazzz/feature/t30b-personnel-layout-20261010
- [fd3556adc26fe97766b09292bb6892ab23719c92](https://github.com/godzillazzz/SMS-v3/commit/fd3556adc26fe97766b09292bb6892ab23719c92) — feat(T30b): unify roster and leave page layouts
- [399b7e8d25467681478cbf94767fc7ee7c2b8baf](https://github.com/godzillazzz/SMS-v3/commit/399b7e8d25467681478cbf94767fc7ee7c2b8baf) — docs(T30b): record verified roster and leave results
- [aec01ff3a4216edc8cd2518cdf1d3cc5c7e5cfbe](https://github.com/godzillazzz/SMS-v3/commit/aec01ff3a4216edc8cd2518cdf1d3cc5c7e5cfbe) — fix(T30b): preserve roster browser behavior after section layout
- [6b60219647d923e9d9cb76a12570ace03178729d](https://github.com/godzillazzz/SMS-v3/commit/6b60219647d923e9d9cb76a12570ace03178729d) — Merge pull request #594 from godzillazzz/feature/t30b-roster-leave-layout-20261010
- [96a83fb6f3b4efa52168d8fb00575e98bd429b3d](https://github.com/godzillazzz/SMS-v3/commit/96a83fb6f3b4efa52168d8fb00575e98bd429b3d) — feat: align attendance pages with shared layout
- [a264698a79f487d171b6c28e15d095b56d439751](https://github.com/godzillazzz/SMS-v3/commit/a264698a79f487d171b6c28e15d095b56d439751) — feat: apply T30b system layouts
- [a1f9404ad45400690203ac9f825ccd76d3cc6f16](https://github.com/godzillazzz/SMS-v3/commit/a1f9404ad45400690203ac9f825ccd76d3cc6f16) — fix: correct system layout entrypoint blob
- [1a2a18d0610f5d34961439a83c9af761190c055d](https://github.com/godzillazzz/SMS-v3/commit/1a2a18d0610f5d34961439a83c9af761190c055d) — test: lock semantic approval center layout
- [6194ba5aeaaf74fed321210d27296e31a362b9c8](https://github.com/godzillazzz/SMS-v3/commit/6194ba5aeaaf74fed321210d27296e31a362b9c8) — fix: meet light dashboard contrast threshold
- [e706b05321ac0b7fed61e3c76be71de513d90c10](https://github.com/godzillazzz/SMS-v3/commit/e706b05321ac0b7fed61e3c76be71de513d90c10) — test: preserve Thai LINE settings contract
- [606ac7e40fc5fbe0b120136e81278e8065163c0d](https://github.com/godzillazzz/SMS-v3/commit/606ac7e40fc5fbe0b120136e81278e8065163c0d) — feat: add scoped monthly attendance timesheet
- [0b50a0522313c9ebeab3e683e16b7550a48ab1c7](https://github.com/godzillazzz/SMS-v3/commit/0b50a0522313c9ebeab3e683e16b7550a48ab1c7) — docs: refresh release backlog blockers
- [03184413097fadb6b35ca8b1292b2a3ebc945201](https://github.com/godzillazzz/SMS-v3/commit/03184413097fadb6b35ca8b1292b2a3ebc945201) — fix: isolate T31 print regression fixture
- [b3899fdeb61a868f046b63cdbda44f98d7fb4446](https://github.com/godzillazzz/SMS-v3/commit/b3899fdeb61a868f046b63cdbda44f98d7fb4446) — test: suppress native print in T31 fixture
- [8d347dad087ebda3536012ca97ce5c99fe584d5c](https://github.com/godzillazzz/SMS-v3/commit/8d347dad087ebda3536012ca97ce5c99fe584d5c) — docs: record T31 exact validation and blockers
- [d5879c02887a0ffd05623839f6d1831cd945f23c](https://github.com/godzillazzz/SMS-v3/commit/d5879c02887a0ffd05623839f6d1831cd945f23c) — feat: align T31 timesheet with Owner reference
- [8ac745c92c7fc535c43cf395aa61748d25c8cb7a](https://github.com/godzillazzz/SMS-v3/commit/8ac745c92c7fc535c43cf395aa61748d25c8cb7a) — docs: record T31 reference layout and validation
- [b52681db0b6de3d52aa56aa056b66bd6a470f6ea](https://github.com/godzillazzz/SMS-v3/commit/b52681db0b6de3d52aa56aa056b66bd6a470f6ea) — docs: record T30b and T31 integration safety gate
- [2ca1ffe439100f58a111efabcd81136fef978a28](https://github.com/godzillazzz/SMS-v3/commit/2ca1ffe439100f58a111efabcd81136fef978a28) — docs: fix live integration checkpoint formatting
- [5d9e5c01692772eee24a756685add2996b5d877e](https://github.com/godzillazzz/SMS-v3/commit/5d9e5c01692772eee24a756685add2996b5d877e) — docs: keep T31 code and head evidence distinct
- [d04dd19cb69a4a3b3c66a7cbaf2f26f11bdd1882](https://github.com/godzillazzz/SMS-v3/commit/d04dd19cb69a4a3b3c66a7cbaf2f26f11bdd1882) — Merge pull request #595 from godzillazzz/feature/t30b-attendance-layout-20261010
- [eeec89ce5d57c9f6d5f13b0760b1bce4f79ddf08](https://github.com/godzillazzz/SMS-v3/commit/eeec89ce5d57c9f6d5f13b0760b1bce4f79ddf08) — test: cover T31 month lengths and overnight times
- [321647e381e76819d78966ad9aa555cc12f80a66](https://github.com/godzillazzz/SMS-v3/commit/321647e381e76819d78966ad9aa555cc12f80a66) — Merge pull request #596 from godzillazzz/feature/t30b-system-layout-20261010
- [63ba9204742cbc8218be220b841a835c20f6fa4b](https://github.com/godzillazzz/SMS-v3/commit/63ba9204742cbc8218be220b841a835c20f6fa4b) — docs: refresh T30b and T31 integration checkpoint
- [451e667bf52541f9eba74383facbc5043c3936d2](https://github.com/godzillazzz/SMS-v3/commit/451e667bf52541f9eba74383facbc5043c3936d2) — Merge pull request #597 from godzillazzz/feature/t31-monthly-attendance-20261010-codex
- [f9262066b2697c3d8786c25aa1cbfb0f0f5088f9](https://github.com/godzillazzz/SMS-v3/commit/f9262066b2697c3d8786c25aa1cbfb0f0f5088f9) — docs: refresh T30b/T31 integration checkpoint
- [b54005a71bbb4df1172199bfa8269fdd700ab968](https://github.com/godzillazzz/SMS-v3/commit/b54005a71bbb4df1172199bfa8269fdd700ab968) — docs: add overnight execution report
- [8258320409a9cbb736101269d8c7ac1445e67bb2](https://github.com/godzillazzz/SMS-v3/commit/8258320409a9cbb736101269d8c7ac1445e67bb2) — docs: record current approval and roster implementation
- [dfa05ba579d39dee4db77bee86e1180b32a1626d](https://github.com/godzillazzz/SMS-v3/commit/dfa05ba579d39dee4db77bee86e1180b32a1626d) — docs: record source audit for open UX issues
- [e96ddd0942907c89ff3b964e05ce920d639b1814](https://github.com/godzillazzz/SMS-v3/commit/e96ddd0942907c89ff3b964e05ce920d639b1814) — Merge pull request #598 from godzillazzz/docs/overnight-t30b-t31-checkpoint-20261010
- [aca5a9af954fff830c2a2d21a583e10478599ecb](https://github.com/godzillazzz/SMS-v3/commit/aca5a9af954fff830c2a2d21a583e10478599ecb) — docs: propose exact T19 dashboard deep-link mapping
- [c1eb5fd65ecb97cc863f5688e858045ec9bace87](https://github.com/godzillazzz/SMS-v3/commit/c1eb5fd65ecb97cc863f5688e858045ec9bace87) — docs: record T08 and telemetry recovery blockers
- [cc23917959b7178a92b54caaf573ff8215b7b7db](https://github.com/godzillazzz/SMS-v3/commit/cc23917959b7178a92b54caaf573ff8215b7b7db) — docs: record T08 and T19 telemetry checkpoint
- [5cfbadbf4218c51a767bfeb0fab4939cb9328dc3](https://github.com/godzillazzz/SMS-v3/commit/5cfbadbf4218c51a767bfeb0fab4939cb9328dc3) — docs: correct T19 license scope and refresh backlog
- [91e2d0e2f1f533ac8e5c94fb6de9cee72b5526fd](https://github.com/godzillazzz/SMS-v3/commit/91e2d0e2f1f533ac8e5c94fb6de9cee72b5526fd) — docs: record limited live Production telemetry
- [8119eb787379e3d2453c2ffa473449060015f92e](https://github.com/godzillazzz/SMS-v3/commit/8119eb787379e3d2453c2ffa473449060015f92e) — docs(T19): correct license scope and telemetry checkpoint
- [850a7f6b675eb2220aa4d4ad28f844e84ddc499f](https://github.com/godzillazzz/SMS-v3/commit/850a7f6b675eb2220aa4d4ad28f844e84ddc499f) — feat(leave): serialize duplicate submissions and expose scoped overlap preflight
- [4ea0e85ba4ec41a5860445e19cd15882287b8305](https://github.com/godzillazzz/SMS-v3/commit/4ea0e85ba4ec41a5860445e19cd15882287b8305) — feat(leave): add authenticated date overlap preflight API client
- [75e4ec212b520e8659ea385a2d559f1b4e820b6c](https://github.com/godzillazzz/SMS-v3/commit/75e4ec212b520e8659ea385a2d559f1b4e820b6c) — feat(leave): warn on existing requests before submission and link to history
- [c906f1e1733719bd0490c96c729532b13df35886](https://github.com/godzillazzz/SMS-v3/commit/c906f1e1733719bd0490c96c729532b13df35886) — test(leave): verify duplicate preflight, 409 metadata and employee-lock guard
- [d575832060ffd20bf03ab4315ceeb84334add6f5](https://github.com/godzillazzz/SMS-v3/commit/d575832060ffd20bf03ab4315ceeb84334add6f5) — test(frontend): cover early leave duplicate warning and submit guard
- [96a3a8127fd37756efc16b7e0af3328dcba88ea3](https://github.com/godzillazzz/SMS-v3/commit/96a3a8127fd37756efc16b7e0af3328dcba88ea3) — fix(leave): preserve authorized central API contract and move preflight to isolated client
- [f347eff97b45108876bba7ffee31e246d6746f36](https://github.com/godzillazzz/SMS-v3/commit/f347eff97b45108876bba7ffee31e246d6746f36) — feat(leave): isolate authenticated duplicate-date preflight without changing central API
- [a82d2174de77d37fa2dd003b4dfbbe38eec9a28a](https://github.com/godzillazzz/SMS-v3/commit/a82d2174de77d37fa2dd003b4dfbbe38eec9a28a) — fix(leave): call isolated preflight rather than modify hash-locked API
- [08c4653a173b30c393eeee83d2945f223b8723f9](https://github.com/godzillazzz/SMS-v3/commit/08c4653a173b30c393eeee83d2945f223b8723f9) — test(leave): verify preflight is isolated from locked central API
- [f6ecd99d2037725acf383791d8a7c3f225880a3d](https://github.com/godzillazzz/SMS-v3/commit/f6ecd99d2037725acf383791d8a7c3f225880a3d) — Merge PR #601: guard against duplicate leave requests
- [e5c4f4ffec652506cf27cc1e3ce5b500dc606b0c](https://github.com/godzillazzz/SMS-v3/commit/e5c4f4ffec652506cf27cc1e3ce5b500dc606b0c) — feat(dashboard): add exact filtered KPI drill-downs
- [8d281634d4847e2727b5408de42a4a0591de8da9](https://github.com/godzillazzz/SMS-v3/commit/8d281634d4847e2727b5408de42a4a0591de8da9) — fix(dashboard): resolve drill-down build typing
- [3008440d0f41d1caccbf5fd638d07d3a27100ba2](https://github.com/godzillazzz/SMS-v3/commit/3008440d0f41d1caccbf5fd638d07d3a27100ba2) — fix(dashboard): require scoped department for pending users
- [17cba3cadd7edf798a8139601aa5b4526cccf15b](https://github.com/godzillazzz/SMS-v3/commit/17cba3cadd7edf798a8139601aa5b4526cccf15b) — test(dashboard): block unscoped pending-user drilldowns
- [cd2c94f3c9550525bcc7e9773b467824b9c0875c](https://github.com/godzillazzz/SMS-v3/commit/cd2c94f3c9550525bcc7e9773b467824b9c0875c) — test(frontend): refresh reviewed API integrity fingerprint
- [97c94311768b37ad90142569ac6114b4ced2d139](https://github.com/godzillazzz/SMS-v3/commit/97c94311768b37ad90142569ac6114b4ced2d139) — perf(dashboard): lazy load T19 detail route
- [c33efa30d05816ab13e6f98ca07df9e89adc14b8](https://github.com/godzillazzz/SMS-v3/commit/c33efa30d05816ab13e6f98ca07df9e89adc14b8) — perf(dashboard): split dashboard route from app shell
- [64cd7fac16b7d05d517f666a8e101fdae6f46ca7](https://github.com/godzillazzz/SMS-v3/commit/64cd7fac16b7d05d517f666a8e101fdae6f46ca7) — perf(frontend): defer license document UI code
- [3a3ad2e9ae52532e1ee89a552455c3b63392c8d3](https://github.com/godzillazzz/SMS-v3/commit/3a3ad2e9ae52532e1ee89a552455c3b63392c8d3) — docs(backlog): record T19 exact-head Preview blocker
- [4d9b438bfc7ef7b64c4176321f1144e86f6ec6d5](https://github.com/godzillazzz/SMS-v3/commit/4d9b438bfc7ef7b64c4176321f1144e86f6ec6d5) — test(leave): use future dates in browser fixtures to avoid retroactive guards
- [2370e6000b5e6671d5935c897def92215f2214bb](https://github.com/godzillazzz/SMS-v3/commit/2370e6000b5e6671d5935c897def92215f2214bb) — Merge PR #602: T19 Dashboard Deep Link
- [a30d4061125c38423e2d5a358192edecef4930e8](https://github.com/godzillazzz/SMS-v3/commit/a30d4061125c38423e2d5a358192edecef4930e8) — docs: record T08 and performance checkpoint
- [eafa57a7e19ee695695a35c93a5152ab4202ad6e](https://github.com/godzillazzz/SMS-v3/commit/eafa57a7e19ee695695a35c93a5152ab4202ad6e) — Merge pull request #603 from godzillazzz/docs/t08-t18-t24-checkpoint-20261011
- [85db9f6a3125422cdd151b05c6c9978040c8c8e9](https://github.com/godzillazzz/SMS-v3/commit/85db9f6a3125422cdd151b05c6c9978040c8c8e9) — fix: align scheduled license reconciliation with secure GET Cron contract
- [1bde6d908098de97706f25d0ca7c0a259d7323d2](https://github.com/godzillazzz/SMS-v3/commit/1bde6d908098de97706f25d0ca7c0a259d7323d2) — Merge pull request #604 from godzillazzz/fix/license-cron-get-contract-20261011
- [c82c490c050d004f59a94026dd1dfd8081629f7e](https://github.com/godzillazzz/SMS-v3/commit/c82c490c050d004f59a94026dd1dfd8081629f7e) — docs: record verified License Cron integration and remaining live gates
- [e5e55663640627ae75d58721a82c38c70a1da2da](https://github.com/godzillazzz/SMS-v3/commit/e5e55663640627ae75d58721a82c38c70a1da2da) — Merge pull request #605 from godzillazzz/docs/license-cron-verification-20261011
- [da911922b2f5c51af546aca50e40c2bc4537c875](https://github.com/godzillazzz/SMS-v3/commit/da911922b2f5c51af546aca50e40c2bc4537c875) — ci(operations): reusable Owner cloud-only read-only Preview verification
- [f0f14669b651949304dbb0dd3a728dc8a378c81d](https://github.com/godzillazzz/SMS-v3/commit/f0f14669b651949304dbb0dd3a728dc8a378c81d) — ci(operations): enforce observed no-admin-bypass human Environment policy
- [1f02a7f87a7181c23beb71b03066c4c9ba7f0457](https://github.com/godzillazzz/SMS-v3/commit/1f02a7f87a7181c23beb71b03066c4c9ba7f0457) — Merge pull request #606 from godzillazzz/fix/cloud-first-preview-operations-20261011
- [03aca92faeff5d854f07812371e6f74259dd6f52](https://github.com/godzillazzz/SMS-v3/commit/03aca92faeff5d854f07812371e6f74259dd6f52) — docs(operations): record verified cloud-first #561 gates
- [5b764d0d471ecd426c21e6043d6eb526a2e7780b](https://github.com/godzillazzz/SMS-v3/commit/5b764d0d471ecd426c21e6043d6eb526a2e7780b) — docs(operations): record cloud-first Issue #561 evidence

## Appendix B — Complete 169-path changed-file inventory

### Application (73)

- `frontend/index.html`
- `frontend/public/sw.js`
- `frontend/src/api.ts`
- `frontend/src/components/AppLoader.tsx`
- `frontend/src/components/AwardPublicExperience.tsx`
- `frontend/src/components/BrandLogo.tsx`
- `frontend/src/components/RuleCheckingDataSurfaces.tsx`
- `frontend/src/components/SecuritySiteManagementPanel.tsx`
- `frontend/src/components/app-loader.css`
- `frontend/src/components/audit/AuditPageHeader.tsx`
- `frontend/src/components/audit/AuditSummaryGrid.tsx`
- `frontend/src/components/brand-logo.css`
- `frontend/src/components/dashboard/AttentionNeededCard.tsx`
- `frontend/src/components/dashboard/LeaveSummaryCard.tsx`
- `frontend/src/components/dashboard/LicenseSummaryCard.tsx`
- `frontend/src/components/dashboard/TodayOperationsCard.tsx`
- `frontend/src/components/dashboard/deep-links.ts`
- `frontend/src/components/dashboard/types.ts`
- `frontend/src/components/layout/MetricCard.tsx`
- `frontend/src/components/layout/PageHeader.tsx`
- `frontend/src/components/layout/SectionCard.tsx`
- `frontend/src/components/layout/StepFlow.tsx`
- `frontend/src/components/layout/index.ts`
- `frontend/src/components/personnel/AttendanceReadinessCenter.tsx`
- `frontend/src/components/personnel/PersonnelDirectoryHeader.tsx`
- `frontend/src/components/personnel/PersonnelMetricCard.tsx`
- `frontend/src/leave-date-overlap-client.ts`
- `frontend/src/main.tsx`
- `frontend/src/pages/access-management/AccessManagementPage.tsx`
- `frontend/src/pages/access-management/RegistrationReviewPanel.tsx`
- `frontend/src/pages/approvals/ApprovalCenterPage.tsx`
- `frontend/src/pages/attendance-device/AttendanceDevicePage.tsx`
- `frontend/src/pages/attendance-simple/AttendanceSimplePage.tsx`
- `frontend/src/pages/attendance-simple/attendance-simple.css`
- `frontend/src/pages/attendance-supervisor/AttendanceSupervisorPage.tsx`
- `frontend/src/pages/attendance-supervisor/attendance-supervisor-v4.css`
- `frontend/src/pages/audit/AuditCompliancePage.tsx`
- `frontend/src/pages/dashboard/DashboardDetailsPage.tsx`
- `frontend/src/pages/dashboard/DashboardPage.tsx`
- `frontend/src/pages/data-quality/DataQualityCenterPage.tsx`
- `frontend/src/pages/personnel/PersonnelDirectoryPage.tsx`
- `frontend/src/pages/reports/AttendanceOfficialReport.tsx`
- `frontend/src/pages/reports/ReportCenterPage.tsx`
- `frontend/src/pages/reports/attendance-report-client.ts`
- `frontend/src/pages/settings/SettingsPage.tsx`
- `frontend/src/pages/system-health/SystemHealthPage.tsx`
- `frontend/src/routing.ts`
- `frontend/src/styles.css`
- `frontend/src/styles/approval-center.css`
- `frontend/src/styles/attendance-report.css`
- `frontend/src/styles/command-nexus.css`
- `frontend/src/styles/dashboard.css`
- `frontend/src/styles/data-surfaces.css`
- `frontend/src/styles/employee-pwa-theme.css`
- `frontend/src/styles/layout-foundation.css`
- `frontend/src/styles/operational-layer.css`
- `frontend/src/styles/personnel-layout.css`
- `frontend/src/styles/schedule-roster-ux.css`
- `frontend/src/styles/signature-experience.css`
- `frontend/src/styles/system-layout-group4.css`
- `frontend/src/styles/theme-foundation.css`
- `frontend/src/styles/ux-t06-login-public.css`
- `frontend/src/theme.ts`
- `frontend/vite.config.ts`
- `src/routes/attendance-governance.routes.js`
- `src/routes/operations.routes.js`
- `src/services/attendance-report.service.js`
- `src/services/dashboard-detail.service.js`
- `src/services/dashboard.service.js`
- `src/services/license-document-retention.service.js`
- `src/services/license-schedule-reconciliation.service.js`
- `src/services/security-guard-scope.service.js`
- `src/utils/bangkok-date.js`

### Static assets (6)

- `frontend/public/brand/sms-logo-dark.webp`
- `frontend/public/brand/sms-logo-horizontal-dark.webp`
- `frontend/public/brand/sms-logo-horizontal.webp`
- `frontend/public/brand/sms-logo-splash-dark.webp`
- `frontend/public/brand/sms-logo-splash.webp`
- `frontend/public/brand/sms-logo.webp`

### Tests (74)

- `frontend/e2e/attendance-layout/attendance-layout.pw.ts`
- `frontend/e2e/branding/brand-logo.pw.ts`
- `frontend/e2e/layout/fixture.html`
- `frontend/e2e/layout/fixture.tsx`
- `frontend/e2e/layout/layout-foundation.pw.ts`
- `frontend/e2e/leave/t13-leave-request.pw.ts`
- `frontend/e2e/loading/fixture.html`
- `frontend/e2e/loading/fixture.tsx`
- `frontend/e2e/loading/loading.pw.ts`
- `frontend/e2e/personnel-layout/personnel-layout.pw.ts`
- `frontend/e2e/personnel/fixture.tsx`
- `frontend/e2e/print/t31-fixture.html`
- `frontend/e2e/print/t31-fixture.tsx`
- `frontend/e2e/print/t31-timesheet.pw.ts`
- `frontend/e2e/roster-layout/roster-layout.pw.ts`
- `frontend/e2e/roster/t11-roster.pw.ts`
- `frontend/e2e/routing/t09-routing.pw.ts`
- `frontend/src/app-loader.test.tsx`
- `frontend/src/approval-center-v1.test.ts`
- `frontend/src/attendance-official-report.test.ts`
- `frontend/src/attendance-simple-p0-clarity.test.ts`
- `frontend/src/attendance-supervisor-v4.test.ts`
- `frontend/src/brand-logo.test.tsx`
- `frontend/src/cfg01-configuration-center.test.ts`
- `frontend/src/cfg08-attendance-device-administration.test.ts`
- `frontend/src/components/dashboard/deep-links.test.ts`
- `frontend/src/dashboard.test.ts`
- `frontend/src/employee-actions-bulk-auto-schedule-hotfix.test.ts`
- `frontend/src/employee-pwa-theme.test.ts`
- `frontend/src/enterprise-hardcoded-surface-guard.test.ts`
- `frontend/src/g06-pwa-mobile-shell-v1.test.ts`
- `frontend/src/layout-foundation.test.tsx`
- `frontend/src/leave-return-for-correction-v1.test.ts`
- `frontend/src/owner-roster-code-brand.test.ts`
- `frontend/src/pages/attendance-device/AttendanceDevicePage.key-state.test.tsx`
- `frontend/src/perf08-system-health.test.ts`
- `frontend/src/q12b-code-splitting.test.ts`
- `frontend/src/report-center.test.ts`
- `frontend/src/routing.test.ts`
- `frontend/src/rule-checking-data-surfaces.test.ts`
- `frontend/src/schedule-typography-contract.test.ts`
- `frontend/src/signature-experience.test.ts`
- `frontend/src/thai-language-t15.test.ts`
- `frontend/src/theme.test.ts`
- `frontend/src/ux-ui-quality-10.test.ts`
- `frontend/src/ux-ui-remediation-v1.test.ts`
- `frontend/src/ux03-data-surfaces.test.ts`
- `frontend/src/ux04-auth-experience.test.ts`
- `frontend/src/ux05-registration-review-workbench.test.ts`
- `frontend/src/ux06-personnel-access-experience.test.ts`
- `frontend/src/vf02-visual-fidelity.test.ts`
- `frontend/src/vf03-pastel-visual-fidelity.test.ts`
- `frontend/src/vf04-mockup-lock.test.ts`
- `frontend/src/vf05-final-fidelity-closure.test.ts`
- `frontend/src/vf06-final-visual-fidelity.test.ts`
- `frontend/src/vf07-final-visual-lock.test.ts`
- `frontend/src/vf071-owner-brand-fix.test.ts`
- `frontend/src/wave4b-system-health-route-surface.test.ts`
- `test/attendance-report.test.js`
- `test/attendance-time-policy-application-release.test.js`
- `test/cloud-preview-operations.test.js`
- `test/dashboard-details.service.test.js`
- `test/dashboard.service.test.js`
- `test/integration/dashboard-summary.integration.test.js`
- `test/integration/license-cron-contract.integration.test.js`
- `test/integration/license-document-workflow.integration.test.js`
- `test/integration/license-schedule-isolation.integration.test.js`
- `test/leave-create-p2028-hotfix.test.js`
- `test/legacy-workflow-extension.test.js`
- `test/license-document-retention.test.js`
- `test/operations-cron-contract.test.js`
- `test/r5b-production-manifest-draft.test.js`
- `test/r5b-readonly-runtime-probe.test.js`
- `test/verify-release-manifest.test.js`

### Governance / CI (7)

- `.github/releases/approved-production.json`
- `.github/releases/r5-a-production-manifest-archive-20261009.json`
- `.github/releases/r5-b-production-manifest-draft.json`
- `.github/workflows/cloud-preview-operations.yml`
- `.github/workflows/r5b-readonly-release-preflight.yml`
- `scripts/ci/cloud-preview-operations.cjs`
- `scripts/ci/r5b-readonly-runtime-probe.cjs`

### Documentation (9)

- `MASTER_HANDOFF.md`
- `docs/OVERNIGHT_EXECUTION_REPORT.md`
- `docs/PROJECT_BACKLOG.md`
- `docs/R5_B_ALTERNATE_ACCEPTANCE_RELEASE_READINESS_20261009.md`
- `docs/R5_B_OFFICIAL_MANIFEST_OWNER_DECISION_20261009.md`
- `docs/RELEASE_ROLLBACK_RUNBOOK.md`
- `docs/T19_DASHBOARD_DEEP_LINK_MAPPING_PROPOSAL.md`
- `docs/release/CLOUD_FIRST_OPERATIONS.md`
- `docs/ux-remediation/PLAN.md`

