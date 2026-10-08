# T20 — E2E proposal and coverage matrix

Proposal only; implementation requires Owner scope acceptance. This document does not certify Production UAT or change application behavior, CI, dependencies or security policy. Current task/release status belongs only in `MASTER_HANDOFF.md`.

## Source and scope

Audited Integration `0296ed78cc47895e49d721557c95bb9f30c88ac4` on 8 October 2026. [PLAN.md](PLAN.md) defines T20 acceptance. Its statement that Playwright is absent is historical: the repository already pins `@playwright/test` 1.62.1. Reuse it and the current Chromium/browser configurations; no dependency installation/change is proposed.

Existing [frontend browser configuration](../../frontend/playwright.print.config.ts) runs intercepted application/print fixtures on loopback. Existing [UAT configuration](../../playwright.config.js) runs smoke against an explicit URL. Fixture success establishes UI behavior only; API/PostgreSQL tests establish backend behavior; a combined real-browser-to-isolated-API test is still needed for the complete business journey.

Existing open [PR #87](https://github.com/godzillazzz/SMS-v3/pull/87), head `166e438c5d9fc53c4fbc6a95675540a5eda6478c`, proposes technical/authenticated ADMIN/MANAGER/VIEWER UAT modes, credential preflight and safe artifact handling. Its body records missing accounts and no authenticated execution. It currently has 63 changed files relative to Integration; audit its complete current diff/ancestry/CI before reuse or merge. This proposal does not replace that PR or create duplicate authenticated UAT implementation. Reconcile its useful read-only harness changes before implementing new coverage.

## Coverage matrix

| Journey | Current evidence to reuse | Proposed isolated automated coverage | Separate acceptance / prerequisite |
|---|---|---|---|
| Login / session / deep link | `frontend/e2e/routing/t09-routing.pw.ts`; `e2e/helpers/uat-auth.js` | Real fixture login, `/app/roster?month=2026-10` preserved, expired/invalid session and logout | Synthetic non-Production accounts; no captured Owner session |
| RBAC | `e2e/smoke/roles.spec.js`; API authorization tests | ADMIN, MANAGER, SUPERVISOR, VIEWER denied/allowed controls and API responses from existing policy; employee PWA identity isolation | Existing UAT account helper supports ADMIN/MANAGER/VIEWER only; SUPERVISOR/PWA coverage is a proposed addition, not a certified suite |
| Leave request → Inbox → decision → employee state | `frontend/e2e/leave/t13-leave-request.pw.ts`; approval center service tests | Real isolated request, correct supervisor inbox, missing rejection reason rejected, approved/rejected state visible to employee | Preserve server-authoritative quota and decision policy; audit existing reject/approve semantics before coding assertions |
| Monthly roster | `frontend/e2e/roster/t11-roster.pw.ts` | Flat classic rows; natural department/employee ordering and dedup; desktop/mobile light/dark; wheel/date and horizontal employee sticky; controls/filter/draft | Read-only visual route test aborts unexpected business writes; separate explicit isolated edit test |
| Manual schedule save / approval / superseded revision | `test/hotfix-schedule-approval.test.js`; `test/schedule-approval-state-guard.test.js` | New manual revision/counter, approve, prior revision marked superseded, rejecting already approved row fails; approval identity/time snapshots | Real isolated API/DB, no synthetic interpretation of missing snapshots; manual workflow only |
| LICENSE BLOCK / renewal isolation | `test/license-schedule-reconciliation.test.js`; `test/integration/license-schedule-isolation.integration.test.js` | Invalid new D/N blocked per existing policy; today/future auto OFF/restore; Bangkok midnight; past rows and all approval fields/revisions unchanged; audit; AL/OFF/admin override; idempotency | Use disposable PostgreSQL; retain actual override policy; no Production compensation or Attendance writes |
| License documents / retention / cron | `test/integration/license-document-workflow.integration.test.js`; fake document storage support | Create/update/delete/renew/review and cron route authorization; resulting allowed reconciliation; unchanged approval snapshots | Fake isolated storage; no real email/storage/cron credentials; does not certify unattended deployed cron configuration |
| Approval details | `test/approval-center.service.test.js`; existing approval UI tests | Leave/device details and real schedule metadata/month shortcut when T08 is available and accepted | T08 currently Local WIP; no invented revision diff, audit-derived diff or migration |
| Dashboard | `frontend/e2e/accessibility/t17-accessibility.pw.ts`; smoke/source contracts | Existing warning/role behavior; new metric navigation only after exact destination/query mapping | T19 Owner mapping remains a dependency; do not guess paginated filters |
| Reports / print | `frontend/e2e/print/t29-printing.pw.ts` | Existing A4 leave/roster and print layout; browser-generated PDF; current permission boundaries | T31 single-employee timesheet/ADMIN-SUPERVISOR print matrix only after its own accepted scope |
| Attendance without device → enrollment | Existing attendance/device API tests and PWA routes | Existing device-missing reason/registration navigation; enrollment/transfer/replay denial using isolated policy fixtures | No new Attendance gate/policy; Owner/device enrollment flow audit before implementation |
| Offline / GPS / geofence | Existing backend security fixtures | Existing integrity, replay prevention and configured geofence boundary/denial checks | Physical iPhone/PWA, persistence across restart, GPS spoofing/location accuracy and real offline delivery are Physical UAT; browser mocks do not certify these |

Face/QR are intentionally excluded from the new G06.1 requirement. Existing historical files/tests are not authorization to add them back.

## Fixture isolation and safe browser testing

1. A new write-capable suite must start its own local application and disposable PostgreSQL 16 database. Apply only existing migrations/seed to the empty fixture DB; no schema/migration changes. Bind loopback, unique per-run test identities and fake storage; disable outbound email/notifications.
2. Before writing, require explicit test mode and verify the exact application/database fixture identity. Fail closed for canonical Production, unknown remote DB, missing identity or a Preview sharing Production data. A Preview URL alone never proves DB isolation. Owner approval of T20 scope must include the fixture target contract before this guard is implemented.
3. Prefer local CI browser + API + disposable DB for business writes. Hosted Preview remains read-only until an independently verified isolated target exists. Do not pull Production environment files or inject Production business accounts.
4. Keep mocked visual fixtures and real API journeys as distinct suites/results. Per-test data namespace and serial stateful journeys prevent cross-test collisions. Assertions must read the persisted result, approval snapshots and audit evidence, not only toast text.
5. Read-only checks allow public/authorized GET and preflight OPTIONS; explicitly distinguish auth refresh/login from business writes. Abort/report unexpected POST/PUT/PATCH/DELETE. Write tests use only their registered synthetic entities in the disposable target.
6. Redact tokens, connection strings, personal records and session state from screenshots/logs/JSON. Avoid authenticated trace/storage-state artifacts unless an approved redaction process guarantees they contain no secrets. No credentials in the public repository.

## Proposed CI integration (not implemented)

| Stage | Execution / result contract |
|---|---|
| Existing CI | Preserve current unit/Integration/browser/TypeScript/build/bundle/audit/Preview gates; reuse pinned Playwright |
| Local business E2E | After Owner scope approval, a dedicated job starts disposable PostgreSQL and the reviewed API/frontend; waits health/readiness and fixture identity; runs critical four PLAN journeys plus accepted license/RBAC cases |
| Read-only Preview | Resolve native deployment tied to exact source; match SHA/ref/project and READY; verify health/database/CORS/runtime sentinels; no writes against shared Production DB |
| Reporting | Separate PASS / FAIL / SKIPPED / BLOCKED, fixture versus real API versus physical/Production UAT; exact SHA, test totals, durations, safe screenshots/PDF and fixture proof |
| Required acceptance | Required business suites may not silently skip missing fixtures/credentials. Failed or skipped required tests block that coverage claim; unrelated credential-optional Production smoke remains explicitly incomplete |

## Implementation sequence after approval

1. Approve test target/fixture contract and test-only scope; audit existing endpoint/role/rejection/revision semantics. Do not change product rules to satisfy a proposed assertion.
2. Add isolated runner/identity/write guards with negative tests for Production and shared/unknown Preview targets.
3. Implement the four PLAN journeys first; then accepted License/RBAC/print coverage in small PRs. T08/T19/T31/G06.1-specific deltas wait for their accepted dependencies.
4. Run focused and relevant regression, exact-head CI, safe Preview and acceptance before merge. Preserve existing bundle budgets and protected release workflow.
5. Keep Physical UAT and authenticated Production UAT as Owner/device gates. Proposal acceptance is not implementation completion, Production approval or a deployable feature for a 2–3 completed-task batch.

## Owner decision requested

Approve or amend this proposal's critical journey coverage, isolated local CI target contract and staged implementation scope. No new subscription, dependency, schema, Production data write, environment or security-policy change is requested. Any later infrastructure/automation change needs its own review.
