# OVERNIGHT EXECUTION REPORT

## 1. Execution Timestamp (Asia/Bangkok)

2026-10-10 00:30:13 Asia/Bangkok. Owner delegated engineering, normal-governance merges and conditional Hosted read-only UAT in this session. Authorization is recorded here; no routine reconfirmation is required. Independent review and Environment approvals remain mandatory. This report is explicitly requested by the Owner and does not edit the restricted MASTER_HANDOFF.md or erase historical evidence.

Overall status: **PARTIAL / HOSTED_UAT_BLOCKED**. Report source checkpoint precedes publication; the exact containing commit, final CI and immutable Preview are recorded in the latest [PR #589 checkpoint](https://github.com/godzillazzz/SMS-v3/pull/589) to avoid a self-referencing commit.

## 2. Starting Baseline

Live GitHub and Vercel inspection confirmed:

- Integration: `9abc97998f98265605f534de7874607a5f3b5a13`.
- PR #589: Draft/open/unmerged/mergeable; HEAD `e27168fee7b16cba8605266bb84f8acacbff30e8`, tree `5381c7a15bea034bbfa380fac6778b6183c8b650`.
- [Exact-head CI #37962504734](https://github.com/godzillazzz/SMS-v3/actions/runs/37962504734): completed/success, validate and Vercel Preview Comments success at that SHA. This is historical after this patch.
- main: `ca9b3d12d67be10297ac98f5668e2cfeab74b4b4`, protected=false.
- Preview: `dpl_BiwDoQpk7rb4eL7p3CkC92wVKb5i`, READY; exact PR SHA/ref/project. No new Preview manually created.
- Production: `dpl_Hjo1fTmgjEdmg5G7fZBX9gssenQP`, READY/production, Application `77641a2657aa4fd05276afe645dd32648f5cc56b`.

The starting workspace had empty read-only metadata directories, no usable Git checkout and no user source files. Default clone failed DNS; approved network escalation cloned into `repository`. A clean dedicated `.worktrees/overnight` branch starts at the exact PR head. No cleanup/reset/stash/force-push, reconstruction of Owner WIP, or deletion of other work occurred.

## 3. Final Repository HEAD

Integration and main are preserved at the SHAs above. The patch is an ordinary fast-forward update of PR #589's source branch, subject to an expected-head lease. Final PR HEAD is the containing commit linked in PR metadata, and must have its own CI. No merge is authorized until independent review and effective governance pass.

## 4. PR Status

#589 remains Draft/open; no independent approval exists at baseline. Existing open PRs: #589, #556, #546, #530, #408, #402, #130, #113, #112, #87, #43, #35. They were inspected as queues and were not merged or closed. #87 is not merged wholesale. The full #589 changed-file security disposition is appended to [recovery documentation](uat-v3-recovery.md#overnight-security-review-packet).

## 5. CI Status

New exact-head Full CI is required after publication; the old successful run cannot certify this patch. Latest immutable run/result belongs in PR metadata.

Actual local validation before publication:

- Node 22.23.3; locked dependency install (without lifecycle scripts), Prisma generation from unchanged schema; npm audit reports zero vulnerabilities.
- Focused security 11 PASS, workflow 5 PASS, runtime-isolation/trust 4 PASS: **20 PASS / 0 FAIL / 0 SKIP** via direct test-file execution.
- Real Chromium synthetic isolation **5 PASS / 0 FAIL / 0 SKIP**: four roles plus the new cookie-origin regression.
- Before the fix, the new Chromium cookie regression **FAILED**: one credential-bearing request reached the second origin. This failure is retained as defect evidence.
- Hosted suite collection: **24 tests only; NOT EXECUTED**.
- Complete local backend attempt: **1386 PASS / 6 FAIL / 0 SKIP** (1392 reported tests). Three DB-dependent leaf tests plus parent suites fail because synthetic connection identities do not authorize access to the existing local database. A read-only connection attempt gave the same result; no further retries, database/user modifications or assertion changes. New remote CI's provisioned disposable DB is the authoritative full-suite validation.
- A combined node --test invocation reported only three file-level results; it is not counted as 20 tests. Direct invocations above establish the 20 actual tests.

Local logs are task-specific `/tmp/sms-overnight-*` and are not uploaded as Hosted artifacts. Application/frontend/schema and dependency versions are unchanged.

## 6. Preview Identity

Baseline immutable URL: https://sms-v3-staging-7l17dk1ml-godzillazz.vercel.app . Project `prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s`; team `team_nemCExHbZ8EAhSgsvefHPAEz`; native ref `test/uat-v3-four-role-recovery-20261009`; SHA exact baseline. Authenticated team-scoped lookup succeeded. Vercel target is null; Preview is established independently through the existing Vercel-bot GitHub deployment contract, not inferred from null or hostname. Native identity does not expose literal deployed VERCEL_ENV or fingerprint. A new native Preview/CI for the changed HEAD must be verified once, without deploy/retry spam.

## 7. Governance Status

**GOVERNANCE_BLOCKED**, before=after; no settings changed.

- [main branch](https://api.github.com/repos/godzillazzz/SMS-v3/branches/main): protected=false, status enforcement off/empty.
- [ruleset 20230372](https://github.com/godzillazzz/SMS-v3/rules/20230372): disabled, empty ref include/exclude, no bypass actors. Contains deletion/non-fast-forward rules and one required PR approval; stale dismissal=false, code-owner=false, last-push approval=false, thread resolution=false. No required status-check rule. Disabled configuration is not effective protection.
- Branch-protection detail returned **403 Resource not accessible by integration**. Repository permissions advertise admin, but the installed connector lacks administration capability; gh CLI has no authenticated identity. No settings-mutation tool is available.
- Environment metadata, eight-secret existence, collaborator/assignee inventory and repository workflow-permission endpoints were rejected by the fetch connector's endpoint allowlist. These are UNVERIFIED, not absent.
- Required improvement: activate a scoped main rule, preserve at least one independent review, dismiss stale approvals, require exact Full CI validate, disallow force push/deletion and review bypass actors. Verify effective application to main. Protect the existing UAT Environment with authorized reviewers and main-only deployment restriction; never lower any existing protection.
- CI/UAT YAML permissions were inspected. The new UAT workflow is read-only. The inherited full CI uses a repository bypass secret only in its Preview probe; repository/Environment-level permission and untrusted-PR policy require administrator verification before trusted-main use.

## 8. Independent Review Status

**REVIEW_BLOCKED**. GitHub review submissions=[], requested users/teams=[]. No CODEOWNERS in the exact tree. Collaborator inventory is unavailable. Historical contributor display names do not establish GitHub usernames or review authority; a historical external-author commit has no linked GitHub author. The authenticated account is godzillazzz, also PR author, so it cannot serve as independent reviewer.

A security review packet and explicit request for an authorized non-author review will be posted in PR conversation. A native requested-reviewers mutation cannot truthfully target a reviewer until an eligible username/team is established. Automated source review and regressions here are not independent approval. Keep Draft and do not self-approve.

## 9. Database Isolation Status

**ISOLATION_BLOCKED**; both target flags stay false.

Read-only provider/control-plane evidence improves the package:

| Observation | Evidence / limitation |
|---|---|
| Supabase Preview | Project `ezxanpfagitckpfsnflp`, sms-v3-preview, ACTIVE_HEALTHY, ap-northeast-1, Postgres17; organization skrvuqrwwnbkprdziekn. Existing resource; no creation. [Provider project](https://supabase.com/dashboard/project/ezxanpfagitckpfsnflp). |
| Other provider project | `jkexwnlxnxbemwavsebv`, named sms-v3-development, ACTIVE_HEALTHY; its name does not establish non-Production use. |
| Provider branches | Both active projects returned zero development branches. This does not prove no standalone disposable resource, nor prove disposable classification. |
| Preview config metadata | One project-level Preview DATABASE_URL/DIRECT_URL/JWT_SECRET row each, sensitive. Separate Production rows. No override for the recovery ref. Values were not decrypted. |
| Non-secret Preview guard | Project-level APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT=`fe001305fa0031e9572949cac8544dfc9c8d8aca9e4fc2749f565952e65c282c`. Matches the repository normalization of provider project ezxanpfagitckpfsnflp / database postgres. This is a derived comparison to project config, not an observed deployed runtime identity. |
| Historical Production guard | [Protected R5-B job 113852015345](https://github.com/godzillazzz/SMS-v3/actions/runs/37940068503/job/113852015345), exact control SHA `0eb2b1cfc5b2bb47ff9a8cfcc67bced6b6290881`: approved hash `87dd67b4630d3e1fbdd639b318681a044a81d7755dfdc8d98c08f6943d5ac1db`; actual TARGET_FINGERPRINT_MATCH=true at 2026-10-09T13:55:21Z. Matches jkexwnlxnxbemwavsebv / postgres; guarded source compares the actual protected target in memory. This is release-time evidence, not a current runtime re-attestation. |
| Comparison | The two observed/configured hashes differ. Preview Runtime == Authorized Disposable DB remains UNVERIFIED; current Production Runtime identity also remains UNVERIFIED. |
| External integrations | Separate Preview/Production Supabase secret rows and a LICENSE_DOCUMENTS_BUCKET row shared across both environments. Secret equality, storage project/bucket isolation, email isolation, synthetic contents, limited test principal and cleanup/expiry remain UNVERIFIED. |

Do not decrypt DATABASE_URL, DIRECT_URL, JWT_SECRET, Supabase service keys or account credentials to fill gaps. No provider SQL/business-data inspection or hosted login occurred. Project naming and ready/SELECT1 are insufficient classification. Need a reviewed sanitized runtime/provider attestation tied to immutable deployment/source plus disposable ownership/contents/privilege/cleanup evidence. Production fingerprint historical evidence may support review, but cannot substitute for current proof.

## 10. Account/Secrets Readiness

**ACCOUNT_BLOCKED**. ADMIN, MANAGER, SUPERVISOR, VIEWER: all UNVERIFIED. All eight UAT_ROLE_EMAIL/PASSWORD names: existence/scope UNVERIFIED due unsupported secret-metadata endpoint. VERCEL_TOKEN and automation bypass scope also require independent verification. No credentials used.

VIEWER leave expectations in this harness require an unlinked synthetic VIEWER. Login payload omits employeeId, so absence of that field cannot prove an unlinked account. Provider-side read-only account metadata must attest linkage after target identification; do not discover it by changing assertions to the returned HTTP status. A /leave-summary probe can provision quota rows and is not a safe substitute. Existing recovery documentation already excludes linked-VIEWER coverage; retain that limitation.

## 11. Trusted Main Status

**MAIN_INTEGRATION_BLOCKED**. Integration-to-main comparison is **1036 files / 143205 insertions / 3151 deletions**, including app/schema/platform changes. No wholesale PR or merge. Prepare only reviewed harness/workflow/tests/docs plus their audited dependencies after review; current main lacks the modern helper/runtime sources. A selective dependency inventory and full new CI are mandatory. Owner delegation permits this future work but does not waive reviews.

## 12. Hosted UAT Results

**HOSTED_UAT_BLOCKED / NOT EXECUTED**. ADMIN6 + MANAGER6 + SUPERVISOR6 + VIEWER6 planned; actual Hosted PASS count=0 because nothing ran. No Hosted run ID or leak count is asserted. 24/24 PASS and SECRET_LEAK_COUNT=0 remain acceptance criteria, not results. Owner authorization is now recorded and is conditional on all hard gates; do not ask for routine reauthorization. Environment human review remains separate.

## 13. G06 Status

Physical/device/offline/GPS acceptance is pending. Existing local/CI contracts are technical evidence only. [Physical checklist below](#physical-and-business-acceptance-checklist) avoids Face/QR changes, Production assignments and fabricated physical results. Historical online iPhone evidence remains historical.

## 14. License Status

Existing local API 77/77 and Browser fixtures2/2 are historical scope-limited acceptance. Hosted upload/review/approve/reject/renewal and private storage isolation remain unverified. No document upload or mutation attempted. Current unit/regression CI must stay distinct from full Hosted lifecycle.

## 15. Q13B/Q13C Status

Hosted mutation **NOT EXECUTED**. Disposable fixture provisioning/role isolation/cleanup need provider and storage proof plus reviewed mutation scope. The recovered read-only harness does not port #87's provisioning or business-mutation scripts. Local fixtures cannot close this gate.

## 16. T08 Status

**WAITING_FOR_LOCAL_CHECKPOINT**. The Owner's Windows worktree is not attached. The new clone cannot establish that WIP is preserved or clean. No reconstruction, copy, destructive cleanup, or false T08 verification. First action is read-only inspection/checkpoint of the actual Owner checkout when accessible.

## 17. Production Preservation Evidence

Authenticated individual alias lookups (the first paginated alias-list response did not include old canonical entries) confirmed both canonical aliases map to R5-B `dpl_Hjo1fTmgjEdmg5G7fZBX9gssenQP`, exact App SHA above. No Production deploy/promote/rollback/alias/database/schema/data/settings/credential mutation was performed. This patch changes only test harness/regressions/docs; source/runtime guard pins remain unchanged. No claim is made that legitimate concurrent Production business data has stopped changing; database/schema global before/after snapshots were not available. Release-time read-only/schema evidence is historical. Final alias/deployment read will be recorded in PR checkpoint.

## 18. Changes Made

- Reproduced and repaired cross-origin cookie leakage in the UAT browser interceptor: headers() omits Cookie; allHeaders() includes it. Block Cookie, Authorization, Proxy-Authorization and x-vercel headers on any other origin before fetch; preserve same-origin cookies.
- Added real two-origin Chromium regression with synthetic host cookie and zero requests at foreign server after fix. Extended existing security assertions; no weakened assertions.
- Updated recovery/backlog/report with reviewed file scope, provider/config proof, explicit limitations, Owner authorization and remaining gates. No application/RBAC/schema/dependencies/MASTER_HANDOFF edits.
- Decisions delegated: recover checkout by approved network path; fix test-only security defect; preserve disabled target, Draft and all gates; publish one coherent patch and fresh exact-head CI; reuse existing provider resources; do not spend or create redundant deployments.

## 19. Actions Requiring External Human Review

1. Establish a real eligible non-author reviewer and submit independent review on latest #589 HEAD.
2. Administrator with actual settings API/UI capability strengthens and verifies effective main/Environment governance and inspects workflow/secret metadata.
3. Provider/operator attests disposable target, current runtime binding, distinct current Production identity, storage/email separation, synthetic account linkage/privileges and cleanup.
4. Complete selective trusted-main PR, independent approval and exact merged-main CI; Environment reviewer approves the exact read-only run only after every hard gate.
5. Owner physical iPhone/PWA action after safe isolated target is proven.

## 20. Remaining Risks

No independent approval; ineffective main rules; Environment/secret metadata unknown; immutable runtime fingerprint missing; disposable/storage classification unknown; VIEWER linkage unproven; stale main dependencies; local DB-dependent full-suite failures retained. No risk is hidden behind historical green CI or project labels.

## 21. Next Recommended Action

Open the latest PR #589 checkpoint and assign an authorized non-author security reviewer. In parallel use repository administrator/provider access to close governance and runtime/disposable evidence gaps. After exact new CI and every gate passes, follow the selective main plan and protected UAT. No Production release is authorized.

## Physical and Business Acceptance Checklist

| Stream | Controlled scenario | Required evidence / current result |
|---|---|---|
| G06 | iPhone Safari + installed Home Screen PWA; correct device binding | Actual isolated account/device + deployment SHA, OS/version, redacted result; NOT EXECUTED |
| G06 | Secure offline queue; restart while offline; reconnect; duplicate replay | No readable sensitive local payload; one allowed sync/audit; no duplicate AttendanceEvent; NOT EXECUTED |
| G06 | Inside/outside geofence, permission denied/unavailable location | Existing policy unchanged; record result without exact GPS; NOT EXECUTED |
| G06 | Secondary/replaced device, ADMIN decision and audit | Disposable device assignments only; deny before approved replacement; NOT EXECUTED |
| License | Synthetic PDF/image upload, review, approve, reject, renewal | Isolated private storage and disposable data; role 401/403, safe expiry/reconciliation and audit; NOT EXECUTED Hosted |
| Q13B/Q13C | Fixture allowlist, distinct role subjects, bounded business writes | Snapshot synthetic fixture IDs/counts before/after; no Production target; independent proof of cleanup and storage removal; NOT EXECUTED Hosted |

Record PASS/FAIL/SKIP separately for Local Unit, Local Integration, Browser Fixture, Hosted Preview, Production and Physical Device. No Browser fixture can certify physical GPS/offline/device behavior. No Production shift/device/account changes to manufacture acceptance.
