# R5-B alternate Business Acceptance and non-dispatchable release-preparation record — 2026-10-09

## Decision and scope

The Owner explicitly accepted **local API Integration 77 PASS and local Chromium Browser Smoke 2 PASS** as alternative R5-B Business Acceptance evidence, with documented exceptions and risks. This decision is **NOT** authorization to deploy, dispatch an official workflow, approve a protected Production environment, change Production data, or lower security gates. Issue [#551](https://github.com/godzillazzz/SMS-v3/issues/551) is the audit register.

The local result does **not** imply that Q13B/Q13C complete targeted hosted Preview Browser mutation suites have been executed. Business Acceptance is **accepted with known exceptions**, not a claim of complete workflow-browser coverage.

## Verified immutable evidence

| Item | Reference and status |
| --- | --- |
| Frozen App SHA | 77641a2657aa4fd05276afe645dd32648f5cc56b |
| Frozen App Git tree | f67e7a7a6895ca0fbbea8582543882feb36505b3 |
| Frozen App exact-SHA CI | [#37803174443](https://github.com/godzillazzz/SMS-v3/actions/runs/37803174443) SUCCESS |
| Technical Preview Smoke | [#37868555108](https://github.com/godzillazzz/SMS-v3/actions/runs/37868555108) SUCCESS |
| Authenticated Full Preview UAT | [#37874884949](https://github.com/godzillazzz/SMS-v3/actions/runs/37874884949) SUCCESS, but routine full scope excludes Q13B/Q13C mutation |
| Preview read-only CORS/Health/DB | [#37877103246](https://github.com/godzillazzz/SMS-v3/actions/runs/37877103246) SUCCESS when checked |
| Disposable local API/Integration | [#37881816337](https://github.com/godzillazzz/SMS-v3/actions/runs/37881816337) 77 PASS / 0 FAIL / 0 SKIPPED |
| Disposable local Chromium Browser | [#37885251975](https://github.com/godzillazzz/SMS-v3/actions/runs/37885251975) 2 PASS / 0 FAIL / 0 SKIPPED |
| Frozen R5-B Preview | dpl_6SxGPuH374ogrr2mjzwDkincaMCA READY, frozen App SHA |
| Current Production R5-A | dpl_HS3R7QJgKgJdL8DkiXncUHarVgPV READY, SHA 51c5c828689ce543067c687e204eba7918577bb9 |
| Current canonical aliases | sms-v3-staging-ten.vercel.app and sms-v3-staging-godzillazzz.vercel.app both point to R5-A; verify again before dispatch |

## Known Business Acceptance exclusions and accepted risks

1. **Q13B specialist:** Hosted Preview Browser mutations for governed leave decision, schedule-pattern lifecycle and approval-authority exact restoration were not executed. Isolated API integration and limited local Browser smoke are **not** full UI acceptance.
2. **Q13C administration:** Hosted Preview Browser mutations for personnel masters, employee change approval, user lifecycle, security-site configuration and settings updates were not executed. Their original write tests require disposable isolated DB.
3. **Employee License:** Local API tests covered role permissions, CRUD, duplicate license and unauthorized expiry update denial. The local Chromium cases checked login, license inventory/search and leave approval route only. Document upload, review, correction, renewal and object storage teardown are **not covered by the two local browser tests**. Independent API document workflow regressions are not browser document UX acceptance.
4. **Data lifetime:** Disposable GitHub Postgres test data was synthetic and did not exercise shared Preview/Production. Runtime production data changes cannot be undone by code rollback, especially attendance, license decisions and monthly approved schedules.
5. **Mitigation:** No ungated promotion; require separately approved Owner Production authorization, protected GitHub Environment review, fresh canonical and rollback checks, unchanged schema/security/env policy, production sentinels and code rollback; never weaken gates to obtain a PASS.

## Non-dispatchable manifest and rollback status

- Draft file: .github/releases/r5-b-production-manifest-draft.json
- Manifest state: DRAFT_SEPARATE_PRODUCTION_APPROVAL_REQUIRED
- Owner action: PENDING_SEPARATE_PRODUCTION_APPROVAL
- Owner frozen-SHA approval: PENDING_NOT_AUTHORIZED; production_dispatch_authorized=false.
- App SHA, Git tree and source branch pin immutable R5-B App.
- Current READY R5-A is the intended previous-production source AND rollback candidate, rather than the predecessor of R5-A.
- GitHub compare of R5-A and R5-B showed **no changes to prisma/schema.prisma or prisma/migrations**, so release policy is NO_DATABASE_CHANGES and run_migrations=false. This does not prove every rollback path.
- Vercel reports current Production R5-A READY with both current canonical aliases. READY metadata is not a live end-to-end rollback exercise.
- Official production manifest .github/releases/approved-production.json remains **R5-A and unchanged**. The Owner production dispatcher reads ONLY that path; it cannot dispatch R5-B from this draft. Do not copy the draft over the approved file before a separate reviewed release-control PR and explicit Owner authorization.

## Remaining NO-GO gates

1. Independently revalidate read-only Production and Preview GET /api/v1/health and GET /api/v1/ready, trusted OPTIONS CORS (204 with exact credentialed headers) and untrusted CORS denial (403). Scoped GitHub Actions performs these checks without API credentials, reports only sanitized markers, and fails closed if network or target denies checks.
2. Reconfirm Vercel project autoAssignCustomDomains=false, production canonical identity and aliases, live runtime checks, database compatibility, environment invariants and source/CI identity through the protected workflow. If stale or not proven, STOP.
3. Review fallback runtime compatibility and non-reversible production data consequences. Never use a real shift assignment change to test rollback because it can reset monthly approval.
4. Prepare R5-B official approved-production.json via a **separate reviewed PR only after Owner authorizes the production batch**. Require exact Control SHA CI, valid manifest, deployment safety and current rollback identity.
5. Ask Owner explicitly for R5-B Production promotion authorization and require separate GitHub protected Production Environment approval. Until then: **NO DEPLOY, NO DISPATCH, NO CANONICAL ALIAS CHANGES, NO PRODUCTION DB MUTATIONS**.

All new evidence must be captured in Issue #551, distinguishing local API/Browser, hosted Preview and Production runtime.
