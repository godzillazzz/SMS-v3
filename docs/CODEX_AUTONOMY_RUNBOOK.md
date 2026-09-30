# Codex Autonomy Runbook — SMS V3

Use this runbook when a task must be carried from source change through verified Production. AGENTS.md is the binding contract; this document is the operational checklist.

## Start

1. If MASTER_HANDOFF.md exists in the trusted workspace, read its latest section. In a fresh clone without that local handoff, reconstruct current authority from repository state, GitHub/Vercel evidence, and the user's active instruction.
2. Record current root branch/status, canonical Production deployment, health/readiness, and the user's exact acceptance criteria.
3. If the root is dirty, do not repair it. Create an isolated worktree under .worktrees/ from the verified source SHA.
4. Write a short execution plan for multi-hour or cross-system work and keep it updated as evidence changes.

## Implementation gate

- Change only the requested scope.
- Add a regression test for the observed failure when practical.
- Run focused tests first.
- Run the applicable complete frontend/backend suite, typecheck/build, and git diff --check.
- For UI changes, inspect the actual rendered result with browser automation at representative breakpoints. Check text visibility/clipping, overflow, loaded assets/fonts, JavaScript page errors, and the user's exact visual requirement.

## Source gate

Before pushing:

- worktree is isolated and clean except intended files;
- HEAD/base are known;
- changed-file list is expected;
- no secret files are staged;
- commit is created on a dedicated branch.

Before moving the allowlisted release branch:

- read its exact remote SHA;
- prove the hotfix is a fast-forward descendant;
- never force-push.

## CI and Preview gate

- Dispatch CI for the exact allowlisted release SHA.
- Wait for completed/success and confirm headSha.
- Select the Vercel Preview with native Git metadata matching that SHA and release ref.
- Verify project id and READY state.
- Verify Preview /api/v1/health and /api/v1/ready; database must be healthy/ready.
- Reject CLI-only or missing-SHA candidates as release sources.

## Production candidate gate

- Inspect current canonical and record the exact previous deployment as rollback target.
- Confirm Vercel project autoAssignCustomDomains=false before candidate creation.
- Build or redeploy the exact verified Git Preview as target=production without changing canonical.
- Re-check candidate id, SHA/ref/project/READY/health/readiness.
- Re-check canonical is still the expected previous deployment.

## Protected promotion gate

Dispatch the repository's protected Production workflow using:

- exact candidate deployment id;
- exact expected SHA;
- exact expected previous canonical deployment id;
- repository-required confirmation string.

Environment approval remains mandatory. When the user's current task explicitly authorizes Production completion, submit the normal official review only through the already-authenticated named reviewer identity. Never edit or bypass protections to make a deployment pass.

## Post-production gate

After a successful workflow:

- canonical deployment id equals the candidate;
- native SHA/ref equal the exact release source;
- health and readiness/database pass;
- CORS preflight matches the canonical origin when applicable;
- live browser audit passes the requested behavior at desktop and mobile;
- browser reports no unexpected page errors or horizontal overflow;
- rollback deployment remains identifiable and READY.

If the workflow and runtime evidence disagree, document both. Do not rewrite a failed workflow as success.

## Handoff

Update MASTER_HANDOFF.md with:

- exact source SHA/tree/branch;
- CI run id/result;
- Preview and Production candidate ids;
- approval evidence;
- canonical Production id;
- health/readiness/CORS/browser results;
- rollback target;
- checks that were not possible, such as authenticated real-data UAT;
- final CLOSED or OPEN status and next gate.

A task is not closed because code was committed. It is closed only when every applicable acceptance and release gate has evidence.
