# Cloud-first SMS-v3 operations — Issue #561

GitHub APIs, GitHub-hosted Actions and Vercel Git integration are the operational path. An Owner computer, Codex Desktop, a local checkout or Khai Hub is optional and is never a release gate. This runbook authorizes no Production operation.

## Existing mechanisms and verified gaps

| Operation | Existing mechanism | Boundary |
| --- | --- | --- |
| Development CI | `ci.yml`, PRs to Integration/main and Integration pushes | Exact source CI; unexecuted/skipped tests do not count PASS. |
| Preview creation | Native Vercel Git integration | Immutable Git-sourced Preview, exact SHA/ref/project/READY. Do not create a second deployment while the exact one exists. |
| PR Preview gate | `verify-integration-pr-preview.js` in full CI | Health, database readiness, trusted/untrusted CORS; no business writes. |
| Production initiation | `owner-production-dispatch.yml` on main; permanent mailbox [#548](https://github.com/godzillazzz/SMS-v3/issues/548) | Existing exact Batch/Control/Application guards and protected Production workflow. No duplicate Production bridge is introduced. |
| Historical Preview smoke | [#560](https://github.com/godzillazzz/SMS-v3/pull/560) and frozen one-shot R5-B workflows on main | Historical pins/consumed markers are not a reusable path for current Integration. |
| Reusable current Preview operation | `cloud-preview-operations.yml` + `cloud-preview-operations.cjs` | Owner-only read-only request, current source resolved by API, actual human `Hosted UAT` review, no UAT harness/deploy/DB client. |

Historical bridge [#37867822335](https://github.com/godzillazzz/SMS-v3/actions/runs/37867822335) succeeded, but its downstream Smoke [#37867834927](https://github.com/godzillazzz/SMS-v3/actions/runs/37867834927) ultimately FAILED. The original #561 issue body recorded WAITING at the time; retain it as historical evidence, not current PASS. Later R5-B release [#37940068503](https://github.com/godzillazzz/SMS-v3/actions/runs/37940068503) is an existing SUCCESS, not an operation requested by this task.

## Reusable read-only Preview request

Install the reviewed three-file operator (workflow, dependency-free script, regression test) selectively on protected main after its Integration CI/Preview gates. Do not merge the Application Integration branch into main. Do not merge deferred #589/#590 or change their UAT harness. `issue_comment` workflows run from the default branch; their workflow/code SHA is the exact event main SHA, never an arbitrary PR/harness checkout. [GitHub event contract](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#issue_comment).

An authenticated repository Owner, or a connected GitHub account acting within explicit delegated authorization, posts this exact single-line comment on the existing open release-control [Issue #551](https://github.com/godzillazzz/SMS-v3/issues/551):

```
/sms-v3-preview-check
```

The operator resolves the current Integration SHA and the immutable Preview itself. The Owner does not enter technical SHAs, deployment IDs, URLs or workflow inputs.

1. A GitHub-hosted runner checks Owner numeric ID/login/type/association/sender, exact comment, fixed repository/mailbox, main-only event and first run attempt.
2. Read-only GitHub API metadata must prove protected main, `Hosted UAT` required Owner reviewer, `can_admins_bypass=false` and exactly one deployment branch policy (`main`, branch type; no tags/globs). API failure/unknown configuration fails closed before a claim or protected job. [Environment API](https://docs.github.com/en/rest/deployments/environments#get-an-environment), [branch-policy API](https://docs.github.com/en/rest/deployments/branch-policies#list-deployment-branch-policies).
3. The newest CI run at each exact SHA must be a completed successful `CI` / `.github/workflows/ci.yml` push on main and Integration respectively. A failed/in-progress newer run cannot be hidden by an older green run. Preview deployment/status must be created by native `vercel[bot]`, match current Integration and explicitly be non-Production.
4. Workflow-level concurrency and a bot claim marker per Owner comment make replay/rerun fail closed. The claim is written before requesting the protected job. For an intentional retry after failure/cancellation, post a new Owner command; all source, CI and human-review gates run again. A request never silently retargets after approval.
5. **A human performs the normal GitHub Environment review for this run.** Command authorization, Owner sign-off, CI and Solo-Owner PR policy are not an Environment approval or an independent review. Do not approve admin bypass, weaken protection, or obtain credentials from Production.
6. After actual approval, only `Hosted UAT`'s `VERCEL_TOKEN` and `VERCEL_AUTOMATION_BYPASS_SECRET` are scoped to the verification step. No DB URL/service-role/cron credential is loaded. No dependency install or application code runs in the protected job. Native Vercel identity by immutable URL and deployment ID must match SHA/ref/project/repository/READY/Preview; canonical aliases must refer to another deployment.
7. Health, database readiness and strict credentialed CORS use only GET/OPTIONS on verified immutable Preview. Redirects are never followed; Vercel/GitHub credentials and Preview bypass headers are confined to their respective origins. Canonical aliases, native Preview identity and source heads are checked again afterward. Unexpected alias change causes STOP, never rollback/promotion.
8. The run summary emits only validated, leak-scanned identity and PASS fields. Raw API/HTTP bodies, headers, environment values and browser state are never artifacts. A separate job without protected credentials posts the actual success/failure/cancelled/skipped result and traceable run link to #551.

If approval/credentials/configuration/CI/source/runtime is blocked, retain the claim/run link and report the exact gate. WAITING, UNKNOWN, SKIPPED and fixture results are not a live cloud verification PASS. Health readiness does not prove disposable DB isolation; this operator performs no hosted business login, mutation, physical acceptance or Final UAT. Final Hosted UAT remains deferred until feature freeze and all separately required security/isolation/account gates.

## Production operations remain separately authorized

The existing #548 command queue and official protected `deploy-approved-production-v2.yml` remain the only reviewed Production initiation path for manifest-based releases. A connected operator derives Batch/Control/Application values from accepted release evidence, validates them and posts the existing exact command only when that specific Production action is explicitly authorized. The Owner's human Environment review remains mandatory. Technical input copying, Khai Hub or local runner access is not a prerequisite.

For #561 development verification, never post a Production command, stage/promote a Production candidate, mutate aliases/settings/secrets/schema/data, or invoke Cron reconciliation. Preserve the frozen R5-B application `77641a2657aa4fd05276afe645dd32648f5cc56b` and deployment `dpl_Hjo1fTmgjEdmg5G7fZBX9gssenQP`. Preview auto-builds are subject to the Owner-verified Production branch `vercel-production-manual` and disabled custom-domain autoassignment; verify native target and both canonical aliases after each merge.

## Closure evidence required

- Exact operator PR head + full CI + matching READY Preview; exact Integration post-merge CI/Preview.
- Selective main operator PR, required `validate` CI and main push CI; no application/Production workflow diff.
- A real cloud-only Owner request/run selecting the current Integration Preview; actual protected Environment approval and live GET/OPTIONS result. Unit/API fixtures are development evidence only.
- Traceable results and production-preservation evidence on #561 and Project Backlog. Keep #561 OPEN when any required live gate remains unverified.
