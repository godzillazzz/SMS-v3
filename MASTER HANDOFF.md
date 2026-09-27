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
