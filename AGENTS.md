# SMS V3 Codex Contract

This repository is a production system. Optimize for finishing the requested outcome, not merely producing a patch.

## Codex bootstrap (every session)

1. Fresh-read `AGENTS.md` before consequential actions; fresh-read `MASTER_HANDOFF.md` before each project action.
2. Read and use `.agents/skills/sms-v3-autonomous-operator/SKILL.md` as the permanent operating method.
3. Refresh live repository and runtime state before consequential actions.
4. Continue through every authorized safe step until a genuine Owner-only gate or fail-closed blocker.
5. Never ask “what should I do next?” when repository, source, GitHub, CI, or Vercel evidence can answer it.
6. Before stopping, ask: “Is there another safe authorized action I can perform myself?” If yes, continue.
7. For SMS-v3 UX/UI or acceptance tasks, also read `docs/ux-remediation/README.md`, `docs/ux-remediation/PLAN.md`, and task-specific reference assets in the same folder. These describe requirements, not authoritative current release status. Never use stale R3 or old task status from the plan in place of the latest handoff and live evidence.

## Source of truth

- Read MASTER_HANDOFF.md before substantial work. The newest HOTFIX, CLOSED, or ACTIVE section is authoritative; older sections are history.
- Re-read the relevant source and current runtime state instead of trusting an old summary.
- Never claim a test, approval, deployment, browser check, authenticated view, or database action unless it actually happened and you have evidence.
- Preserve user requirements from the current task over older implementation choices.

## Owner-pinned Integration Branch and Preview resources (2026-10-12; overrides older branching defaults)

- **Default and reusable working/Integration branch:** `fix/serverless-database-reliability`. For future SMS-v3 development, diagnosis, integration, tests, evidence and routine maintenance, start from and continue on this existing branch. **Do not create a new task branch or worktree by habit**; prefer approved isolated ephemeral testing without mutating the dirty Windows root. Read the branch's live Git SHA before writing.
- Exception: retain `main` as protected governance/workflow source; create a separate PR branch only if a protected PR/workflow rule makes one technically mandatory or the Owner explicitly authorizes it. Do not silently promote, merge, cherry-pick, rebase, delete or rewrite prior frozen release/candidate refs to force them onto the default branch. Explain any unavoidable exception first.
- **Existing Preview DB/Storage resource:** Supabase project `sms-v3-preview`, project ID `ezxanpfagitckpfsnflp`, organization `skrvuqrwwnbkprdziekn`, API host `https://ezxanpfagitckpfsnflp.supabase.co`, private bucket `license-documents-g05-preview`. Reuse this resource before considering a new project, branch database, or paid subscription; do not provision or incur fees without new explicit Owner approval.
- **Vercel Preview integration:** project `sms-v3-staging` (`prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s`, team `team_nemCExHbZ8EAhSgsvefHPAEz`) is shared with Production. The working branch `fix/serverless-database-reliability` uses existing shared Preview variables (no matching branch-specific credentials observed). Secrets (`DATABASE_URL`, `DIRECT_URL`, `SUPABASE_SERVICE_ROLE_KEY`) belong only in approved secure Vercel/Supabase configuration, never Git, chat, screenshots, or logs. Do not ask the Owner to reenter secrets just because a different task branch was used.
- **Provenance gate:** existence of a named Preview project, Vercel Preview variables, or successful /ready does **not** prove a deployment uses that Preview database/Storage. The previously recorded approved Preview DB fingerprint did **not** match project `ezxanpfagitckpfsnflp`; check actual runtime/project identity and separation from Production before authenticated UAT, migrations, Storage writes/deletes, or business-data mutations. Inherited Sensitive values are unreadable from the normal API; never assume identity or reuse unsafe credentials.
- **Existing R6-B overrides:** 4 Preview-only variables (`SUPABASE_URL`, `LICENSE_DOCUMENTS_BUCKET`, `DISABLE_EMAIL_NOTIFICATIONS`, `OTP_DELIVERY_PROVIDER`) were configured on older branch `codex/r6b-selective-from-r5b-20261011`. They are **not** proof of DB/Storage credential isolation. Candidate PR #611 remains Draft/frozen at `cda7ace863b39eb9419603441f4b5a37048eb288`, awaiting a separate approved integration/review plan. Production remains frozen R5-B at `77641a2657aa4fd05276afe645dd32648f5cc56b` until separate release approval.
- **Branch pruning:** Owner wants irrelevant remote branches removed, but first inventory **all** branches, open PR heads/bases, unmerged work, release manifests, frozen SHA/deployment provenance, rollback and local T08 worktree. Retain `main`, the pinned Integration branch, and every still-required release/PR/dependency ref. Delete only positively classified obsolete branches after a reviewed manifest; never bulk-delete based on age/name or clean/stash/reset the Owner's local dirty worktree.
- Record exact updates in `MASTER_HANDOFF.md` on the pinned Integration branch. Refresh live GitHub/Vercel/Supabase state rather than using old branch SHAs as facts.

## Protect existing work

- The root worktree is often dirty with unrelated work. Never run destructive cleanup such as git reset --hard, git clean, blanket git restore, or delete/stash another task's changes.
- Apply the Owner-pinned working branch rule above. Use an isolated worktree or separate branch only when required by explicit authorization or protected governance; never touch an inaccessible or dirty T08 worktree.
- Before push or promotion, assert the exact expected HEAD, clean isolated worktree, changed-file scope, and remote branch ancestry. Never force-push release branches.
- Do not expose credentials, tokens, connection strings, recovery codes, or secrets in output/logs.

## Definition of Done

When the user says "ทำให้จบ", "finish", "deploy", "production", or equivalent, do not stop at code changes or green local tests. Continue through every applicable gate below unless a real permission, credential, or safety blocker prevents it.

1. Reproduce or inspect the problem and identify the active requirement.
2. Implement the smallest coherent fix without silently changing unrelated behavior.
3. Run focused regression tests, then the applicable full test suite, typecheck/build, and git diff --check.
4. For UI, branding, or responsive work, use a real browser against the built or served code. Check representative desktop/mobile widths, actual computed styles/overflow, page errors, assets, and the exact requirement. A DOM/CSS fixture is acceptable only when authenticated data is unavailable; label it honestly.
5. Commit only on the Owner-approved working/Integration branch, unless a protected PR/release control explicitly requires an approved separate branch. Push without force.
6. For a release, fast-forward the allowlisted release branch only after verifying its current remote SHA is the expected ancestor.
7. Dispatch CI for the exact release SHA and wait for SUCCESS. A failed or mismatched CI is a blocker.
8. Find the GitHub/Vercel Preview whose native githubCommitSha, githubCommitRef, project id, and READY state match the exact release source. Verify /api/v1/health and /api/v1/ready, including database state.
9. Before staging Production, verify the current canonical deployment and rollback target. Confirm the project does not auto-assign the canonical domain during candidate build.
10. Create an immutable production-target candidate from the verified Git-sourced Preview. Re-verify candidate SHA/ref/project/READY/health/readiness and confirm canonical is still unchanged.
11. Dispatch the protected Production workflow with the exact candidate, expected SHA, expected previous canonical, and required confirmation.
12. GitHub Environment protection is mandatory. If the current user task explicitly authorizes Production, deployment, or approval, an already-authenticated named Owner account may submit the normal official Environment review. Never weaken protection, alter required reviewers, bypass a gate, or use a missing-provenance deployment. Without explicit authorization, stop at the approval gate and ask.
13. After workflow success, independently verify canonical deployment id, native source SHA/ref, health, readiness/database, CORS, and the requested browser behavior on live Production. Keep the verified previous canonical as rollback evidence.
14. If post-promotion checks fail, preserve evidence and use the governed rollback path when authorized. Do not hide a failed workflow behind a separate successful manual check.
15. Update MASTER_HANDOFF.md with exact SHA/deployment/run ids, what passed, what did not run, rollback reference, and truthful OPEN/CLOSED status.

## Production and data safety

- Do not mutate Production employee, schedule, attendance, or other business data merely to test a UI.
- Database schema, migration, data writes, destructive actions, secret/env changes, auth policy changes, G06 biometric authority, and G07 scope changes require explicit task scope or authorization.
- Do not invent credentials or claim an authenticated UAT when no authorized session exists.
- Prefer read-only health, status, and provenance checks after deployment.
- If a workflow fails after promotion, distinguish "application is live/healthy" from "formal release gate is green"; both facts matter.

## Autonomous execution

- Work continuously through routine edits, tests, builds, browser checks, Git operations, GitHub CI, Vercel Preview checks, and read-only Production verification.
- Use Auto-review for eligible permission requests. Do not ask the user to manually approve routine low-risk development actions.
- Ask only when a required action lacks authorization, would materially mutate protected Production data/configuration, requires unavailable credentials, or needs a human business decision.
- When blocked, report the exact blocker and leave the repository/runtime in a safe, documented state.

## Final response

State what is actually live, the exact commit/release evidence when relevant, tests/checks performed, and any remaining limitation. Do not say "done" if an applicable gate above is still pending.
