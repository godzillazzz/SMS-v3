# MASTER HANDOFF

## ACTIVE — SMSV3-UAT-V3-SELECTIVE-RECOVERY-004 — 2026-10-15

Draft-only selective recovery; Hosted UAT execution is BLOCKED. This task checkpoint makes no new Production-release claim. Integration and its existing handoff remain untouched.

- Base: exact current main `243466a3b9c2c22c47893db753f88e4ca7942658`.
- Branch: `codex/smsv3-uat-v3-selective-recovery-004`; exact committed HEAD is recorded in the Draft PR (avoids a self-referencing commit).
- Recovery sources inspected: #589 `4d27ddc6c918310861153489ae5da9a8a853f5a2`, #590 `ba1073d91a108aec10b7438635b7e30bbe389987`. No wholesale merge, integration merge, stale report or checkpoint recovery.
- Required application: `2a3107fa4282106800f8b265bb877825d258a8ac`, `fix/serverless-database-reliability`.
- Target: `dpl_8Kbj1NMHe4XgTt8WKjiDx6cuTuKz`, https://sms-v3-staging-q9dibfoar-godzillazz.vercel.app.
- Native Vercel GETs by deployment ID AND hostname independently returned this exact ID/URL/SHA/ref/project (`prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s`), READY, target=null, scoped to team `team_nemCExHbZ8EAhSgsvefHPAEz`. GitHub Vercel-bot Preview deployment `7084174546` has a successful status at the same immutable URL. Native dpl↔URL binding VERIFIED; target=null is not used alone as Preview proof.
- `authorized=false`; `database_isolation_verified=false`. All actual database/provider fingerprint and receipt fields remain null. Source-file SHA256 values below are not database fingerprints.

### Security and application contract

Trusted main checkout only; literal Environment `Hosted UAT`; Owner approval, main-only branch policy, required validate check and exact application/control SHA CI gates remain. No PR application checkout receives credentials. Actual Environment metadata was read: sole reviewer godzillazzz, admin bypass=false. Existing CI keeps all original steps, with credential-free Chromium fixtures and collection added.

Existing main exact-deployment verifier is reused for challenge signing and receipt/provider-witness checks; no runtime app, Prisma, schema, migration, database-target implementation or existing isolation workflow is changed. Fresh signed GET receipt, observed principal/cluster witness and independent Production separation are mandatory. Configured env fingerprint plus readiness alone cannot authorize UAT.

Browser network guard covers the whole context (including popup first requests), blocks service workers and WebSockets, rejects non-GET/HEAD/OPTIONS except same-origin login bootstrap, intercepts refresh locally, and refuses cross-origin Cookie/Authorization/Proxy-Authorization/x-vercel forwarding and HTTP redirects. Four distinct accounts, subjects and access tokens are required. Login tests use real login; navigation tests explicitly use API_LOGIN_SESSION_BOOTSTRAP in memory, not a live refresh claim. Trace, screenshots, video and storage-state capture are off. Failure-time DOM capture is disabled; persisted errors are categorical; raw child output is suppressed and temporary browser output removed. Only the scanned categorical JSON summary is uploadable after success.

Routes, selectors, refresh behavior, theme key and role visibility were re-read at the pinned application SHA. Its navigation catalog has 20 IDs: ADMIN 20 required/0 forbidden; MANAGER and SUPERVISOR each 14/6; VIEWER 9/11. These match execution of the pinned canViewRoutePage policy. Standalone approvals and leavePending are legacy routes, not current navigation items. VIEWER employee-linked leave behavior is not inferred from the login payload's omitted employeeId. Main's older app is not misrepresented as the Preview app.

### Validation before Draft PR

- Focused security/workflow/isolation plus existing exact-deployment tests: **49 passed, 0 failed, 0 skipped**.
- Chromium synthetic isolation fixtures: **8 passed, 0 failed, 0 skipped**. No hosted login, database, Storage or business data used.
- UAT collection only: **exactly 24 tests, 0 skipped**, six per role. Authenticated UAT was NOT executed.
- Current main CI: [38670558108](https://github.com/godzillazzz/SMS-v3/actions/runs/38670558108), SUCCESS at exact base SHA. No workflow dispatch performed.
- Local full backend: **370 passed / 8 failed / 0 skipped** (378 total); missing PostgreSQL and PowerShell prerequisites. Database URL pointed to unreachable loopback port 1; no database contact or migration. These failures are not represented as green local full CI.
- Frontend typecheck and production build passed after npm ci aligned local dependencies with unchanged main lockfile. Generated tracked tsbuildinfo restored to original bytes.
- npm audit --omit=dev --audit-level=high passed (one pre-existing moderate csv-parse advisory; no unrelated upgrade).
- git diff --check clean; no secrets printed. Initial Chromium runs failed for missing binary/system libraries; final real Chromium run above passed after installation.

### Remaining evidence / execution blockers

Eight Hosted UAT role secrets absent from both Environment and repository secret-name inventories: `UAT_ADMIN_EMAIL`, `UAT_ADMIN_PASSWORD`, `UAT_MANAGER_EMAIL`, `UAT_MANAGER_PASSWORD`, `UAT_SUPERVISOR_EMAIL`, `UAT_SUPERVISOR_PASSWORD`, `UAT_VIEWER_EMAIL`, `UAT_VIEWER_PASSWORD`. Names only were read; no secret values were retrieved or changed.

Missing independent Preview and Production logical DB fingerprints and their authoritative evidence runs; approved runtime principal; independent Preview and Production cluster fingerprints; Production DB/Storage project refs; fresh signed runtime receipt tied to this deployment, nonce, source and host, including read-only transaction/observed principal/cluster witness and private bucket metadata proof. No health/readiness or provider/runtime request was used as a substitute. No new attestation workflow was dispatched. Reuse the existing T39/isolation evidence lineage ([archive #614](https://github.com/godzillazzz/SMS-v3/issues/614), existing exact-deployment workflow) under separate authorization; the archive is not current isolation PASS evidence.

Production, production aliases, all databases, Storage, secrets, business data, Prisma schema and migrations are untouched. No workflow dispatch, Environment review, merge, promotion or deployment action was performed.

### Guard SHA256 comparison

The reused main verifier `scripts/ci/r6b-exact-deployment-isolation.cjs` is byte-identical to base main: `d8c64ac2db53eba4ef8b7a2fc1a0895e34dfb874d8442a6f65b1b18e4cbaf86a` (base=working). All 21 source pins below were independently recomputed from the required application commit and match the target manifest, 21/21. Runtime deployed-byte equivalence is NOT claimed without runtime/source attestation.

| Pinned source file | SHA256 at required application SHA = manifest | Recovery comparison |
|---|---|---|
| `src/app.js` | `84f550cf098235c70e0dc0647d668a9a7feb6214d720bcf16ceec316a113eb04` | recomputed; replaces stale #590 pin |
| `src/config/prisma.js` | `516648ca43a9b1c9f2dc03e70edc2ee3e4ec000fb30c21bd5bfeb51458495614` | unchanged from #590 |
| `src/services/runtime-database-target-guard.service.js` | `011ec22787a0efe456bf35fbb99d88f0e03ac9047876882896c3cc02c18aa647` | unchanged from #590 |
| `src/utils/database-target-identity.js` | `6f3b961c5affc78284f24ac68f1db1a4e79f1f40549d42b76613d582b53e1067` | unchanged from #590 |
| `frontend/src/main.tsx` | `fb1f75c4ad0121ac5f41c40858d1bef8881dd9bf542126883b680ca9b3ffc698` | recomputed; replaces stale #590 pin |
| `frontend/src/theme.ts` | `051a3a380526c4a09fcf4f7f15d174b80352d96efd99a228800dbe67d115e69c` | recomputed; replaces stale #590 pin |
| `src/services/runtime-isolation-probe.service.js` | `f734567127864026f8f491781398dcef9cb5d57da0b768c2c954832bc6fd3004` | new dependency pin |
| `src/routes/runtime-isolation-probe.routes.js` | `d900ef0710fb580ca7115bf1e4cf5c43042decbabcda5053ca83506518b8b9f6` | new dependency pin |
| `scripts/ci/r6b-isolation-receipt-contract.js` | `3e75ef0c52e25d1c0fe21e95b9c1b8a4b112de6c652ad32847988018c716e010` | new dependency pin |
| `frontend/src/routing.ts` | `f892acaa6d0b31951a4893528826e06d0e35ad9f2c73237587c4678451906fbb` | new dependency pin |
| `frontend/src/api.ts` | `b0144981af17f3b286158a7a82277656bab79097242d1a563b1b157a96378b18` | new dependency pin |
| `src/routes/auth.routes.js` | `05dfde9e9b8fd118bd9b08757368d8a2ec1b708086d463ad66d8d591276e3e12` | new dependency pin |
| `src/routes/operations.routes.js` | `3ff5bed6dcee53a4547d2f3ad9c58ed8318d843305f8d0b0abd690a821cd1355` | new dependency pin |
| `src/routes/approval-center.routes.js` | `e812c6a8637836eb6586fbf1e03c2e2d330a20aa95442fc0ba7b3f547f454d79` | new dependency pin |
| `src/routes/users.routes.js` | `53a89358af164e26f5fc7c92ca52b1923dabb9914209250b21a6b1913701e57f` | new dependency pin |
| `src/routes/personnel-masters.routes.js` | `9d7b47ff5ec3412edec8fa0e4a2cf4252b65534832dd8793f9c26b0d4f0e0ded` | new dependency pin |
| `src/routes/data-quality.routes.js` | `5db1385872fc7374f8428da7bd632fa8e90170b22e60af73f49394a8760baeda` | new dependency pin |
| `src/routes/system-health.routes.js` | `94edf83aa1a441542cfcf054debb4297fd3fa0592183f4e0d337975ae6d43616` | new dependency pin |
| `src/routes/security-sites.routes.js` | `62f974dca30255cb2568282cb7c4140598a5de6de3f30eafa5429a88a7d1a37a` | new dependency pin |
| `src/routes/employees.routes.js` | `f9ff23bc4abc6761982054465a5b5befd4c7b10ac4a5354436c84794aa59cb0d` | new dependency pin |
| `src/routes/shifts.routes.js` | `2278e04ba16a423dadd6b9e65d8a60586aebae2f3691a392dbc1f238f66b9461` | new dependency pin |
