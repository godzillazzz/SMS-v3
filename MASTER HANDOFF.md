# MASTER HANDOFF

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

## Final Theme Fix Production Closure � 2026-09-28

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

## Enterprise Quality Closure � 2026-09-28

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

## Production Hardening Release Gate � 2026-09-28

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

## Observability + Performance Optimization Release � 2026-09-28

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

## Production Operations Acceptance Closure � 2026-09-28

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


## Phase 5 Production hardening / post-release validation — 2026-09-28

### Scope completed without privileged credentials
- Re-audited the existing observability foundation instead of duplicating it. The application already has sanitized structured logging, request duration telemetry, bounded runtime p50/p95/error summaries, ADMIN-only System Health, database readiness, alert policy/dedup/cooldown, and production monitoring/incident runbooks.
- Backend dependency audit: `npm audit --audit-level=high` -> 0 vulnerabilities.
- Frontend dependency audit: `npm --prefix frontend audit --audit-level=high` -> 0 vulnerabilities.
- Environment contract definition gate: PASS, 66 source-validated keys.
- Prisma format check: PASS.
- Prisma schema validation: PASS when supplied non-secret CI-shaped validation URLs; no live database connection was required for schema validation.
- Frontend TypeScript no-emit check: PASS.
- Full frontend Vitest: 111/111 files, 740/740 tests PASS.
- Frontend production build + bundle verifier: PASS. Main JS 370,911 bytes (<400 KB gate), GIS/map 151,947 bytes (<300 KB gate), main CSS 682,755 bytes (<700 KB gate), 43 JS chunks.
- Build-generated `frontend/tsconfig.tsbuildinfo` was restored and is not part of this checkpoint.

### Backend local-suite environment boundary
- A bare local `npm test` was attempted without production/test database secrets. It executed 1,106 tests: 1,084 passed, 21 failed, 1 skipped.
- The 21 failures were environment-bound: missing `DATABASE_URL` / `JWT_SECRET` and Prisma tests that require a database. This shell does not have the CI PostgreSQL service or approved database credentials.
- These failures are not classified as application regressions. The repository CI workflow remains the authoritative database-backed gate because it provisions PostgreSQL and the required test-only environment before `npm test` / integration tests.
- No source code was weakened or changed to make environment-dependent tests pass.

### Authenticated E2E readiness
- Existing ADMIN / MANAGER / VIEWER Playwright harness is complete and fails safe: role tests are skipped unless each role has a complete approved credential pair.
- No credential was invented, copied from documentation, or exposed.
- UAT configuration contract tests: 6/6 PASS, including HTTPS base URL validation, partial-credential rejection, diagnostics redaction, and console allowlist behavior.

### Current Production drift and verification
- During post-release validation, Production was found to have moved after the prior Phase 4 closure. The current deployment is `dpl_3eXALHeYHRsYC6ZDuTMmb3v2VVKs` at `https://sms-v3-staging-6c104vha5-godzillazz.vercel.app`, created 2026-09-28 10:58:38 ICT; Vercel reports target `production`, status `Ready`.
- `https://sms-v3-staging-ten.vercel.app` resolves to this current deployment. The explicit alias `https://sms-v3-staging-godzillazzz.vercel.app` also resolves from this deployment according to `vercel alias ls`.
- Current authenticated artifact verification: HTTP 200, ETag `"c60cb211ad516e6bb22d46f631603a3f"`, main asset `assets/index-CMmA1f21.js`, stylesheet `assets/index-C6E_BkOL.css`.
- This differs from the earlier Phase 4 promoted artifact (`dpl_8vCrbakayeAb5yAqAV8ixfDXFYAh`, ETag payload `a22384aecafc573aba6a79cc9860a82b`). No rollback or alias overwrite was performed because the newer current Production was already Ready and passed the gates below.
- Direct Production `/api/v1/health`: HTTP 200 `{"status":"ok"}`.
- Direct Production `/api/v1/ready`: HTTP 200 with `status=ready` and `database=ok`.
- Production technical Playwright re-run: 4/4 PASS (health/readiness/assets/audit 401 boundary + login browser smoke at 390/768/1440).
- Full Production Playwright run: 33 discovered, 10 PASS, 23 SKIP, 0 FAIL. Credential-gated ADMIN/MANAGER/VIEWER and authenticated responsive scenarios account for the intentional skips; all runnable regression and technical scenarios passed.
- Deployment Protection was not weakened.

### Remaining external/credential-gated work only
- Real authenticated ADMIN / MANAGER / VIEWER workflow execution remains gated on approved real UAT credentials. The harness is already prepared; no code work is required before credentials are supplied.
- Database-backed local/integration execution remains gated on the CI PostgreSQL service or an explicitly approved disposable test database. CI already defines that environment.
- Global production telemetry/SLA cannot be inferred from the in-process rolling telemetry by design; the System Health surface correctly labels it `CURRENT_RUNTIME_INSTANCE` and not global metrics.

### Safety / rollback / final state
- Previous rollback reference remains `dpl_ChtNFvkW8vZ1qxdReZMZJnc1Q78Z` unless release governance designates a newer rollback target.
- The Phase 4 promoted deployment `dpl_8vCrbakayeAb5yAqAV8ixfDXFYAh` remains a known verified release artifact but is no longer the current Production deployment.
- The dirty main worktree `C:\40.AI\_sms_v3_roster_prod` was not touched.
- Phase 5 introduced no application source, database, RBAC, or deployment-protection changes; only verification evidence and this handoff closure are being committed.


## Phase 5 acceptance addendum — authoritative CI closure — 2026-09-28

### Database-backed CI evidence
- GitHub Actions CI run `36378124196` for exact commit `2a673a854ae77fc702f8fbf22ae07b44041f54d5` completed successfully.
- The CI validate job provisioned the repository-defined disposable PostgreSQL 16 service; no production database or production database credential was used.
- Successful gates included dependency install, backend/frontend high-severity audits, environment governance contract, Prisma format/validate/generate, test migration, seed, migration status, `npm test`, `npm run test:integration`, authoritative Attendance event integration, full frontend tests, TypeScript no-emit, production frontend build, bundle verification, tracked build-metadata restoration, and repository hygiene.
- This authoritative database-backed success closes the uncertainty from the earlier bare-shell local run whose 21 failures were caused by absent database/JWT environment. Those local failures are not an outstanding regression.

### Release acceptance state
- Current canonical Production remains deployment `dpl_3eXALHeYHRsYC6ZDuTMmb3v2VVKs`, target production, status Ready.
- Existing rollback workflow validates project/org/deployment identity, requires explicit confirmation, promotes only an existing Ready production deployment, and verifies canonical health after rollback; it does not roll back database migrations.
- Existing automated UAT workflow is manual/dispatch-driven and already includes technical smoke plus artifact leak scanning. It was not dispatched from this addendum because Production technical/full runnable smoke was already executed directly during Phase 5 and passed.
- Remaining acceptance work is strictly external/privileged: approved real ADMIN/MANAGER/VIEWER credentials for authenticated workflows and any human business-owner sign-off.


## G06 current-baseline re-audit — 2026-09-28

### Why the August handoff is no longer a complete status source
- The August G06 Department ↔ SecuritySite closure correctly stated `ATTENDANCE_V1_100_PERCENT=NO` for that historical gate, but the current branch contains substantial later Attendance V1 implementation.
- Current source includes dedicated services for event acceptance, result derivation, supervisor reads, corrections/adjustments, month governance/certification, official reporting, device enrollment, readiness, Site evidence, face verification, and retention-related operations.
- Current integration inventory includes Attendance event workflow, verification context, adjustment V4, governance, device enrollment, and SecuritySite authority/open-session pinning suites.

### Current evidence gathered without privileged credentials
- G06 security/face/provisioning targeted backend suite: 37/37 PASS.
- Focused frontend G06/Attendance/SecuritySite suite: 17 files, 115/115 tests PASS.
- Broader local Attendance/Schedule/SecuritySite unit selection executed 238 tests: 230 PASS and 8 FAIL. The observed failures are local-environment bound (missing `DATABASE_URL` / `JWT_SECRET` and direct Prisma initialization without a local database), not a newly identified deterministic source regression.
- The exact branch already has authoritative database-backed CI success recorded for commit `2a673a8`, including `npm test`, integration tests, authoritative Attendance event integration, frontend tests, TypeScript, build and bundle verification.

### Attendance capabilities now evidenced in current source/tests
- Server-authoritative CHECK_IN/CHECK_OUT event commit, idempotency, immutable event/session rules and server-time semantics.
- Expected/actual Site handling, assist-other-site outcome, QR hashing/revocation/version authority, GPS accuracy/freshness/geofence and uncertainty-aware QR step-up.
- Approved schedule and auto-schedule authority, Bangkok work-date handling, overnight shifts and expectation pinning.
- Attendance result vocabulary including late, early-out, absent, missing check-in/out, leave and time-abnormal behavior.
- Supervisor daily/history/detail read models and attention summaries.
- Governed correction/adjustment flow, monthly governance/certification and official certified-report projection/XLSX generation.
- Device enrollment/governance, face-verification fail-closed boundaries, routine no-retention rules and Preview-only UAT provisioning controls.

### Remaining gates that still require external evidence
- Do not claim G06/Attendance V1 100% complete from automated code evidence alone.
- Physical/on-device PWA, camera/face Active Challenge, GPS/permission behavior and real mobile-browser UAT still require approved real device/user execution.
- Real authenticated role workflows still require approved UAT credentials.
- Any business acceptance of payroll/timekeeping interpretation and certified official reports requires human owner sign-off.
- Production mutation/release is not authorized by this re-audit.


## Deferred approval identity requirement — 2026-09-28

- Product requirement: every approval flow in SMS must record and display the human approver's name, using the Leave approval experience as the reference behavior.
- This applies across all current and future approval workflows, not only Leave. Approval history/detail surfaces should make it clear who approved each action rather than showing only a generic status, role, or system action.
- Preserve the underlying authoritative approver identity/audit trail so the displayed name can be traced back to the actual authenticated approver.
- This requirement is intentionally deferred. Do not implement broad approval-flow changes as part of the current G06/GPS work; schedule the cross-system approval-name consistency work for a later phase.

## G06 GPS-only Attendance Step 2 Preview checkpoint — 2026-09-28

### Goal and isolation model
- Purpose: prove the real Schedule -> Site -> GPS/geofence -> optional QR -> CHECK_IN/CHECK_OUT event pipeline before returning to Face Verification debugging.
- This is Preview/UAT only. Production routing does not expose the GPS-only event endpoint.
- GPS-only UAT events are never represented as Face-verified events.

### Application and database invariants
- G06 GPS-only Attendance event implementation: `ef96af5 feat(g06): record preview GPS-only attendance events`.
- Migration split/fix: `f2121bb fix(g06): split GPS UAT enum migration`.
- AttendanceEvent provenance now includes `GPS_ONLY_UAT`.
- `ONLINE` events remain database-constrained to require a non-null `face_verification_session_id`.
- `GPS_ONLY_UAT` events are database-constrained to require `face_verification_session_id IS NULL`.
- GPS-only UAT events still use server-authoritative event intent, Schedule/Site authority, GPS/geofence/QR validation, server received time, idempotency, CHECK_IN-before-CHECK_OUT rules, AttendanceSession open/close behavior, and audit logging.
- UI clearly labels Face and Device as bypassed for UAT and displays GPS-only UAT success separately from the normal Face flow.

### Authoritative CI and Preview migration
- Final migration-guard source commit: `850b0a4 ci(g06): allow exact preview prerequisite migration set`.
- Exact-source CI run `36398527615`: SUCCESS.
- Preview migration run `36398557141`: SUCCESS.
- Preview target fingerprint guard proved the Preview database target is distinct from Production before mutation.
- The exact pending set applied was:
  - `202609240001_add_supervisor_user_role`
  - `202609250001_add_schedule_roster_order`
  - `202609280001_g06_gps_only_uat_event_provenance`
  - `202609280002_g06_gps_only_uat_event_provenance_constraint`
- Post-migration verification proved migration state current and the GPS/Face provenance invariants present.
- No Production database migration was run as part of this G06 checkpoint.

### Testable Preview artifact
- Deployment: `dpl_AGTe9D5W5Fyuxbtw4disay274bWC`
- URL: `https://sms-v3-staging-iwu85uv3t-godzillazz.vercel.app`
- Target: Preview
- Status: Ready
- Build flag: `VITE_G06_GPS_ONLY_UAT=true`
- `/api/v1/health`: PASS (`status=ok`)
- `/api/v1/ready`: PASS (`status=ready`, database ok)
- Unauthenticated `POST /api/v1/attendance/uat/gps-events`: HTTP 401, proving the UAT event path still requires authentication.
- Deployed Attendance bundle contains the GPS UAT flow and user-visible copy including `ลงเวลา GPS (UAT)`, `GPS-only UAT บันทึกเวลาแล้ว`, Face/Device bypass disclosure, and `GPS_ONLY_UAT` provenance wording.

### Next physical UAT
1. Open the Preview URL on a real mobile device and authenticate with an approved account.
2. Open Attendance and allow precise location.
3. While inside the configured Site geofence, press `ลงเวลา GPS (UAT)`.
4. Complete QR Step-up if Server policy requests it.
5. Expected CHECK_IN result: Server creates an AttendanceEvent with `provenance=GPS_ONLY_UAT`, server-received timestamp, and no FaceVerificationSession.
6. Re-open/refresh Attendance and verify the committed CHECK_IN is reflected in the self-service state/history.
7. Repeat for CHECK_OUT; the same AttendanceSession must close and CHECK_OUT must not be possible before CHECK_IN.
8. Also test an outside-geofence location or otherwise invalid Site evidence and confirm the event is rejected.
9. After GPS CHECK_IN/CHECK_OUT behavior is proven on-device, resume Face debugging one layer at a time: Device Proof -> Face Match -> Active Challenge.

### Do not claim yet
- G06 is not 100% accepted until the physical mobile GPS/permission test above passes and later Face/on-device UAT is completed.

## G06 Preview fixture Attendance-authority follow-up — 2026-09-28

### Physical UAT evidence received
- Real iPhone test proved GPS acquisition works on-device with reported accuracy around 6–8 meters.
- First blocker was `ACCOUNT_NOT_ELIGIBLE`; the reserved Preview fixture account was then used and the Employee/User linkage became valid.
- Next blocker was Schedule authority: the Attendance page reported that no current approved/authoritative shift assignment could be resolved.

### Read-only Preview diagnosis
- Read-only diagnostic run `36403494314` verified the Preview target before reading and performed no database mutation.
- Reserved fixture `UAT-G06-20260911-01` is active, correctly linked to an active VIEWER account, department `UAT-PREVIEW`.
- Bangkok test date: `2026-09-28`.
- Today Shift Assignments: none.
- Current-month ScheduleApproval: `APPROVED`, revision `2`; therefore no broad monthly approval mutation is required or permitted for this fix.
- Active Day Shift `D` exists (`07:00–19:00`).
- `UAT-PREVIEW` has no Department Default Site mapping.

### Narrow Preview-only remediation
- Commit `75665de feat(g06): prepare preview attendance authority from GPS`.
- Added ADMIN-only `/admin/g06-uat/attendance-authority` flow for the reserved G06 fixture.
- Admin mobile UI adds `เตรียม Attendance UAT จาก GPS ปัจจุบัน` after the fixture is loaded.
- The flow requests one-shot high-accuracy GPS, requires fresh/accurate evidence, and selects only an ACTIVE Security Site for which `distance + accuracy <= geofence radius`.
- It requires the month to already be `APPROVED`, uses active Shift `D`, creates only today's locked ShiftAssignment for the reserved G06 fixture with explicit Site provenance `G06_PREVIEW_UAT`, and never changes ScheduleApproval.
- Exact matching G06 assignment is idempotent; any existing non-G06 assignment for that Employee/date is fail-closed and is never overwritten.
- Audit records the explicit Site, GPS distance/accuracy, schedule approval revision, and `productionChanged=false`.
- If current GPS is not confidently inside any Active Security Site, the flow fails with `G06_UAT_SITE_NOT_CONFIDENT_INSIDE`; Site configuration is then the next layer to fix rather than bypassing geofence authority.

### Validation and deploy evidence
- Backend targeted provisioning/authority tests: 13/13 PASS.
- Broader G06/Attendance backend suite: 70/70 PASS.
- Frontend targeted G06/visual tests: 30/30 PASS.
- Full frontend regression: 111/111 files, 743/743 tests PASS.
- TypeScript: PASS.
- Production-style frontend build + bundle verifier: PASS (main ~372 KB, map ~152 KB, CSS ~685 KB).
- Authoritative exact-source CI run `36406126356`: SUCCESS, including DB migrate/seed/status, backend tests, integration, authoritative Attendance integration, frontend tests, TypeScript, build, bundle verification, and repository hygiene.
- Preview deployment: `dpl_E4vYjXF9esLxfirQx5fNAiRP2Vim`.
- Preview URL: `https://sms-v3-staging-pstg8cq32-godzillazz.vercel.app`.
- Deployment target: Preview; state: READY.
- `/api/v1/health`: PASS; `/api/v1/ready`: PASS with database ok.
- Unauthenticated POST to `/api/v1/admin/g06-uat/attendance-authority`: HTTP 401.
- Deployed Access Management bundle contains one-shot geolocation, high-accuracy mode, `GOVERNED_PREVIEW_ONLY`, `ScheduleApproval`, and the new Attendance UAT preparation UI.
- Production was not deployed, promoted, aliased, migrated, or mutated.

### Next physical action
1. Login to the new Preview as ADMIN.
2. Open Access Management -> G06 Preview UAT Fixture.
3. Load the existing fixture (`สร้าง G06 Preview UAT fixture`; existing fixture is returned idempotently).
4. Press `เตรียม Attendance UAT จาก GPS ปัจจุบัน` at the physical test Site and allow precise location.
5. If successful, verify Site / Shift D / Approved rev 2 are shown.
6. Logout ADMIN, login `uat-g06-20260911-01@example.invalid`, open Attendance and press `ลงเวลา GPS (UAT)`.
7. If the preparation step says no Active Security Site contains the current GPS, stop there and fix Site configuration; do not bypass the Site/geofence gate.
## G06 GPS authority PostgreSQL + Face-prerequisite preflight checkpoint — 2026-09-28

### Work completed while physical-device UAT is pending
- Added real PostgreSQL integration coverage for the Preview-only G06 Attendance-authority preparation path in commit `ad9ac42 test(g06): verify preview attendance authority on postgres`.
- CI run `36416551347`: SUCCESS. The isolated PostgreSQL suite proved real Prisma/DB behavior for G06 authority preparation, including create, exact retry idempotency, outside-geofence fail-closed behavior, non-G06 assignment conflict protection, ScheduleApproval non-mutation, audit persistence, and transaction rollback if audit persistence fails.
- Updated GPS-only UAT contract/runbook in `5f3a53e test(g06): lock GPS UAT step-up and refresh flow`: strong server-validated GPS may proceed in `GPS_ASSURED` mode without QR; QR opens only for server-derived Step-up/rescan states; committed CHECK_IN refreshes self-service state; CHECK_OUT remains dependent on a committed CHECK_IN.
- Added read-only G06 Face prerequisite preflight in commit `375684d feat(g06): surface read-only face prerequisites`.
- The G06 Admin fixture card now exposes `ตรวจความพร้อมก่อนเปิด Face`, reusing the existing `/employees/:id/onboarding-readiness` endpoint.
- This preflight is read-only and displays server-authoritative Account / Attendance Device / Reference Photo / Schedule / Security Site readiness and blockers.
- The preflight does not request Camera/GPS permission, does not start Face verification, does not call a Face verifier, does not create a verification session, and does not create an AttendanceEvent.
- Face Match, Simple Active Challenge and provider runtime remain separate later gates; preflight READY must not be represented as Face PASS.

### Validation evidence
- Frontend targeted readiness/G06 contract: 26/26 PASS.
- Full frontend regression after preflight: 111/111 files, 744/744 tests PASS.
- TypeScript: PASS.
- Exact-source CI run `36417565028` for `375684da7867755bb0361638c550345e05c5cbb7`: SUCCESS, including audits, env contract, Prisma format/validate/generate, ephemeral PostgreSQL migrate/seed/status, backend tests, integration tests, authoritative Attendance integration, frontend tests, TypeScript, production-style build/bundle verifier and repository hygiene.

### Latest testable Preview
- Deployment: `dpl_E7XdpyXCEFTpVRCDFyUButyYaLqG`.
- URL: `https://sms-v3-staging-a7cmrsrvn-godzillazz.vercel.app`.
- Target: Preview.
- State: READY.
- Source application commit: `375684da7867755bb0361638c550345e05c5cbb7`.
- GPS-only build flag remains enabled for this Preview.
- `/api/v1/health`: PASS (`status=ok`).
- `/api/v1/ready`: PASS (`status=ready`, database ok).
- Unauthenticated POST `/api/v1/admin/g06-uat/attendance-authority`: HTTP 401.
- Unauthenticated GET `/api/v1/employees/:id/onboarding-readiness`: HTTP 401.
- Deployed Access Management bundle contains one-shot geolocation/high-accuracy markers plus Face-prerequisite markers `Attendance Device`, `Reference Photo`, `Face Match`, `Active Challenge`, `provider runtime`, and `Blockers`; main bundle contains `/onboarding-readiness`.
- Production deployment/promotion/alias, Production DB/data/migration, and Production environment mutations for this checkpoint: 0.

### Physical dependency / next action
1. Login to the latest Preview as ADMIN.
2. Open Access Management -> G06 Preview UAT Fixture and load the existing fixture.
3. Optional but useful now: press `ตรวจความพร้อมก่อนเปิด Face` and record the server blockers. This can expose Device / Reference Photo prerequisites without opening Face.
4. At the real test Site, press `เตรียม Attendance UAT จาก GPS ปัจจุบัน`; this physical GPS sample cannot be completed by automation.
5. If Site preparation succeeds, logout ADMIN, login `uat-g06-20260911-01@example.invalid`, then run GPS-only CHECK_IN -> refresh -> CHECK_OUT.
6. Only after the GPS phase passes, resolve any preflight Device/Reference blockers and resume `Device Proof -> Face Match -> Simple Active Challenge`.