# Authenticated UAT V3 recovery — 9 October 2026

## Identity and scope

Base: `9abc97998f98265605f534de7874607a5f3b5a13` on `fix/serverless-database-reliability`. Source [PR #87](https://github.com/godzillazzz/SMS-v3/pull/87): pinned `ccb6b840ecc090e79bbf906ea45d665a8b790393`, conflicted and not merged. Branch `test/uat-v3-four-role-recovery-20261009` is isolated. Production remains R5-B App `77641a2657aa4fd05276afe645dd32648f5cc56b`; this work does not change application source, Prisma, official release manifests, Vercel configuration or MASTER_HANDOFF.md.

The source PR is analyzed file by file below against its merge base with Integration. Only three reusable modules are ported. Auth/session/config/spec/reporter are reimplemented separately from V2 rather than carrying the old workflow and mutation suites forward.

## Four-role coverage

| Role | Authentication / isolation | Approval visibility | Expected denial | Hosted tests |
|---|---|---|---|---|
| ADMIN | Exact DB subject + role; own token/context | Approval Center + monthly approval | Anonymous/invalid token 401 | 6 planned |
| MANAGER | Exact DB subject + role; own token/context | Approval Center; monthly approval UI forbidden | Audit, settings, quota UI and admin-only routes | 6 planned |
| SUPERVISOR | Exact DB subject + role; own token/context | Approval Center + monthly approval | Audit, settings and admin-only routes | 6 planned |
| VIEWER | Exact DB subject + role; own token/context | Approver UI hidden | Approval Center and privileged API 403 | 6 planned |

Per role: real browser Login; GET API authorization matrix; navigation/approval visibility at desktop 1366×768 and mobile 375×812 in light/dark. Navigation tests use an explicitly disclosed API_LOGIN_SESSION_BOOTSTRAP with refresh fulfilled in memory, not a real server refresh. Login is a separate real UI test. VIEWER employee-linked leave access is **NOT COVERED** because login payload does not establish employee linkage; no invented expected denial. This suite does not claim approval mutations, employee document lifecycle, physical iPhone/PWA, GPS/offline or Q13 mutation acceptance.

Local synthetic Chromium fixture proves independent role sessions and blocked business writes only; it is not application UI/Hosted acceptance. Disposable PostgreSQL integration checks real Login/GET authorization for all four roles without Production accounts.

## Protected workflow security review

`authenticated-uat-v3-readonly.yml` is a proposal, not authorized for execution. It triggers only workflow_dispatch from repository Owner `godzillazzz` on trusted `main`. Both checkouts pin `github.sha`; no input harness SHA, PR checkout, pull_request_target or PR secret execution. contents/actions permissions are read-only; checkout credentials are not persisted. Existing Environment `production-sms-v3-staging` remains human protected.

Before the protected job, reviewed target must have literal `authorized=true`, literal disposable DB isolation true, evidence Run URL, database target fingerprint, exact deployment/SHA/ref/project/team/immutable URL and successful full `validate` job CI for application and trusted main SHAs. The committed target is disabled (`authorized=false`, `database_isolation_verified=false`). Do not fill these fields without actual evidence and separate reviewed authorization. Native Vercel identity is checked with authenticated GET only, exact Preview ownership, READY, canonical alias exclusion and no raw response output. Missing Vercel target is not inferred as Preview: the existing resolvePreview guard independently requires a trusted vercel[bot] GitHub deployment record with environment Preview, literal production_environment=false, exact SHA/ref and matching immutable URL; absent or mismatched proof fails closed.

Login creates refresh session/audit, and authenticated GET may invoke existing lifecycle reconciliation. **HTTP read-only does not guarantee database read-only**. Therefore even this login/GET suite requires verified disposable non-Production DB isolation. No hosted run is authorized by this PR.

Distinct existing accounts and eight Environment secrets (UAT_{ADMIN,MANAGER,SUPERVISOR,VIEWER}_{EMAIL,PASSWORD}) are required. No values are requested in chat, stored in Git, printed or attached. Protected preflight validates each actual role, distinct subject/token and readiness, disposes each API context and sanitizes errors. Local synthetic accounts do not prove Hosted account readiness. Secret endpoints are unavailable through the connector: **UAT_CREDENTIALS_REQUIRED / READINESS_UNVERIFIED** until authorized preflight.

Only GET/HEAD/OPTIONS reach business endpoints. Browser writes are blocked; auth/login is narrowly permitted; refresh bootstrap is memory-only. Redirects are disabled in API requests and browser forwarding; Service Workers are blocked so they cannot bypass interception. Protection headers are scoped to same-origin requests. Traces/video/screenshots/storage state are off; raw test child output is suppressed. Only an allowlisted status summary is scanned for all four roles' secrets and existing token/cookie/auth-state patterns, then uploaded after exactly 24 PASS / 0 FAIL / 0 SKIPPED. Failures do not upload raw artifacts. No protected credentials have been accessed during development.

## Human gates and remaining blockers

1. Review the recovery PR and obtain Full CI SUCCESS and exact native Preview identity/health/readiness/CORS. Provider build-rate-limit is BLOCKED, never bypassed.
2. Independently review/merge only approved harness/workflow to trusted main through normal CI/protection. Integration PR code is never executed with protected secrets.
3. Supply evidence of existing isolated disposable Preview DB and approve a pinned target through reviewed code. Do not change Production environment or create paid resources.
4. Confirm existing authorized four-role accounts/Environment secrets in GitHub UI; do not share values. Account readiness is only proven by the protected preflight.
5. Owner explicitly authorizes Hosted read-only UAT and performs existing GitHub Environment review. No production release authorization is implied.

Full exact-main CI is mandatory; if trusted main lacks an eligible successful validate run, obtain one through the existing reviewed CI mechanism, never weaken this gate.

## Local validation checkpoint

Focused security: 11 PASS. Workflow/identity regression: 5 PASS. Real disposable PostgreSQL role integration: 5 PASS. Chromium network fixtures: 4 PASS (initial sandbox listen failure retained in development logs; successful rerun used authorized loopback access). Hosted suite collection: 24 tests planned, **NOT EXECUTED**. Full validation results and immutable PR/CI/Preview evidence are recorded in the final checkpoint and PR, not inferred from collection. No Production business acceptance is claimed.

## PR #87 file-by-file disposition

| Source file | Decision | Reason |
|---|---|---|
| `.github/workflows/automated-uat-sms-v3-staging.yml` | OMIT | Legacy workflow/platform controls; preserve current Integration and release governance. |
| `.github/workflows/ci.yml` | OMIT | Legacy workflow/platform controls; preserve current Integration and release governance. |
| `e2e/global-setup.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/global-teardown.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/helpers/regression-contracts.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/helpers/technical-smoke.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/helpers/uat-auth.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/helpers/uat-authenticated-request.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/helpers/uat-config.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/helpers/uat-g03-readonly.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `e2e/helpers/uat-heavy-read-v3.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `e2e/helpers/uat-network.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/helpers/uat-observe.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/helpers/uat-performance.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `e2e/helpers/uat-session.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/helpers/uat-stage.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/helpers/uat-target-contract.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/helpers/uat-test.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/helpers/uat-v3-artifact-preflight.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/helpers/uat-v3-harness.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/helpers/uat-v3-role-matrix.js` | SELECTIVE PORT → `e2e/uat-v3/role-matrix.js` | Add Supervisor and align current API/navigation guards; Bangkok dates. |
| `e2e/helpers/uat-v3-security.js` | SELECTIVE PORT → `e2e/uat-v3/security.js` | Preserve scanner; add Supervisor credentials and summary. |
| `e2e/helpers/uat-vercel-identity.js` | SELECTIVE PORT → `e2e/uat-v3/vercel-identity.js` | Reuse sanitized deployment identity; no raw response artifacts. |
| `e2e/smoke/admin.spec.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/smoke/auth-boundary-v3.spec.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/smoke/authenticated-v3.spec.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/smoke/disposable-employee.spec.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `e2e/smoke/g03-readonly.spec.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `e2e/smoke/performance-validation.spec.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `e2e/smoke/q13b-specialist-write.spec.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `e2e/smoke/q13c-business-workflow.spec.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `e2e/smoke/regression.spec.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/smoke/responsive.spec.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/smoke/roles.spec.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/smoke/technical.spec.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `e2e/uat-reporter.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `playwright.config.js` | OMIT / REIMPLEMENT | Keep existing V2 unchanged; scoped V3 implementation with trusted-main and write blocking. |
| `scripts/admin/disposable-uat-employee.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `scripts/admin/q13b-preview-fixture.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `scripts/admin/q13c-preview-fixture.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `scripts/ci/g03-1-auth-persona-preflight.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `scripts/ci/verify-q13-disposable-preview-target.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `test/department-transfer-baseline.test.js` | OMIT / REPLACE | Old harness assumptions; new focused contracts and real disposable four-role integration tests. |
| `test/disposable-uat-browser-contract.test.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `test/disposable-uat-employee.test.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `test/g03-1-auth-persona-preflight.test.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `test/integration/disposable-uat-employee.integration.test.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `test/q13-disposable-preview-target.test.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `test/q13b-specialist-write-scope.test.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `test/q13c-business-workflow-scope.test.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `test/uat-auth-contract-v31.test.js` | OMIT / REPLACE | Old harness assumptions; new focused contracts and real disposable four-role integration tests. |
| `test/uat-auth-origin-v32.test.js` | OMIT / REPLACE | Old harness assumptions; new focused contracts and real disposable four-role integration tests. |
| `test/uat-authenticated-request.test.js` | OMIT / REPLACE | Old harness assumptions; new focused contracts and real disposable four-role integration tests. |
| `test/uat-config.test.js` | OMIT / REPLACE | Old harness assumptions; new focused contracts and real disposable four-role integration tests. |
| `test/uat-g03-readonly-targeted.test.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `test/uat-load-shaping-v3.test.js` | OMIT / REPLACE | Old harness assumptions; new focused contracts and real disposable four-role integration tests. |
| `test/uat-nondashboard-bootstrap-v33.test.js` | OMIT / REPLACE | Old harness assumptions; new focused contracts and real disposable four-role integration tests. |
| `test/uat-performance-validation.test.js` | OMIT | Mutation/provisioning or unrelated G03/performance scope; no hosted isolation authorization. |
| `test/uat-stage.test.js` | OMIT / REPLACE | Old harness assumptions; new focused contracts and real disposable four-role integration tests. |
| `test/uat-target-contract.test.js` | OMIT / REPLACE | Old harness assumptions; new focused contracts and real disposable four-role integration tests. |
| `test/uat-target-scope.test.js` | OMIT / REPLACE | Old harness assumptions; new focused contracts and real disposable four-role integration tests. |
| `test/uat-v3-artifact-preflight.test.js` | OMIT / REPLACE | Old harness assumptions; new focused contracts and real disposable four-role integration tests. |
| `test/uat-v3-preflight.test.js` | OMIT / REPLACE | Old harness assumptions; new focused contracts and real disposable four-role integration tests. |
| `test/uat-v3.test.js` | OMIT / REPLACE | Old harness assumptions; new focused contracts and real disposable four-role integration tests. |
| `test/uat-vercel-identity.test.js` | OMIT / REPLACE | Old harness assumptions; new focused contracts and real disposable four-role integration tests. |
| `vercel.json` | OMIT | Legacy workflow/platform controls; preserve current Integration and release governance. |

## Full local validation — completed before publication

- Backend unit suite: **1388 PASS / 0 FAIL / 0 SKIPPED** after restoring existing PowerShell runtime and explicit disposable DB environment. Earlier environment-only failed runs are retained in task logs.
- Full integration on dedicated UTF8 `sms_v3_test`: **195 PASS / 0 FAIL / 7 SKIPPED**. Skips remain skips; separate authoritative G06 event/support-Site runner: **4 PASS**, physical verifier SQL/read-only enforcement: **1 PASS**. This SQL test is not physical iPhone UAT.
- Four-role real Login/GET matrix: **5 PASS** in exclusive synthetic database.
- Frontend: **928 PASS**; TypeScript `tsc --noEmit`, Vite production build and bundle verifier PASS. CSS **699,944 / 700,000 bytes**; unchanged budget.
- Existing Chromium regression suite: **42 PASS / 3 FAIL** initially (local navigation/lazy-loading timeouts); targeted unchanged-test rerun **3 PASS**. The initial failures remain disclosed; exact CI must independently pass. New role network fixtures: **4 PASS**.
- Dependency audits: backend/frontend **0 vulnerabilities**. Prisma formatting/validation and environment contract PASS. actionlint PASS with unavailable shellcheck/pyflakes explicitly disabled; Node syntax and `git diff --check` PASS. No separate project lint command exists.
- Hosted V3 collection: **24**, Hosted execution **NOT EXECUTED**. Initial exact PR head `0fa2f6582dc4a38d416b1480982baf463dd1e3d1`: [PR #589](https://github.com/godzillazzz/SMS-v3/pull/589), [CI #37957294459](https://github.com/godzillazzz/SMS-v3/actions/runs/37957294459) SUCCESS, including exact Preview health/readiness/CORS. Native Preview `dpl_DkpWnbaJR3XD33no3yWtwmFXCLrT` READY and exact SHA/ref/project matched. The authoritative Preview-environment guard follow-up changes HEAD, so new exact CI/Preview are required; earlier results are historical.

Local raw logs stay outside Git under `/tmp/sms-uat-recovery-*`; they contain only synthetic test data and are not Hosted artifacts. Generated frontend build metadata was restored to its original tracked bytes and excluded.

## Phase 2B — security and isolation readiness (2026-10-09 UTC)

**Hosted status: BLOCKED; implementation prepared for independent review.** Baseline PR #589 head `a3170aaf8e418649c00e3533e08e355feeb8f034`, exact [CI #37957937753](https://github.com/godzillazzz/SMS-v3/actions/runs/37957937753) SUCCESS is historical after this hardening patch. New immutable HEAD/CI/Preview evidence is recorded in PR #589 metadata to avoid self-referencing commits. Neither target authorization flag is enabled. No Protected UAT, secret inspection, Production changes or app/schema edits occurred.

### File-by-file security review checklist

| File / boundary | Finding and verification | Status |
|---|---|---|
| `.github/workflows/authenticated-uat-v3-readonly.yml` | Manual dispatch only; exact repository, named Owner and main ref; checkout exact workflow commit, not PR/input code; read-only token permissions; existing protected Environment. Actions pinned to official immutable commits. Vercel credentials only in identity step; eight account secrets only in UAT step. No pull_request_target, deployment/migration or artifact-on-failure. Independent review required before main integration. | Static PASS; Human review pending |
| `scripts/ci/verify-uat-v3-trust.js` | Unprotected read-only GitHub token verifies current main protection/head and four exact application runtime-file hashes via GitHub Contents GET. No execution/checkout of target code. Fails before protected job on missing protection, moved main or changed guard. | Regression PASS; live main BLOCKED |
| `.github/uat/authenticated-readonly-target.json`, `e2e/uat-v3/config.js` | Both flags false; exact target binding, reviewed isolation and Production identity evidence required; Preview/Production fingerprints distinct. Evidence URL syntax is only a reference check, not proof its contents are trustworthy. Reviewed evidence and human approval remain mandatory. | Disabled PASS; actual isolation BLOCKED |
| `scripts/ci/verify-uat-v3-preview.js`, `vercel-identity.js`, `database-isolation.js` | Authenticated official Vercel deployment GET + authoritative Vercel-bot Preview provenance; exact SHA/ref/project/team/id/immutable URL/READY; canonical forbidden; protected GET readiness. Requires deployed literal Preview runtime and deployed non-sensitive approved fingerprint equal to reviewed target. Missing API fields stop, never infer false/Preview/isolation. | Synthetic regressions PASS; Hosted NOT EXECUTED |
| Existing `src/app.js`, `src/config/prisma.js`, runtime target guard and target identity utility | Read only; pinned hashes. In-process Preview guard normalizes actual DATABASE_URL/DIRECT_URL and compares approved hash; readiness then performs Prisma SELECT 1 using same logical target. No source modifications. Synthetic tests reject wrong but format-valid hash and changed logical project. | Source/synthetic PASS; actual runtime proof BLOCKED |
| `e2e/uat-v3/auth.js`, `request.js`, `role-matrix.js`, `authenticated-readonly.spec.js` | Four distinct accounts; isolated role contexts, identity/expected-deny, GET allowlist. POST allowed only exact login to disposable target; redirects/origin escape blocked; no business mutation. Browser writes blocked. Login itself can write sessions/audit, hence disposable DB mandatory. | Local four-role evidence only; Hosted NOT EXECUTED |
| `security.js`, `reporter.js`, `run-uat-v3-readonly.js`, Playwright config | Sanitized aggregate only after scanner and required 24 PASS/0 FAIL/0 SKIP; no raw response, screenshots/traces/login secrets uploaded. Any secret leak or skip fails closure. Dependencies execute only from reviewed main before scoped UAT credentials. | Static/local PASS; independent dependency review pending |
| New isolation tests; existing security/workflow tests; local role integration and browser fixtures; `ci.yml`, `package.json` | Unprotected synthetic/local tests, added isolation test to Full CI. No protected credentials, production writes, migrations or dependency additions. | Require new exact-head CI |
| Branch/Environment administration | GitHub branch main `ca9b3d12d67be10297ac98f5668e2cfeab74b4b4` reports protected=false; Integration protected=false. Ruleset 20230372 reports enforcement=disabled with empty ref include/exclude. Environment reviewer/branch restrictions cannot be established through available non-admin connector. | BLOCKED / UNVERIFIED |

Sources: [main branch](https://api.github.com/repos/godzillazzz/SMS-v3/branches/main), [ruleset 20230372](https://api.github.com/repos/godzillazzz/SMS-v3/rulesets/20230372). Branch protection Boolean alone does not prove required independent review or ban all bypass actors; human must inspect effective rules and Environment configuration. No settings changed.

### Database isolation evidence checklist

All items below are **NOT VERIFIED for Hosted**. A valid hash/flag/200 readiness cannot replace this checklist.

1. Authorized provider evidence identifies disposable resource/project and logical database, owner, limited test principal, synthetic data only, cleanup/expiry and no Production access; disclose no connection strings or secret values. No provisioning in this task.
2. Obtain current authoritative Production logical fingerprint through reviewed read-only protected code; cite exact sanitized run. Pin separately in reviewed target and prove it differs from Preview. A caller-supplied 64-hex value is insufficient.
3. Pin immutable Preview deployment ID, source/ref/project/team, actual Preview runtime environment and approved fingerprint from authoritative immutable deployment configuration. If deployment API does not expose literal non-sensitive fields, this implementation STOPS; provider capability is not proven. Do not substitute project-level settings, infer from URL or export/decrypt credentials.
4. Independently review four pinned application source files; exact-source GitHub hash check plus actual Preview GET readiness binds in-process target normalization/approved fingerprint to the database used by Prisma SELECT 1. Public readiness alone does not expose guard branch or fingerprint. No new runtime endpoint introduced.
5. Record exact sanitized evidence run tied to target/source/deployment; independently verify successful jobs and actual equality checks, not only run URL syntax. Review resource separation even when fingerprints differ. Existing Supabase logical normalization does not prove synthetic-only contents, credential privileges, provider ownership or unrelated external services.
6. Verify email/storage/license-document integrations cannot affect Production; ensure test fixtures and all four accounts belong only to isolated environment. Login session/audit writes require this isolation even in read-only business UAT.
7. Owner separately authorizes exact reviewed target and Hosted read-only UAT after independent human review. Only then may a separately reviewed control change enable flags; this PR leaves both false.

### Trusted main integration plan (no execution in this task)

1. Independent reviewer inspects PR #589 code, dependency install behavior, scanner, GET/login allowlist, trust guards and new exact Full CI/native Preview. Do not merge obsolete #87 as a whole. #589 remains Draft.
2. After separate governance review, merge to Integration only through normal PR process; this task does not authorize merge.
3. Create a separately reviewed selective Integration-to-main PR containing harness/workflow/tests and necessary docs only. Do not copy Application code, Production controls or official manifests from Integration wholesale. Assess expanded diff and automatic Preview/free-tier side effects.
4. Owner/repository administrator resolves disabled main protections under separate security-setting authorization; verify independent required reviews, required checks, no unauthorized direct writes/bypass and suitable Environment reviewers, self-review rules and main-only deployment branches. This task does not change these settings.
5. Prove Full CI validate job SUCCESS at exact merged trusted-main SHA AND exact target source SHA through supported reviewed CI triggers. Do not assume main ci.yml has manual dispatch, or substitute old PR-head CI for merged main. Verify guards and action pins remain intact.
6. Complete disposable DB and account checklist, independently review target-control evidence, then obtain separate Owner Hosted UAT permission and GitHub Environment human review. No secrets may be exposed to current PR code.

### Account / protected secret readiness matrix

| Role | Existing secret names (values never read) | Required readiness proof | Current status |
|---|---|---|---|
| ADMIN | UAT_ADMIN_EMAIL / UAT_ADMIN_PASSWORD | Distinct isolated subject; actual ADMIN; no View-As; GET/deny matrix | UNVERIFIED; local synthetic only |
| MANAGER | UAT_MANAGER_EMAIL / UAT_MANAGER_PASSWORD | Distinct isolated subject; actual MANAGER; no View-As; GET/deny matrix | UNVERIFIED; local synthetic only |
| SUPERVISOR | UAT_SUPERVISOR_EMAIL / UAT_SUPERVISOR_PASSWORD | Distinct isolated subject; actual SUPERVISOR; no View-As; GET/deny matrix | UNVERIFIED; local synthetic only |
| VIEWER | UAT_VIEWER_EMAIL / UAT_VIEWER_PASSWORD | Distinct isolated subject; actual VIEWER; all expected denials | UNVERIFIED; local synthetic only |

Owner/authorized administrator checks existence and Environment scope of eight names in GitHub UI without sharing values; independently attest accounts are isolated, enabled and usable. Existing VERCEL_TOKEN and VERCEL_AUTOMATION_BYPASS_SECRET also require appropriate restricted scope. No new credentials created, no secrets read. Physical iPhone/GPS/offline, Hosted mutation Q13B/Q13C and license document lifecycle remain NOT EXECUTED.

### Remaining human gates

- Independent code/security review of #589 and selective trusted-main integration.
- Separate administrator decision for currently disabled main protection; verify existing Environment reviewers/branch restrictions.
- Authoritative disposable/runtime/Production identity evidence and four isolated accounts/eight secret availability.
- Separate Owner exact-target Hosted UAT authorization + normal Protected Environment review AFTER prerequisites.

Final Hosted readiness: **BLOCKED**, not Business Acceptance PASS. MASTER_HANDOFF.md and all Production controls remain untouched.
