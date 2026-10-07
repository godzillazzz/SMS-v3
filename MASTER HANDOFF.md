# MASTER HANDOFF

## Autonomous UX Remediation Checkpoint — 2026-10-07

This current checkpoint supersedes older release-source and production-status summaries elsewhere in this historical handoff. No Production deployment, promotion, Environment approval, or Production data mutation was performed for T29, T07, T09, or the handoff maintenance work.

### Last reported Production state

- Owner-reported Production release: R2, source SHA `2d9a21c9c8d940fbd5c3c8c9dadceae073f0a9ea`, workflow run `37572338555` succeeded and owner confirmed the post-release screen check passed.
- Owner-reported current rollback reference: deployment `dpl_FbXBhBdjcNLvYEpN9sXs3EV6VEuh`, source SHA `2d9a21c9c8d940fbd5c3c8c9dadceae073f0a9ea`.
- These Production facts are carried forward from the owner’s report; they were not re-queried or changed in the T29/T07 work.

### T29 — Printing / A4 — MERGED

- Isolated worktree/branch: `.worktrees/t29-printing-a4` / `codex/t29-printing-a4-20261007`.
- Base SHA: `fd4c7a1b110bee9a9ee77bc5eb2510cb772ee40b`.
- PR #497 merged as `eaa880753efd3476233caf8dce306f27b7eb2e4f`; PR head `3c93e672ef428b47ba7ee19b5e13448e6ab863b6`; exact-SHA CI run `37591241274` passed.
- Preview: `https://sms-v3-staging-git-codex-t29-printing-a4-20261007-godzillazz.vercel.app`, Vercel deployment record `4TQLNtPH3SKtZQKQqC2aqfVn1mnt`; exact PR SHA provenance and Preview health/readiness/CORS checks passed in CI.
- Dedicated print iframe isolates print documents; global `frontend/src/styles.css` no longer declares an app-wide orientation `@page` rule. Leave uses A4 portrait with 12 mm margins; generic table, roster, and report print documents define their own geometry.
- Playwright PDF evidence: artifact `11468442270` (`t29-print-browser-artifacts`). Leave PDF: one A4 portrait page with Thai title and no shell leakage. Roster fixture: one A4 landscape page with all 31 days. Generic table: 8 landscape pages; executive/attendance report fixtures: 4 landscape pages. Header repetition, row breaks, compact roster layout, source guard, and report clipping regressions passed.
- T29 Production deployment: none.

### T07 — Unified Approval Inbox — MERGED

- Base SHA: `eaa880753efd3476233caf8dce306f27b7eb2e4f` (T29 integration merge).
- PR #499, branch `codex/t07-inbox-20261007`, head `6a6a1552ef7fb39a2600f6b0f5ac9700fa37aff2`, merged to integration as `b2d6250b93f8aaddc98846bb487f5884f7b0e062`.
- Exact-head CI run `37596463287` passed, including frontend/backend/integration tests, TypeScript/build/bundle, Linux artifact verification, T29 browser regression job, and Preview runtime health/readiness/CORS step.
- Vercel Preview status succeeded for exact head SHA; record `CmSN7H2DCxLD21Tt6ixZ2JTGGqdA`; runtime target `https://sms-v3-staging-git-codex-t07-inbox-20261007-godzillazz.vercel.app`.
- Local frontend regression: 147 files / 887 tests passed. TypeScript + Vite build and `git diff --check` passed. Fixture-backed browser checks passed at 1366×768 and 375×812 with no JS errors or horizontal document overflow.
- PR #498 was closed unmerged after its generated Preview hostname had a 71-character DNS label, beyond the 63-character DNS limit, and the Preview runtime fetch failed twice. The same commit was retained on the shorter PR #499 branch; CI and Preview gates passed there.
- The inbox uses server `byType`/total summary authority for visible positive-count filters and shared pending counts; the live audit stream was removed from the queue; types/requesters/ages/dates are localized and schedule/registration destinations are direct. Existing approval action authorization and decision APIs were unchanged.
- No Production deployment, data mutation, backend change, DB change, RBAC change, or authentication-policy change was made.

### T08 — Standard Approval Detail — BLOCKED: OWNER/API DECISION REQUIRED

- Capability audit base SHA: `b2d6250b93f8aaddc98846bb487f5884f7b0e062` (T07 integration merge).
- STOPPED before UI implementation because the server does not expose an authoritative schedule-revision diff or immutable revision snapshot. No client-side diff was derived.
- Evidence: `GET /api/v1/schedule-approvals` returns revision metadata (`id`, `month`, `status`, `revision`, `changeType`, `changedAt`, `approvedAt`, approver identity, note, and `isLatestRevision`); it does not return changed-by identity or a server-selected prior-approved revision. `GET /api/v1/approval-center` returns the current pending schedule row and revision metadata only.
- The `ScheduleApproval` model stores status/revision/change metadata and `scheduleHash`, but no assignment snapshot. `ScheduleApprovalEvent` records lifecycle metadata and has no current read route. Shift-assignment audit rows are not linked to a complete, immutable schedule revision, so reconstructing old→new content or warnings from them would be an unsafe guess.
- Other available detail is limited: pending leave rows include request fields and snapshots; `GET /api/v1/leave-quotas` exposes current server-computed entitlement/used/remaining totals, but no request-specific quota-impact or schedule-impact result; leave approval recalculates quota inside its decision transaction. Attendance-device request detail exists behind the existing Admin-only route and includes candidate/current device identifiers and safe device metadata. This task did not broaden that route’s authorization.
- Decision memo / API proposal: Owner must choose whether to authorize a separate server-authority design for immutable schedule-revision data and a read-only approval-detail API (including the prior-approved link, requester/latest editor, revision-bound impact/warnings), or defer schedule detail until that authority exists. Any schema migration would require separate explicit Owner approval; none is proposed for this task.
- No T08 UI/API/schema/auth/RBAC implementation was made. T08 remains BLOCKED until the authority decision is resolved.

### T09 — URL Routing / Deep Links — MERGED

- Isolated worktree/branch: `.worktrees/t09-url-routing` / `codex/t09-url-routing-20261007`.
- Base SHA: `a4557d3a7ea40a3260d3c78c025f050c3fa1f593`.
- PR #501 head: `97948f87cccc6b5ef49c906474a441d51eb86b1a`; merged into `fix/serverless-database-reliability` as `c2039b6194b0b886b604a0d07dd8173d8fa4fcca` using a normal merge.
- Exact-head CI run `37602743331` passed. An earlier CI run `37602156746` failed only on an obsolete root source guard expecting the old direct MonthGridPicker handler; the guard was updated to match the current page-reset handler, and the follow-up exact-head run passed.
- Preview for the final PR head: `https://sms-v3-staging-git-codex-t09-url-routing-20261007-godzillazz.vercel.app`; Vercel deployment record `8qmAAXU27Nm22ksa7UFUHsnZGthc`, Ready. CI's `Verify integration PR Preview health, readiness, and CORS` step passed for this Preview.
- Added `frontend/src/routing.ts` and `routing.test.ts`: stable History API paths for all current pages, Thai document titles, URL query helpers, PWA route compatibility, browser history events, and the existing page-permission predicates moved without changing their conditions. `main.tsx` now resolves direct URLs, restores route filters, preserves relevant query state, and renders Thai in-app 403/404 notices before protected page loaders mount.
- Browser regressions cover login return to a protected settings URL (desktop 1366×768), unknown-route 404 (mobile 375×812), and schedule month/department/page query restoration. Existing T29 print browser tests still run in the same CI browser job.
- Local checks: `npm --prefix frontend test` passed (148 files / 894 tests); `npm --prefix frontend run build` passed (TypeScript + Vite); Playwright passed (7/7); targeted root legacy parity guard passed (5/5); `git diff --check` passed. The local root `npm test` command could not complete in this container because its database-backed tests require `DATABASE_URL` and `JWT_SECRET`; the exact-head GitHub CI run executed and passed `npm test`, integration tests, the full frontend suite, build, and Preview runtime gates.
- No API, business policy, RBAC condition, schema, authentication policy, Production configuration, or Production data was changed. Production deployment: none.

### Backlog execution state

- T29: MERGED (#497).
- T07: MERGED (#499; #498 superseded and closed unmerged).
- T08: BLOCKED by missing server-authoritative schedule-revision diff; decision memo recorded above.
- T09: MERGED (#501).
- T10–T20: NOT STARTED; T16 is next in the requested execution order after the independent T09 work. Each task remains subject to current-head audit and its own isolated worktree/branch/PR.
- Production release is outside this master run.

## SMS V3 — Enterprise Evolution Production Release

**Release date:** 2026-09-27 (ICT)
**Status:** PRODUCTION — READY
**Release source branch:** `preview/enterprise-evolution-20260927`
**Release source commit:** `de4c86d544849ce18422ae5c0e997e4e8270de6f` (`feat(frontend): complete enterprise evolution preview`)

## Production

- Vercel project: `sms-v3-staging`
- Production deployment ID: `dpl_3U9vmhUPwH4t2dZtaWUSa5Tyi7eK`
- Production deployment URL: `https://sms-v3-staging-o35tu0low-godzillazz.vercel.app`
- Canonical Production alias: `https://sms-v3-staging-godzillazz.vercel.app`
- Vercel target: `production`
- Final deployment status: `Ready`
- Production root smoke: `HTTP/1.1 200 OK`
- Verified production artifact ETag: `eba8fb1e73c43835238bf7ba0fcc08e3`

The canonical Production alias was explicitly pointed to the Ready Production deployment and then smoke-tested. The alias returned the same ETag and content length (`2539`) as the new Production deployment.

## QA / Release Evidence

- Full frontend regression: **104/104 test files passed**
- Full frontend tests: **721/721 tests passed**
- TypeScript + Vite production build: **PASS**
- `git diff --check`: **PASS**
- Release worktree was clean before Production promotion.
- Local RC commit matched `origin/preview/enterprise-evolution-20260927` exactly before release.
- Preview RC used for release: `https://sms-v3-staging-35dhf71hu-godzillazz.vercel.app`
- Preview deployment ID: `dpl_Aa58dd68g5n5v6yBCLUJbz8EDX4D`
- Preview root smoke before release: `HTTP 200 OK`

## Enterprise Evolution Scope

- Light / Dark / System theme support and semantic Light surfaces across authenticated application areas.
- Theme control available in desktop top bar and mobile utility panel.
- Desktop mode keeps horizontal pan behavior with fixed sidebar.
- Audit, roster/calendar, attendance, GIS/security-site, executive report, configuration, loading and control surfaces hardened for Light Mode while preserving Dark Mode.
- GIS map picker remains lazy-loaded; `SecuritySiteManagementPanel` shell is approximately 61.53 kB and map picker is a separate lazy chunk.
- Existing accessibility contracts retained, including focus-visible, reduced-motion and touch-target behavior.
- Existing API / Permission / RBAC behavior was not intentionally changed by this release.
- No database migration or database change was performed for this release.

## Rollback Reference

Previous known Ready Production deployment before this release:

- `https://sms-v3-staging-gpjj49ftv-godzillazz.vercel.app`

If rollback is required, verify the target deployment and environment before reassigning the Production alias. Do not perform a database rollback for this release because this release did not include a database migration.

## Operational Notes

- The Production deployment contains Vercel serverless API builds for `api/index` and `api/[...path]`.
- No credentials were invented or embedded during release validation.
- Authenticated business-flow validation requires valid environment/user credentials; automated regression and release smoke evidence above are the release gate evidence recorded for this cut.

## Release Closure

Enterprise Evolution is released to Production. The release artifact, canonical alias and root HTTP response were verified after cutover. Further changes should start from a new change set/RC and repeat regression, build, Preview QA and Production gate checks.

## Post-Production Verification — 2026-09-28

- User-reported symptom: mobile utility menu on `sms-v3-staging-ten.vercel.app` did not show the Desktop Mode action.
- Root cause: the `sms-v3-staging-ten.vercel.app` alias still resolved to older Ready Production deployment `dpl_EHcgNPiqSx31NvrZcwaMmoKSHdft` rather than the Enterprise Evolution Production release.
- Correction: reassigned `sms-v3-staging-ten.vercel.app` to current Production deployment `dpl_3U9vmhUPwH4t2dZtaWUSa5Tyi7eK`.
- Verification: `sms-v3-staging-ten.vercel.app` now resolves to `dpl_3U9vmhUPwH4t2dZtaWUSa5Tyi7eK`, target `production`, status `Ready`.
- HTTP smoke: `200 OK`; ETag `eba8fb1e73c43835238bf7ba0fcc08e3`; content length `2539`, matching the current Production artifact.
- Source verification: mobile utility panel contains `mobile-utility-display-mode` wired to `toggleDesktopView`; forced Desktop Mode remains horizontally pannable on narrow screens.
- Post-correction full frontend regression: **104/104 test files passed, 721/721 tests passed**.
- Post-correction TypeScript + Vite production build: **PASS**.
- No database change was performed.
- No API, Permission, or RBAC behavior was changed as part of the alias correction.

## Mobile Theme Visibility Production Hotfix — 2026-09-28

- User-reported symptom: the Light Theme control was not visibly available in the mobile utility theme control.
- Source fix commit: `27475cf` (`fix(frontend): keep mobile theme icons visible`).
- Fix scope: mobile theme-control CSS only; all three existing theme icon buttons and their SVG icons are explicitly kept visible. No label text was added and theme component logic was not changed.
- Targeted regression: **4/4 test files passed, 58/58 tests passed**.
- Full frontend regression: **104/104 test files passed, 721/721 tests passed**.
- TypeScript + Vite production build: **PASS**.
- Preview release candidate: `https://sms-v3-staging-321ikorif-godzillazz.vercel.app` (`dpl_7ZpRXCb1vEZXehm45uZFo6FUmEXr`), target `preview`, status `Ready`, root smoke `HTTP 200 OK`.
- Production deployment: `https://sms-v3-staging-lljn1oh60-godzillazz.vercel.app` (`dpl_GeZUsMigmiEY86qu8rc2ykAxBR3F`), target `production`, status `Ready`.
- Canonical Production alias: `https://sms-v3-staging-godzillazz.vercel.app` -> `dpl_GeZUsMigmiEY86qu8rc2ykAxBR3F`.
- Operational alias: `https://sms-v3-staging-ten.vercel.app` -> `dpl_GeZUsMigmiEY86qu8rc2ykAxBR3F`.
- Post-cutover smoke: both Production aliases returned **HTTP 200 OK**, content length `2573`, ETag `8083ea037f4c228df5665b5a46903939`.
- No database change was performed.
- No API, Permission, or RBAC behavior was changed by this hotfix.
- Rollback reference: prior Ready Production deployment `dpl_3U9vmhUPwH4t2dZtaWUSa5Tyi7eK` (`https://sms-v3-staging-o35tu0low-godzillazz.vercel.app`).

## Final Theme Fix Production Closure — 2026-09-28

- Source branch: `preview/enterprise-evolution-20260927`
- Release source commit: `b22ac2d` (`fix(frontend): restore dark personnel card surfaces`), including prior Light Roster fix `669fe99`.
- Targeted theme/visual regression: 8 files, 65/65 tests passed.
- Full frontend regression: 104/104 files, 721/721 tests passed.
- Production build: PASS (`tsc -b && vite build`); only the existing Vite chunk-size warning remained.
- Preview RC: `dpl_Gt8U3rTsNo1rpM5F5sNM94fAxHfz`, status Ready.
- Production deployment: `dpl_8XXKhUajEKkBeqA6yWgUjAzCinQE`, status Ready.
- Production artifact URL: `https://sms-v3-staging-k4p9m9r3b-godzillazz.vercel.app`.
- Canonical alias `https://sms-v3-staging-godzillazz.vercel.app` was explicitly assigned to this Production deployment. It is currently protected by Vercel SSO and returns HTTP 302 to the Vercel SSO endpoint for unauthenticated requests.
- Public alias `https://sms-v3-staging-ten.vercel.app` was explicitly assigned to the same Production deployment and returned HTTP 200, Content-Length 2573, ETag `"cf3ab9dbc380d4ff56b12d16e348b854"`.
- No database migration/change. No intentional API, Permission, or RBAC behavior change.
- Release scope closed: Light Roster surfaces and Dark Mode employee/personnel card surfaces are included in the same verified Production release.

## Enterprise Quality Closure — 2026-09-28

- Source commit: `d2a8b7e` (`feat(frontend): harden enterprise mobile accessibility`).
- Performance audit confirmed Security Site panel and MapLibre picker remain route/map lazy. Production build still reports `SecuritySiteManagementPanel` 61.53 kB, main `index` 500.76 kB, and lazy `SecuritySiteMapPicker` 1,040.09 kB; no risky Dashboard contract change was made.
- Theme hardening: permanent quality contract locks recent Light Roster and Dark Personnel regressions in addition to the authenticated hard-dark surface guard.
- Mobile UX: authenticated enterprise cards are width-contained and horizontal table scrollers use contained momentum scrolling at <=640px.
- Accessibility: coarse-pointer authenticated controls receive 44x44 minimum targets; existing global focus-visible and reduced-motion contracts remain enforced.
- Targeted quality suite: 10/10 files, 61/61 tests passed.
- Full regression: 105/105 files, 726/726 tests passed.
- Production build: PASS, 416 modules transformed; existing >500 kB chunk warning remains.
- Preview RC: `dpl_Fa1hov8SE6Py3vdxthVANGAJo97H`, Ready.
- Production: `dpl_DqtuNmZXbd52RX5bUWQrhMsjaRwY`, Ready, artifact `https://sms-v3-staging-8oxgyvzu1-godzillazz.vercel.app`.
- Canonical and operational (`sms-v3-staging-ten`) aliases explicitly point to this Production deployment.
- Operational smoke: HTTP 200, Content-Length 2573, ETag `"a351e61cc319c0f88bff4d647900a3bc"`.
- No DB migration/change and no intentional API, Permission, or RBAC behavior change.
- Rollback reference: previous Production `dpl_8XXKhUajEKkBeqA6yWgUjAzCinQE` (`https://sms-v3-staging-k4p9m9r3b-godzillazz.vercel.app`).

## Production Hardening Release Gate — 2026-09-28

- Source commit: `44496f5` (`ci: enforce production hardening release gates`).
- CI now runs on `preview/enterprise-evolution-20260927` and enforces frontend build verification.
- Performance budget gate: main JS <=525,000 bytes, GIS lazy map chunk <=1,100,000 bytes, other JS chunks <=500,000 bytes, and GIS lazy chunk must exist. Current measured main: 500,768 bytes; GIS: 1,040,094 bytes; 42 JS chunks. PASS.
- Production hardening contract covers explicit loading/empty/permission/error states plus Light/Dark, mobile and accessibility release contracts.
- UAT technical smoke was repaired to follow the current accessible login CTA instead of a stale exact label.
- Targeted hardening suite: 10/10 files, 55/55 tests passed.
- Full frontend regression: 106/106 files, 729/729 tests passed.
- UAT configuration contract: 6/6 passed; 33 Playwright tests discovered. Authenticated role flows remain credential-gated and no credentials were invented or embedded.
- Production technical Playwright smoke: 4/4 passed (HTTP/health/readiness/assets/auth boundary + login browser smoke at 390/768/1440).
- Build: PASS, 416 modules transformed. Existing Vite >500 kB advisory remains, while explicit release budgets pass.
- Preview RC: `dpl_FEJVw9KmvMgBpk9wjFkeqC49Wm5e`, Ready.
- Production: `dpl_CRMfif9bYWb2g2bGsocUgFMMaqCm`, Ready, artifact `https://sms-v3-staging-1wxrgfi84-godzillazz.vercel.app`.
- Canonical and operational (`sms-v3-staging-ten`) aliases explicitly point to this Production deployment.
- Operational smoke: HTTP 200, Content-Length 2573, ETag `"a351e61cc319c0f88bff4d647900a3bc"`.
- No DB migration/change and no intentional API, Permission, or RBAC behavior change.
- Rollback reference: previous Production `dpl_DqtuNmZXbd52RX5bUWQrhMsjaRwY` (`https://sms-v3-staging-8oxgyvzu1-godzillazz.vercel.app`).

## Observability + Performance Optimization Release — 2026-09-28

- Source commit: `8903e55` (`perf(frontend): cut GIS and main bundle weight`).
- Observability: existing read-only System Health remains the production operational dashboard for API p50/p95, HTTP 5xx, database latency, slow routes, warnings, deployment host/SHA and runtime sample scope; its regression contracts remain green. No third-party telemetry secret or DB change was introduced.
- Authenticated E2E: ADMIN/MANAGER/VIEWER Playwright suites remain credential-gated. Vercel environment variable inventory contains no `UAT_ADMIN_*`, `UAT_MANAGER_*`, or `UAT_VIEWER_*` credentials, and repository/docs contain no approved role credentials. No account/password was invented or extracted. Technical production smoke remains mandatory and passed.
- GIS optimization: map implementation moved from MapLibre GL to the already-installed Leaflet engine while preserving OpenStreetMap tiles, click-to-select, draggable marker, geofence circle, lazy route/map loading and attribution.
- GIS JS chunk before: ~1,040,094 bytes. After: 151,938 bytes (~85.4% reduction; gzip 44.67 kB).
- Main JS before: 500,768 bytes. After: 359,131 bytes (~28.3% reduction; gzip 83.37 kB) by isolating React and WebAuthn vendor code.
- Release budgets tightened to main <=400,000 bytes and GIS <=300,000 bytes. Current build passes both.
- UX polish: Security Site map help/ARIA copy is explicit Thai guidance; map selection behavior and geofence identity remain intact.
- Full frontend regression: 106/106 files, 729/729 tests passed.
- Production build: PASS, 415 modules transformed; bundle budget gate PASS.
- Preview RC: `dpl_3xDCbJNU3tf1FFTzakq92ezWuMHZ`, Ready.
- Production: `dpl_FZxPP9UoMfqfospnc3tG1Xd48xtW`, Ready, artifact `https://sms-v3-staging-c6rglnxmw-godzillazz.vercel.app`.
- Canonical and operational (`sms-v3-staging-ten`) aliases explicitly point to this Production deployment.
- Production technical Playwright smoke: 4/4 passed at API/health/auth boundary and browser widths 390/768/1440.
- Operational smoke: HTTP 200, Content-Length 2660, ETag `"5132f345d5d7ee7d5dc0b8964c88084e"`.
- No DB migration/change and no intentional API, Permission, or RBAC behavior change.
- Rollback reference: previous Production `dpl_CRMfif9bYWb2g2bGsocUgFMMaqCm` (`https://sms-v3-staging-1wxrgfi84-godzillazz.vercel.app`).

## Production Operations Acceptance Closure — 2026-09-28

- Source commit: `b892487` (`ops: establish production health acceptance baseline`).
- Added `docs/PRODUCTION_SYSTEM_HEALTH_RUNBOOK.md` with actionable Watch/Incident thresholds for HTTP 5xx, API p95, DB latency, route p95, dropped samples, safe triage, and rollback rules.
- Added CSS release budget <=700,000 bytes to the existing main <=400,000 and GIS <=300,000 gates. Current build: main 359,131 bytes; GIS 151,938 bytes; global CSS 676,075 bytes. PASS.
- Visual/UX regression contracts: 8/8 targeted files, 58/58 tests passed.
- Full frontend regression: 107/107 files, 731/731 tests passed.
- Build: PASS, 415 modules transformed; bundle gate PASS.
- UAT config: 6/6 passed and 33 Playwright scenarios discovered. Authenticated ADMIN/MANAGER/VIEWER scenarios remain credential-gated because approved role credentials are not present; no credentials were invented.
- Preview: `dpl_BvapbK7QP8dqGsKxTyPt7qg1ypwD`, Ready.
- Production: `dpl_EWcnuhqHbkE5xXp3hLBfswubX6AX`, Ready, artifact `https://sms-v3-staging-322ghblyl-godzillazz.vercel.app`.
- Canonical and operational (`sms-v3-staging-ten`) aliases explicitly point to this Production deployment.
- Production technical Playwright smoke: 4/4 passed at API/health/auth boundary and widths 390/768/1440.
- Operational smoke: HTTP 200, Content-Length 2660, ETag `"5132f345d5d7ee7d5dc0b8964c88084e"`.
- No DB migration/change and no intentional API, Permission, or RBAC behavior change.
- Rollback reference: previous Production `dpl_FZxPP9UoMfqfospnc3tG1Xd48xtW` (`https://sms-v3-staging-c6rglnxmw-godzillazz.vercel.app`).

## Task-Oriented Workflow UX Phase 2 Production Release — 2026-09-28

- Source commit: `12ecaf2 feat(frontend): add task oriented dashboard journey`
- Scope: added a Dashboard recommended-work journey that guides the existing Schedule -> Personnel -> Approval flow and surfaces pending approval priority for managers.
- Authorization/data safety: navigation delegates to existing `setActivePage`/RBAC behavior; no new API calls, DB changes, permission changes, or RBAC changes.
- Theme/responsive: dedicated light/dark styling plus mobile/tablet responsive layout; existing three-icon theme control unchanged.
- Targeted UX regression: 5/5 files, 29/29 tests passed.
- Full frontend regression: 109/109 files, 735/735 tests passed.
- Build: PASS, 417 modules transformed.
- Production bundle gate: PASS; main 364,906 bytes, GIS 151,938 bytes, CSS 682,260 bytes, 43 JS chunks.
- UAT config/discovery: 6/6 config tests passed; 33 Playwright scenarios discovered. Authenticated ADMIN/MANAGER/VIEWER execution remains credential-gated because no approved real role credentials are present.
- Preview: `dpl_ByTqbvdYdaztEx4tFVhjm8XzTZWT` / `https://sms-v3-staging-8ne020yq7-godzillazz.vercel.app`, status Ready. Direct Preview browser smoke was blocked by Vercel Deployment Protection; authenticated Vercel CLI verification returned HTTP 200 and confirmed built Vite assets.
- Production: `dpl_ChtNFvkW8vZ1qxdReZMZJnc1Q78Z` / `https://sms-v3-staging-lkhwrf7mh-godzillazz.vercel.app`, status Ready.
- Production aliases explicitly assigned: `https://sms-v3-staging-ten.vercel.app` and `https://sms-v3-staging-godzillazzz.vercel.app`.
- Production technical E2E after alias cutover: 4/4 passed (HTTP health/readiness/Vite assets/audit authorization boundary plus login browser smoke at 390/768/1440).
- Production HTTP verification: 200; Content-Length 2660; ETag `"c237b95a4bbffdf3c43a836db8bc8629"`; Server Vercel.
- Rollback reference: previous production deployment `dpl_EWcnuhqHbkE5xXp3hLBfswubX6AX` / `https://sms-v3-staging-322ghblyl-godzillazz.vercel.app`.

## Competition-Grade UX Phase 4 — Source Ready / Deployment Pending — 2026-09-28

- Scope: aligned Security Site GIS presentation with the Leaflet engine already shipped in the application, removed stale MapLibre selectors from operational/light-mode GIS styling, repaired the map picker Thai accessibility/help copy, and added a dedicated Phase 4 regression contract.
- GIS behavior preserved: OpenStreetMap tiles, lazy `SecuritySiteMapPicker`, click-to-select, draggable marker, geofence circle/radius, site-position synchronization, attribution, and existing API/data flow remain unchanged.
- Theme/responsive safety: Leaflet controls now receive the existing dark operational styling and explicit Light Theme surface styling. Existing three-icon theme control is unchanged.
- Authorization/data safety: no DB migration/change and no intentional API, Permission, or RBAC behavior change. Dashboard eager-loading and GIS lazy-loading contracts remain intact.
- New regression: `frontend/src/competition-grade-ux-phase4.test.ts` guards Leaflet-only GIS selectors and readable Thai map guidance.
- Targeted Phase 4/quality suite: 6/6 files, 23/23 tests passed.
- Full frontend regression: 111/111 files, 740/740 tests passed.
- Build: PASS, 417 modules transformed.
- Production bundle gate: PASS; main 364,906 bytes, GIS 151,947 bytes, CSS 682,755 bytes, 43 JS chunks.
- UAT configuration/discovery: 6/6 config tests passed; 33 Playwright scenarios discovered in 5 files. Authenticated ADMIN/MANAGER/VIEWER execution remains credential-gated because approved real role credentials are not present; no credentials were invented.
- Deployment state: no new Phase 4 Preview or Production deployment was created in this source-ready pass. Phase 3 Preview `dpl_BA9D7Jv2RfvVvBjcELQcjxUM4j5b` remains protected by Vercel Deployment Protection for direct browser E2E, pending an approved Automation Bypass secret.
- Production remains unchanged at `dpl_ChtNFvkW8vZ1qxdReZMZJnc1Q78Z` / `https://sms-v3-staging-lkhwrf7mh-godzillazz.vercel.app`.

### Phase 4 Preview Verification — 2026-09-28

- Preview deployment: `dpl_GMh7uE89Y8RUJmGBpRmu6H7tmuY3` / `https://sms-v3-staging-rarjr1dbk-godzillazz.vercel.app`, status Ready.
- Vercel preview build passed with 417 modules transformed. Preview build correctly skipped production migration.
- Authenticated Vercel CLI artifact verification returned HTTP 200, ETag `W/"a22384aecafc573aba6a79cc9860a82b"`, Server Vercel, and confirmed Vite assets including `assets/index-DPK5MZLm.js` and `assets/index-C6E_BkOL.css`.
- Direct Playwright technical smoke was attempted and all 4 scenarios were blocked by `PROTECTED_DEPLOYMENT_UNVERIFIED` from Vercel Deployment Protection (HTTP/audit boundary plus login browser smoke at 390/768/1440). This is an access gate, not evidence of an application regression.
- No Deployment Protection setting was weakened and no bypass secret or role credential was invented.
- Production was not promoted; it remains `dpl_ChtNFvkW8vZ1qxdReZMZJnc1Q78Z` pending approved Automation Bypass and direct Preview E2E clearance.

## Continuation checkpoint — 2026-09-28 10:xx ICT

User requested that work be recorded here before continuing in a new chat.

### Current source / worktree
- Isolated worktree: `C:\40.AI\_sms_v3_enterprise_preview`
- Branch: `preview/enterprise-evolution-20260927`
- Current source commit at checkpoint: `d461c14 feat(frontend): harden competition grade accessibility`
- Phase 3 local QA already completed: targeted 31/31; full frontend 110/110 files, 738/738 tests; build PASS (417 modules); UAT config 6/6; Playwright discovery 33 tests / 5 files.
- Bundle baseline: main JS ~364.9 KB / 400 KB; GIS ~151.94 KB / 300 KB; main CSS ~683.5 KB / 700 KB on latest Vercel Preview build; 43 JS chunks.
- No API/DB/RBAC behavior change. Theme control remains 3 icons. Dashboard eager loading and GIS lazy Leaflet behavior preserved.

### Latest Phase 3 Preview verification
- New Preview deployment: `dpl_GMh7uE89Y8RUJmGBpRmu6H7tmuY3`
- Preview URL: `https://sms-v3-staging-rarjr1dbk-godzillazz.vercel.app`
- Vercel status: Ready.
- Authenticated `vercel curl` against the exact deployment succeeded for `/` with HTTP 200.
- Preview ETag: `W/"a22384aecafc573aba6a79cc9860a82b"`.
- Exact built assets observed include `assets/index-DPK5MZLm.js`, `assets/index-C6E_BkOL.css`, `react-vendor-BKbRJdrT.js`, `webauthn-vendor-CAMkWa7m.js`.
- `/api/health` is not a defined route on this deployment (`Route not found`); do not treat that alone as a frontend regression.
- Direct Playwright Preview technical smoke was re-run without weakening Deployment Protection. It remained blocked/failing on protected Preview access (same infrastructure constraint as earlier Phase 3). Authenticated CLI artifact verification is the available exact-deployment verification path unless an approved Automation Bypass secret is configured.
- Never invent or expose a bypass secret or ADMIN/MANAGER/VIEWER credentials.

### Production state / safety
- Phase 3 has NOT been promoted to Production at this checkpoint.
- Current Production remains Phase 2: `dpl_ChtNFvkW8vZ1qxdReZMZJnc1Q78Z`.
- Do not touch the dirty main worktree `C:\40.AI\_sms_v3_roster_prod`.
- Preserve Deployment Protection. Prefer authenticated `vercel curl` verification when no approved bypass secret exists.

### Next-chat continuation
1. Read this MASTER HANDOFF first and inspect `git status --short` plus latest commits.
2. Confirm the latest Preview `dpl_GMh7uE89Y8RUJmGBpRmu6H7tmuY3` is Ready and exact artifact verification still succeeds.
3. Inspect the completed Playwright smoke output/test-results and accurately record that direct browser Preview access is protection-blocked; clean only generated test artifacts if untracked/ignored.
4. If the established authenticated artifact gate is accepted, promote the exact Preview to Production; rollback reference is `dpl_ChtNFvkW8vZ1qxdReZMZJnc1Q78Z`.
5. Verify final Production aliases from Vercel before assigning; historically `sms-v3-staging-ten.vercel.app` and the explicit prior alias `sms-v3-staging-godzillazzz.vercel.app` were used. Do not guess alias spelling.
6. Run final Production technical E2E 4/4 against the canonical unprotected Production alias, verify HTTP/artifact/ETag, then append final Phase 3 closure here.
7. Commit/push the handoff update, restore generated `frontend/tsconfig.tsbuildinfo` if modified, and finish with a clean isolated worktree.


## Phase 4 Production closure — 2026-09-28

### Release execution
- Checkpoint branch was clean and synchronized before release work: `preview/enterprise-evolution-20260927`, HEAD `c006fa7 docs: checkpoint phase 3 continuation`.
- Latest protected Preview `dpl_GMh7uE89Y8RUJmGBpRmu6H7tmuY3` was re-verified as `Ready`.
- Authenticated exact-Preview artifact verification returned HTTP 200 with ETag `W/"a22384aecafc573aba6a79cc9860a82b"` and the expected Vite assets, including `assets/index-DPK5MZLm.js` and `assets/index-C6E_BkOL.css`.
- The recorded Preview Playwright technical smoke was inspected. All 4 direct-browser scenarios failed only with `PROTECTED_DEPLOYMENT_UNVERIFIED` because Vercel Deployment Protection intercepted the browser flow. No protection setting was weakened and no bypass secret was invented.
- The approved Preview was promoted through Vercel. Promotion produced Production deployment `dpl_8vCrbakayeAb5yAqAV8ixfDXFYAh` at `https://sms-v3-staging-g5xuzdqax-godzillazz.vercel.app`; final status: `Ready`.

### Production aliases / protection
- Canonical technical Production alias `https://sms-v3-staging-ten.vercel.app` was explicitly assigned to `dpl_8vCrbakayeAb5yAqAV8ixfDXFYAh` and verified by direct HTTP 200.
- Explicit prior Production alias `https://sms-v3-staging-godzillazzz.vercel.app` was explicitly assigned to the same deployment; `vercel alias ls` confirms its source is now `sms-v3-staging-g5xuzdqax-godzillazz.vercel.app`.
- The Vercel project-style `...godzillazz.vercel.app` access path remains protected and returns the expected Vercel SSO redirect for an unauthenticated browser. Deployment Protection was preserved.
- The unprotected `-ten` alias is the Production technical-smoke target and is classified by the suite as `CANONICAL_COMPATIBLE`.

### Final Production verification
- Authenticated exact-Production artifact verification against `dpl_8vCrbakayeAb5yAqAV8ixfDXFYAh` returned HTTP 200.
- Production ETag: `"a22384aecafc573aba6a79cc9860a82b"`; the hash matches the Preview artifact ETag payload. Production Vite asset filenames also match the verified Preview.
- Direct Production technical Playwright E2E against `https://sms-v3-staging-ten.vercel.app`: 4/4 passed in 30.3s.
- Passed: root/login HTTP, health, readiness x3, Vite asset loading, no unexpected `/_next/`, unauthenticated audit API 401 boundary, and login browser smoke at 390 / 768 / 1440 widths.
- Final generated UAT summary reports: Root PASS, Login PASS, Health PASS, Ready #1/#2/#3 PASS, Vite assets PASS, Audit API 401 PASS, Origin `CANONICAL_COMPATIBLE`, Overall PASSED.
- Authenticated ADMIN/MANAGER/VIEWER scenarios remain intentionally skipped because approved real role credentials are not present. No credentials were invented.

### Rollback / safety
- Rollback reference remains `dpl_ChtNFvkW8vZ1qxdReZMZJnc1Q78Z` / `https://sms-v3-staging-lkhwrf7mh-godzillazz.vercel.app`, previously verified `Ready`.
- If rollback is required, use the established rollback/promotion procedure for that deployment and re-verify both Production aliases before traffic validation.
- The dirty main worktree `C:\40.AI\_sms_v3_roster_prod` was not touched.
- `frontend/tsconfig.tsbuildinfo` was not modified.
- No application source changes were made after the already-passed Phase 4 QA/build gates; this closure only records release verification and deployment state.

## Vercel Function Storage Reduction — Production Closure — 2026-10-05

### CLOSED / Production live
- Application change PR: #455, merged application source `31c04fa48330970fb89f18277ee29c88fbf7ac4c` on `fix/serverless-database-reliability`; source tree `10270ed303bdebd2da560a518e80fefbc0632898`.
- Release-control PR: #456, merged control-plane SHA `702f9a3d6448c29834b193f96328229c7f133e41`.
- Application exact-merge CI: run `37329049240` SUCCESS.
- Exact Preview technical smoke: run `37332877626` SUCCESS against `dpl_8mm7yDoM94FEp5j4a3NfmWVZPfnr`.
- Protected Production workflow: run `37334439171` SUCCESS. GitHub Environment approval used the existing `production-sms-v3-staging` protection; no protection rule was weakened or bypassed.
- New canonical Production deployment: `dpl_5QHhQCfVSqSkC3CvdomVVhMnHgJ2` / `https://sms-v3-staging-5pnd8zdxu-godzillazz.vercel.app`, target `production`, state READY.
- Canonical technical URL `https://sms-v3-staging-ten.vercel.app` resolves to that deployment. Native Vercel provenance: project `prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s`, githubCommitSha `31c04fa48330970fb89f18277ee29c88fbf7ac4c`, githubCommitRef `fix/serverless-database-reliability`.
- Verified rollback deployment remains READY: `dpl_222Bc2u95XS9EsurxXs69w7uCdqU`, native source `32018116e66c70b9443601c1aa675d9fb6e9dfd7`. Automatic rollback steps were skipped because post-promotion verification passed.

### Runtime and storage result
- Production now emits exactly one Node 22 Lambda, `api/[...path]`, measured at `19,092,830 bytes` (~18.21 MiB). The duplicate `api/index` function is gone and Human/TFJS model/WASM payload is no longer explicitly bundled into the deployed runtime.
- Audited pre-change two-function baseline was `71,064,463 bytes`; new Production raw function artifact footprint is lower by `51,971,633 bytes`, approximately 73.14% per deployment.
- Independent post-release checks: `/api/v1/health` HTTP 200 `{"status":"ok"}`; `/api/v1/ready` HTTP 200 with `database:"ok"`; trusted canonical-origin CORS HTTP 204 with exact allow-origin; untrusted origin HTTP 403.
- No database schema migration, Production business-data mutation, Environment/secret change, auth policy change, device-binding policy change, or GPS/geofence policy change occurred in this release.
- G06 simplified Attendance authority remains device binding + secure offline + GPS/geofence; Face/QR remains intentionally outside the active Attendance flow.

### Retained deployment cleanup
- Previously audited safe Preview deployments `dpl_5NmjRNpLfb83GufNNDU5X6HZrG3u` and `dpl_5Y78qMe9WhyeESBPF1VjsX6wSTP2` were removed with Vercel `--safe` deletion after Production verification.
- Vercel reported both deletions successful. Direct deployment API re-check returns `404 Deployment not found` for both IDs and the deployments are absent from the retained deployment listing.
- Their audited raw function artifacts totalled `142,128,926 bytes` (~135.55 MiB). This is raw deployment-artifact cleanup evidence; do not equate it directly to billed Function Storage because Vercel accounting/deduplication and dashboard refresh timing are provider-controlled.
- Branch aliases previously associated with those old deployments remain attached to newer READY deployments and were not removed.

### Remaining limitation
- No authenticated employee role session was used for an additional live UI business-flow test in this storage-reduction release. Production workflow sentinels and read-only runtime checks passed; no Production employee/schedule/attendance data was altered for testing.

## G06 Physical Production Acceptance Closure — 2026-10-05

- Status: **G06 CLOSED / ACCEPTED / PRODUCTION LIVE**.
- Owner supplied physical iPhone/PWA Production evidence from `sms-v3-staging-ten.vercel.app` showing successful online CHECK_OUT saved to Server, primary-device state, GPS/geofence gate presentation, separate expected/actual Site context, and `ASSIST_OTHER_SITE` for a valid support-site attendance.
- This evidence is consistent with the active simplified G06 authority: device binding + secure offline + GPS/geofence. Face/QR remains intentionally outside the active Attendance flow.
- The screenshot is owner-supplied physical evidence and does not independently attest physical location or expose GPS coordinates/credentials.
- Offline physical mode was not exercised by this screenshot; that remains optional resilience validation and is not a blocker for the already-closed G06 acceptance.
- No Production schedule, monthly approval, security policy, Environment/secret, database record, or device assignment was changed to obtain the evidence.
- Durable closure: `docs/G06_PRODUCTION_PHYSICAL_ACCEPTANCE_20261005.md`.

## UX Benchmark Continuation — 2026-10-05

- Benchmark completed against UX Design Awards 2025 HR products (Hailey, Sapien HR, Workable HR), workforce products (Connecteam, UKG, Deputy), and NN/g progressive-disclosure guidance.
- Highest-value next implementation: **P0 Attendance Clarity** — humanize employee-facing exception codes, restructure the mobile surface around Now / Next / Exception, and add a post-action receipt.
- This recommendation is UX-only and must preserve device binding, secure offline, GPS/geofence, Schedule authority, Expected-vs-Actual Site evidence and audit flags.
- Detailed benchmark and proposed employee/supervisor wireframes: `docs/UX_ATTENDANCE_BENCHMARK_20261005.md`.


## Attendance P0 Clarity — Release-source Closure — 2026-10-05

- Status: **MERGED_RELEASE_SOURCE / PRODUCTION_NOT_DEPLOYED**.
- Application PR #459 merged into `fix/serverless-database-reliability`.
- Feature SHA: `be338c494abed9829181e2134b8590adccf464a4`.
- Merge SHA: `d6edd66f4c5a759ac259f93a82b02a649bd99093`.
- Exact PR-head CI run `37344552059`: SUCCESS on Node 22/PostgreSQL 16, including backend tests/integration, Attendance PostgreSQL integration, full frontend suite, TypeScript, production build and repository hygiene.
- Exact merge CI run `37345165059`: SUCCESS.
- PR-head Preview `dpl_DoBfXStdgVV62K1xpDnvqDm3WyCp`: READY from exact feature SHA.
- Release-source merge Preview `dpl_7yhB1z5N66fF8G2CfnLZiiza2QBK`: READY from exact merge SHA/ref `fix/serverless-database-reliability`; one Node 22 Lambda remains `19,091,422 bytes`.
- Merge Preview runtime verification: health HTTP 200/status ok; readiness HTTP 200/database ok; trusted Preview-origin CORS HTTP 204; untrusted origin HTTP 403.
- Implemented employee UX: Now / Next / Exception hierarchy; human-facing support-Site wording; primary-device and offline wording; raw review reason codes behind technical progressive disclosure; post-action attendance receipt with server event time, actual Site, device, location-check and sync context.
- 390px browser fixture using the real Attendance CSS was inspected during implementation; the dominant attendance action, exception state, receipt and history controls remained accessible.
- Scope stayed frontend presentation/tests only. No API, database schema/data, Environment/secret, Attendance security policy, device-binding, secure-offline, Schedule authority, GPS/geofence or Expected-vs-Actual Site semantics changed.
- Current Production was intentionally not promoted by this task. Canonical remains `dpl_5QHhQCfVSqSkC3CvdomVVhMnHgJ2`, READY, application SHA `31c04fa48330970fb89f18277ee29c88fbf7ac4c`.
- Production promotion of `d6edd66f...` requires a separate explicit Owner Production authorization.


## Attendance P0 Clarity — Production Closure — 2026-10-06

### CLOSED / Production live
- Status: **CLOSED / PRODUCTION LIVE / VERIFIED**.
- Employee UX application PR #459 remains the application authority: feature SHA `be338c494abed9829181e2134b8590adccf464a4`, application merge SHA `d6edd66f4c5a759ac259f93a82b02a649bd99093`.
- Governed release target was exact immutable source `85a080c338cc0d2d8ba728b181d29626880a79b2` / tree `925bb3d5004097b11bfc28a032b9d9c0b8736ba2`; release-control manifest prepared by PR #461.
- Final successful protected Production workflow: run `37392358478`, dispatched from release-control SHA `2f6ddbcde63acfd3fe61df0635f46600937f97aa`, conclusion SUCCESS.
- New canonical Production deployment: `dpl_6vduk7ttKLL6sw2y5FDE6xYu42TY` / `https://sms-v3-staging-nyeokwlps-godzillazz.vercel.app`, target `production`, READY.
- Canonical technical URL `https://sms-v3-staging-ten.vercel.app` resolves to that deployment.
- Native Vercel provenance: project `prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s`, githubCommitSha `85a080c338cc0d2d8ba728b181d29626880a79b2`, githubCommitRef `fix/serverless-database-reliability`.
- Production emits one Node 22 Lambda, `api/[...path]`, measured at `19,092,830 bytes`.
- Previous canonical `dpl_5QHhQCfVSqSkC3CvdomVVhMnHgJ2` remains READY as rollback evidence, native source `31c04fa48330970fb89f18277ee29c88fbf7ac4c`.
- Final post-deploy checks independently re-confirmed: `/api/v1/health` HTTP 200/status ok; `/api/v1/ready` HTTP 200/database ok; trusted canonical-origin CORS HTTP 204 with exact allow-origin; untrusted origin HTTP 403.
- Production workflow runtime verification reported `SENTINELS=22`; base critical UI sentinel contract reported PASS `19/19`. Automatic rollback and fail-closed-after-rollback steps were skipped because final verification passed.
- No database migration, Production business-data mutation, Environment/secret mutation, auth policy change, device-binding change, secure-offline policy change, Schedule authority change, or GPS/geofence policy change occurred.

### Release incident trail and resolved safeguards
- Attempt 1: Production run `37389640501` reached promotion, then the runtime verifier rejected three intentionally retired Attendance labels. Automatic rollback succeeded to `dpl_5QHh...`. The application itself was not the failing component.
- PR #462 / merge `ad3b7a413354a17ffc2eee18ea10558a891e50a2` aligned Production runtime sentinels with the P0 employee copy. Exact merge CI run `37390924317` SUCCESS.
- Attempt 2: Production run `37391172905` passed build/sentinels but failed before promotion because Vercel candidate alias assignment was still stabilizing immediately after READY. Canonical Production remained unchanged.
- PR #463 / merge `2f6ddbcde63acfd3fe61df0635f46600937f97aa` added bounded alias-stabilization verification. It preserves strict final validation and canonical-alias fail-fast behavior. Exact merge CI run `37392102374` SUCCESS.
- A duplicate retry run `37392379212` was explicitly cancelled before deployment; only final run `37392358478` was allowed to proceed.
- Final candidate creation, explicit promotion, canonical verification, runtime sentinels and release summary all completed successfully.

### Product result
Attendance P0 Clarity is now live in Production:
- Now / Next / Exception hierarchy;
- employee-readable support-Site wording;
- affirmative primary-device wording;
- human-readable offline readiness;
- raw reason codes behind technical progressive disclosure;
- server-backed post-action receipt.

G06 remains CLOSED / ACCEPTED / PRODUCTION LIVE with device binding + secure offline + GPS/geofence as the active Attendance authority. Face/QR remains intentionally outside the active Attendance flow.


## ACTIVE — CURRENT ROADMAP AUTHORITY — G06.1 Anti-Buddy-Punching Hardening — 2026-10-06

### Naming clarification

- **G06 is CLOSED / ACCEPTED / PRODUCTION LIVE.**
- Historical labels **G06.1A — Attendance Core Foundation** and **G06.1B — Admin Configuration** are legacy completed gates from the older Attendance lineage. They remain historical evidence only.
- For all roadmap discussion after this section, **G06.1 means the new post-G06 phase: Anti-Buddy-Punching Hardening** unless a note explicitly says “historical G06.1A/B”.
- This clarification supersedes any prior interpretation that “G06.1 is already finished” merely because historical G06.1A/B were completed.

### Current live baseline

Production is currently verified as:
- canonical deployment: `dpl_6vduk7ttKLL6sw2y5FDE6xYu42TY`;
- canonical technical URL: `https://sms-v3-staging-ten.vercel.app`;
- native Production source SHA: `85a080c338cc0d2d8ba728b181d29626880a79b2`;
- Production release workflow: `37392358478` — SUCCESS;
- active G06 Attendance authority: **device binding + secure offline + GPS/geofence + Schedule/Shift authority + Server validation/audit/risk controls**;
- Attendance P0 Clarity is live in Production.

Owner physical Production acceptance already proved that a normal iPhone/PWA Attendance event can be recorded successfully, the device can be recognized as the primary device, GPS/geofence remains in the flow, Expected Site and Actual Site remain distinct, and support-Site work can be preserved with the review classification rather than silently rewriting Schedule authority.

### Why G06.1 exists

The next risk is **buddy punching / proxy attendance**: another person may possess or borrow the employee’s valid primary device/account and attempt to record Attendance for that employee.

The current controls strongly validate **device, location, schedule, event integrity and server acceptance**, but those controls alone do not prove with high assurance that the human pressing the button is the employee who owns the Attendance identity.

G06.1 therefore upgrades **person-present / user-verification evidence** while preserving the already-proven G06 flow and avoiding unnecessary friction for legitimate employees.

A failure of a future G06.1 verification step is a **risk / verification outcome**, not automatic proof of misconduct.

### Scope lock — do not silently reintroduce retired controls

The current simplified G06 scope intentionally removed Face and QR from the active Attendance flow.

Therefore G06.1 MUST NOT silently reintroduce:
- server-side face matching;
- liveness / PAD;
- QR;
- routine Attendance event photos;
- biometric-template storage;
- 1:N employee identification.

Any return of server-side 1:1 face verification/liveness or QR requires a separate explicit Owner scope/security/privacy decision.

If a future Owner-approved biometric option is considered, it must remain **1:1 only**, require appropriate anti-spoof/liveness assurance, retain no routine check-in/check-out live frames, and never become broad 1:N identification.

### G06.1 Phase 0 — next gate

**Status: OPEN / NEXT PHASE.**

Earliest gate is a current-Production **architecture + threat-model + device-compatibility audit**. No Production data, DB, Environment, secret, auth policy, or biometric-authority mutation is authorized merely by this roadmap entry.

The audit must evaluate a non-biometric-first design using the existing G06 foundation:

1. **Device-bound cryptographic proof**
   - continue using dedicated Attendance device authority rather than browser fingerprint, User-Agent, arbitrary device name, or passkey record alone;
   - private credential remains local/non-exportable where platform support allows;
   - server challenge is high-entropy, short-lived, single-use, purpose-bound, employee/device/event-bound and replay-safe.

2. **Platform user-verification step-up**
   - evaluate WebAuthn/passkey user verification or equivalent platform-mediated verification on iPhone/Android/PWA;
   - Face ID / Touch ID / device PIN may be used by the platform as the local user-verification mechanism where supported;
   - this step-up is additional person-present evidence only;
   - it MUST NOT be misrepresented as authoritative Attendance device identity and MUST NOT replace the dedicated primary-device registry.

3. **Risk-based step-up policy**
   - determine when stronger user verification is mandatory versus when the normal low-friction path is sufficient;
   - candidate triggers include foreign/new device, device replacement, unusual Site/time behavior, repeated failed proof, suspicious replay pattern, delayed/offline events requiring review, or other server risk signals;
   - support-Site attendance must remain a legitimate operational case and must not automatically be treated as fraud.

4. **Anti-replay / anti-cloning controls**
   - preserve capture/event idempotency;
   - reject replayed challenge/signature material;
   - test copied session/local-storage scenarios;
   - do not downgrade to a reusable bearer “device token” simply for browser compatibility.

5. **Governed device replacement**
   - primary-device move remains **ADMIN-only**;
   - old credential revocation and replacement activation must be atomic where applicable;
   - preserve actor/reason/time/before-after Audit evidence.

6. **Rate / anomaly controls**
   - evaluate bounded server-side rate limits and anomaly signals for rapid/repeated punches, repeated failed verification, impossible/repeated device transitions and replay attempts;
   - do not treat a single anomaly as proof of misconduct.

### Required G06.1 attack / acceptance matrix

Before G06.1 can be marked CLOSED, verification must cover at least:

- legitimate employee on the bound primary iPhone/PWA can still CHECK_IN/CHECK_OUT successfully;
- required user-verification step-up cannot simply be skipped when policy requires it;
- another/non-primary device cannot silently become a normal trusted primary device;
- copied/replayed challenge or signed payload is rejected;
- stale/consumed challenge is rejected;
- device replacement requires ADMIN authority and leaves audit evidence;
- secure-offline queue/integrity and delayed-event review semantics remain intact;
- Expected Site vs Actual Site and `ASSIST_OTHER_SITE` semantics remain intact;
- View As / impersonation remains read-only for Attendance evidence submission;
- no Production schedule/month approval/business-data mutation is used merely to manufacture a test case;
- physical iPhone/PWA validation is performed for the final selected user-verification mechanism.

### High-assurance future option — Owner gate only

Historical architecture notes correctly identify **1:1 face + liveness/anti-spoof** as a stronger anti-buddy-punching signal because device/location controls alone cannot prove the presenter’s human identity.

However, Face was later intentionally removed from the active G06 contract. Therefore server-side 1:1 face/liveness is **not part of G06.1 by default**.

If the non-biometric-first G06.1 design cannot reach the Owner’s required assurance level, present a separate decision with:
- exact threat reduction gained by 1:1 face/liveness;
- iPhone/Android/PWA compatibility;
- false-reject and field-operations impact;
- privacy/retention consequences;
- cost/runtime impact;
- no-event-photo-retention design;
- explicit rollback/fallback behavior.

Do not implement or enable it before that decision.

### Current priority

The next security/product task after the proven Production Attendance flow is:

**G06.1 — Anti-Buddy-Punching Hardening, Phase 0 architecture/threat-model audit.**

Authenticated ADMIN/MANAGER/VIEWER E2E and optional physical offline resilience validation remain useful follow-up validation, but they do not replace the G06.1 anti-buddy-punching phase and are not the definition of G06.1.


## CLOSED — Schedule Large-Batch Save Production Fix — 2026-10-06

### Final status

**CLOSED / PRODUCTION LIVE / BUSINESS LOGIC PRESERVED**

The Owner-reported failure to save Schedule batches above roughly 60 assignments has been permanently addressed and promoted through the governed Production release path.

### Root cause

There was no business rule or validation cap of 60 assignments.

The active Schedule UI submitted the entire edited Schedule draft to `POST /api/v1/schedules/batch` as one atomic request. Inside the backend transaction, operational employee lifecycle state was previously queried repeatedly per assignment before each `ShiftAssignment.upsert`. For larger batches this created N+1 database round trips inside the existing 60-second Prisma interactive-transaction / serverless execution boundary.

The fix removes those repeated lifecycle reads by bulk-loading employee/lifecycle evidence once per transaction and resolving projected state in memory while retaining the existing `ensureEmployeeOperationalForShift()` business decision gate.

### Business-rule lock

This release intentionally did **not** solve the issue by relaxing behavior:

- no Schedule batch hard cap was added;
- no transaction/serverless timeout was increased;
- no frontend chunking was introduced;
- the batch remains atomic;
- OFF / AL non-operational bypass semantics remain unchanged;
- employee lifecycle ACTIVE / TERMINATED projection semantics remain unchanged, including same-date lifecycle sequence ordering;
- License validation/override behavior remains unchanged;
- ScheduleApproval reset / AL-only semantics remain unchanged;
- Audit and rollback behavior remain unchanged;
- no API contract or database schema changed.

### Validation evidence

Application PR **#466 — Fix large schedule batch timeout**:

- final PR-head SHA: `4d6f511a4238e4679bc4028ef57fc13a3e5753fa`;
- application merge SHA: `f63c785e8af1d63f3d27754c66709e6a0d9b3443`;
- application tree: `896fd370fe8a0c26b153a245fbeeba3c47499359`;
- PR-head CI: `37398937027` — SUCCESS;
- exact application-merge CI: `37399279989` — SUCCESS;
- exact merge technical smoke: `37399537515` — SUCCESS;
- exact merge Preview: `dpl_9z9FUgogmkV8w2g27dVo9kuk4Yp5` — READY.

The PostgreSQL 16 integration suite exercised **120 operational Schedule assignments in a single batch** (6 employees × 20 work dates) with valid Licenses and asserted:

- HTTP 200;
- saved count = 120;
- returned assignment count = 120;
- License status = VALID for every returned assignment.

Focused parity/safety tests also verified that the bulk projected-state resolver matches the pre-existing projected lifecycle semantics and that OFF/AL/inactive/deleted employee behavior remains unchanged.

### Dependency audit closure

Two newly surfaced dependency advisories blocked CI before the Schedule integration gate and were patched without framework/business-code upgrades:

- backend `proxy-addr` lock resolution: `2.0.7 -> 2.0.8`;
- frontend `source-map-js` lock resolution: `1.2.1 -> 1.2.2`.

Both backend and frontend high/critical dependency audit gates passed after the lock-only updates.

### Governed Production release

Release-control PR **#467**:

- release-control branch SHA: `c45b00c806e5d7fc54fd36c8f22d0047fd1e3238`;
- release-control merge SHA: `01085b486d8e0ff19622b53e54c7795618276b4f`;
- PR control CI: `37400009131` — SUCCESS;
- exact control-plane merge CI: `37400212302` — SUCCESS;
- approved release id: `sms-v3-prod-f63c785e8af1-20261006`.

Protected Production workflow:

- workflow run: `37400666492` — **SUCCESS**;
- GitHub Environment protection: `production-sms-v3-staging`;
- normal Owner Environment approval used; no protection bypass;
- exact prebuilt artifact / feature sentinels: PASS;
- immutable Production candidate creation: PASS;
- explicit promotion: PASS;
- canonical Production verification: PASS;
- automatic rollback: **not used**.

### Current Production

Canonical technical URL:

`https://sms-v3-staging-ten.vercel.app`

Current canonical deployment:

- deployment id: `dpl_F4E5kVXqpYuhQjcQSDP49ViJJvpK`;
- state: READY;
- target: production;
- native GitHub source SHA: `f63c785e8af1d63f3d27754c66709e6a0d9b3443`;
- source ref: `fix/serverless-database-reliability`;
- Vercel project: `prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s`.

Independent post-deploy checks:

- `/api/v1/health`: status ok;
- `/api/v1/ready`: status ready / database ok;
- trusted canonical-origin CORS preflight: HTTP 204;
- untrusted `https://evil.example`: HTTP 403.

Verified rollback checkpoint preserved READY:

- `dpl_6vduk7ttKLL6sw2y5FDE6xYu42TY`;
- native source SHA: `85a080c338cc0d2d8ba728b181d29626880a79b2`.

No Production employee/schedule/attendance business data, database schema, Environment/secret, authentication policy, device-binding policy, G06 biometric authority, or GPS/geofence policy was changed to deliver or verify this fix.

### Roadmap continuity

This Schedule incident is CLOSED and does not supersede the current security roadmap.

The next security/product phase remains:

**G06.1 — Anti-Buddy-Punching Hardening, Phase 0 architecture/threat-model audit — OPEN / NEXT PHASE.**


## CLOSED — Vercel Preview Deployment Cleanup — 2026-10-06

### Final status

**CLOSED / SAFE CLEANUP COMPLETED / PRODUCTION UNCHANGED**

Owner authorized a conservative cleanup of stale Vercel Preview deployments to reduce retained deployment/function-storage pressure.

The cleanup policy was intentionally fail-safe:

- only Preview deployments were eligible;
- current Production was excluded;
- the current rollback deployment was excluded;
- deployment ids still referenced by the current `MASTER HANDOFF.md` or approved Production manifest were excluded;
- the latest READY Preview for every still-existing remote branch was excluded;
- the exact Schedule large-batch merge/technical-smoke Preview was excluded;
- Vercel `remove --safe` was used;
- aliases were **not** detached automatically;
- old Production deployments were **not** deleted in this pass.

### Inventory and result

Pre-cleanup project inventory:

- total deployments: **188**;
- Preview deployments: **161**;
- Production-target deployments: **27**.

Conservative cleanup candidates after allowlisting release/rollback/current/evidence/latest-per-live-branch deployments:

- Preview candidates: **84**.

Cleanup result:

- safely removed: **83 Preview deployments**;
- retained by Vercel safety guard: **1 Preview deployment**;
- retained deployment: `dpl_BVQJ8KWNtBMGYSd6TVXP9k5ibzyf`;
- retained native source SHA: `cad6d9d8279e9d3d90bbb61a70a0a09bd9e4967c`;
- retained historical branch ref: `fix/preview-readonly-role-provisioning-20261003`;
- reason retained: `--safe` protection because an alias/usage association still exists;
- no alias was removed or reassigned.

Post-cleanup project inventory:

- total deployments: **105**;
- Preview deployments: **78**;
- Production-target deployments: **27**.

Therefore the cleanup removed **83 deployments total**, all from the Preview population, while the Production-target population remained unchanged.

### Protected deployments verified after cleanup

Current Production remains:

- `dpl_F4E5kVXqpYuhQjcQSDP49ViJJvpK`;
- READY;
- native source SHA `f63c785e8af1d63f3d27754c66709e6a0d9b3443`.

Current rollback remains:

- `dpl_6vduk7ttKLL6sw2y5FDE6xYu42TY`;
- READY;
- native source SHA `85a080c338cc0d2d8ba728b181d29626880a79b2`.

Latest release-source Preview retained:

- `dpl_xNZMN47iWtV7pi2bYEJ5z5eVGqhW`;
- READY;
- native source SHA `c9d01c2c42d134f118ee38804fbe383ea9240add`.

Schedule large-batch exact merge / technical-smoke Preview retained:

- `dpl_9z9FUgogmkV8w2g27dVo9kuk4Yp5`;
- READY;
- native source SHA `f63c785e8af1d63f3d27754c66709e6a0d9b3443`.

### Runtime verification after cleanup

Canonical `https://sms-v3-staging-ten.vercel.app` remained healthy after the deletion pass:

- `/api/v1/health`: HTTP 200, status ok;
- `/api/v1/ready`: HTTP 200, status ready / database ok;
- trusted canonical-origin CORS preflight: HTTP 204;
- untrusted `https://evil.example`: HTTP 403.

No Production employee/schedule/attendance data, database schema, Environment/secret, authentication policy, device-binding policy, G06 security scope, GPS/geofence policy, canonical alias, rollback alias, or release branch was changed by this cleanup.

### Storage-accounting limitation

Do **not** interpret 83 deleted deployments as a directly additive Function Storage reclaim.

Vercel may deduplicate function artifacts across deployments, and billed Function Storage / dashboard usage may refresh asynchronously. The deployment deletion count above is exact; the resulting billed GB reclaim is provider-accounting dependent and was not guessed.

Historical high-value evidence remains relevant: older pre-storage-reduction deployments could contain two Lambdas totaling about 71 MB, while the current Production deployment contains one Lambda around 19.09 MB. This explains why pruning old deployments is useful, but it still does not establish an exact billed-storage delta.

### Remaining optional cleanup

The single `--safe`-retained Preview `dpl_BVQJ8KWNtBMGYSd6TVXP9k5ibzyf` may be reviewed separately if the Owner wants to remove its historical alias association.

Old Production deployments were intentionally preserved and require a separate evidence/rollback review before any deletion.

Roadmap continuity remains unchanged:

**G06.1 — Anti-Buddy-Punching Hardening, Phase 0 architecture/threat-model audit — OPEN / NEXT PHASE.**
