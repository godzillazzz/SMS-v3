# R5-B Official Production Manifest — Separate Owner Decision Package

Prepared 2026-10-09 (Asia/Bangkok). **This file is on an unmerged Draft PR.**
This PR prepares the future official `.github/releases/approved-production.json` R5-B replacement **but it must not be merged under the current Owner authorization**. The current Integration/Production manifest stays R5-A. This is **not** authorization to dispatch, deploy, promote, rollback, migrate, change Production aliases, or write Production data.

## Frozen release and governance identity

- Release Batch: **R5-B**
- Frozen Application SHA: `77641a2657aa4fd05276afe645dd32648f5cc56b`
- Frozen Application tree: `f67e7a7a6895ca0fbbea8582543882feb36505b3`
- Application exact-SHA CI [#37803174443](https://github.com/godzillazzz/SMS-v3/actions/runs/37803174443): SUCCESS
- Draft evidence branch merged through [#581](https://github.com/godzillazzz/SMS-v3/pull/581) into Integration SHA `06cfb4805af5fc7c4ea4ac93c00da3749d7793ca`.
- Legacy stacked PR [#580](https://github.com/godzillazzz/SMS-v3/pull/580) closed as superseded; #578 remains historical Draft.
- Final Production Control SHA MUST be freshly resolved at separate Owner deployment authorization; it must NOT be inferred from a PR head or embedded self-referentially.
- Proposed Manifest `manifest_state=APPROVED_FOR_OWNER_PRODUCTION_DECISION` is a **schema state** used if the PR is later approved/merged, not an Owner Production approval itself.
- Proposed Manifest `production_dispatch_authorized=false`, `owner_batch_frozen_sha_approval=PENDING_NOT_AUTHORIZED`; separate human authorization and GitHub Environment review remain mandatory.

## Technical evidence

- Exact Integration CI [#37916840107](https://github.com/godzillazzz/SMS-v3/actions/runs/37916840107): SUCCESS (earlier integration control).
- Frozen R5-B Technical Smoke [#37868555108](https://github.com/godzillazzz/SMS-v3/actions/runs/37868555108): SUCCESS, 11 PASS, 0 FAIL, 72 SKIPPED.
- Latest integration Preview Technical Smoke [#37924283107](https://github.com/godzillazzz/SMS-v3/actions/runs/37924283107): SUCCESS, 11 PASS, 0 FAIL, 72 SKIPPED, leakCount=0.
- Protected Preview CORS/Config [#37929488390](https://github.com/godzillazzz/SMS-v3/actions/runs/37929488390): SUCCESS; trusted origin HTTP 204 credentialed, untrusted HTTP 403 no Allow-Origin, health/DB HTTP 200, `autoAssignCustomDomains=false`.
- PR #581 exact-head Full CI [#37935245026](https://github.com/godzillazzz/SMS-v3/actions/runs/37935245026): SUCCESS.
- **Historical optional anonymous probe [#37935245058](https://github.com/godzillazzz/SMS-v3/actions/runs/37935245058) FAILED_CLOSED**: Production GET/OPTIONS passed; SSO-protected Preview returned `REMOTE_ACCESS_NOT_VERIFIED`. This is NOT an anonymous Preview PASS and does not override the protected Preview evidence. Repeat failure after #581 merge is retained as exception, not silently passed.
- The R5-B exact Frozen App Preview and latest Integration-control Preview are **different immutable deployments**. Their evidence must not be mislabeled as one identity.

## Business Acceptance and rollback caveats

- Owner accepted alternative Business Acceptance: Local API **77 PASS** and Chromium Browser **2 PASS** only.
- Hosted Q13B/Q13C mutations and Employee License upload/review/renewal Browser UX remain **NOT EXECUTED**. Accepted with residual risk, not equivalent to full hosted acceptance.
- R5-A Canonical and rollback deployment `dpl_HS3R7QJgKgJdL8DkiXncUHarVgPV`, application SHA `51c5c828689ce543067c687e204eba7918577bb9`, READY based on Vercel metadata, no live rollback drill.
- No Prisma schema/migration change between R5-A and frozen R5-B application; `run_migrations=false`. Runtime ShiftAssignment changes cannot be undone by code rollback.
- Post-deploy candidate/canonical Health, DB, trusted/untrusted CORS, Auth, assets, UI sentinels, rollback guards, and Hypercare remain essential if Owner later approves deployment.

## Release decision gates

1. Before even considering merge of the Official Manifest PR: CI exact PR head SUCCESS, independent review of diff/guards, and Owner **separate explicit Production release decision** including exact Frozen App SHA and risks. No implicit approval from Release Control Transition.
2. Only after approval, merge the Official Manifest PR according to governance and verify current Integration HEAD exact CI and `approved-production.json` identity again. Changes to Integration SHA invalidate old Control CI.
3. Official Production Dispatch is a **distinct later action**, with GitHub protected Environment review required; never initiate merely because the Manifest is ready.
4. Fail-closed on drift, missing CI, unexpected Vercel config, schema migration, Rollback not READY, unexpected aliases, or unresolved mandatory gates.

**Current status of this PR: DRAFT / NOT MERGED / PRODUCTION_DISPATCH_NOT_AUTHORIZED.**
