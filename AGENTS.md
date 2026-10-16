# SMS V3 Codex Contract

This repository is a production system. Optimize for finishing the requested outcome, not merely producing a patch.

## Source of truth

- If MASTER_HANDOFF.md exists in the current trusted workspace, read it before substantial work. The newest HOTFIX, CLOSED, or ACTIVE section is authoritative; older sections are history. In a fresh clone where that local handoff is absent, use repository state, GitHub/Vercel evidence, and the current user instruction as authority rather than inventing missing history.
- Re-read the relevant source and current runtime state instead of trusting an old summary.
- Never claim a test, approval, deployment, browser check, authenticated view, or database action unless it actually happened and you have evidence.
- Preserve user requirements from the current task over older implementation choices.

## Protect existing work

- The root worktree is often dirty with unrelated work. Never run destructive cleanup such as git reset --hard, git clean, blanket git restore, or delete/stash another task's changes.
- For substantial implementation or release work, use a dedicated branch/worktree under .worktrees/ based on the verified source/canonical SHA.
- Before push or promotion, assert the exact expected HEAD, clean isolated worktree, changed-file scope, and remote branch ancestry. Never force-push release branches.
- Do not expose credentials, tokens, connection strings, recovery codes, or secrets in output/logs.

## Definition of Done

When the user says "ทำให้จบ", "finish", "deploy", "production", or equivalent, do not stop at code changes or green local tests. Continue through every applicable gate below unless a real permission, credential, or safety blocker prevents it.

1. Reproduce or inspect the problem and identify the active requirement.
2. Implement the smallest coherent fix without silently changing unrelated behavior.
3. Run focused regression tests, then the applicable full test suite, typecheck/build, and git diff --check.
4. For UI, branding, or responsive work, use a real browser against the built or served code. Check representative desktop/mobile widths, actual computed styles/overflow, page errors, assets, and the exact requirement. A DOM/CSS fixture is acceptable only when authenticated data is unavailable; label it honestly.
5. Commit on the dedicated branch. Push without force.
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
