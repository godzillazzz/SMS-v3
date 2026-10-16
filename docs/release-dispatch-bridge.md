# SMS-v3 — Owner Production Dispatch (reusable)

**Scope:** Dispatch existing protected workflow only. This document does not authorize a deployment or replace Owner approval or Environment review.

## Command queue

- Dedicated GitHub issue: https://github.com/godzillazzz/SMS-v3/issues/548
- Trusted requester: authenticated repository Owner `godzillazzz`
- Trigger: a **new** issue comment with the exact command:
  `/sms-v3-dispatch R5-B <40-character-control-sha> <40-character-application-sha>`
- Batch id pattern: `R5-B`, `R6-A` etc. Never reuse a batch/control SHA to force a second run.
- This acts as **the explicit dispatch instruction** for one already-approved batch and full frozen application SHA; it does not authorize any separate policy changes.
- The bot will try to post a link to the official Run and record the Run in the dispatch job summary.
- When the official workflow reaches `Approve Production`, the GitHub Owner must still approve `production-sms-v3-staging` in the GitHub UI.

## Fail-closed checks

1. The comment must arrive on issue **#548**, not a PR; it must be posted by the exact Owner account, report association OWNER and action created.
2. All command arguments are strict-validated and never evaluated as shell or interpreted as GitHub Action expressions.
3. The protected Integration branch `fix/serverless-database-reliability` must still point exactly at the supplied Control SHA.
4. The tracked `.github/releases/approved-production.json` on Integration must pin the Batch, Application SHA, rollback and expected target and be marked for Owner decision.
5. Both Control SHA and frozen Application SHA must have successful exact-SHA `CI` runs.
6. Every page (up to 2,000 runs, otherwise STOP) of the **official** Production workflow's run history is inspected: no active runs of any SHA and no previous dispatch of the same Control SHA, including failed runs.
7. The bridge POSTs only to the existing `deploy-approved-production-v2.yml` with ref `fix/serverless-database-reliability`. It never calls Vercel deploy/promote or accesses production database.
8. The official workflow independently revalidates the manifest, source, CI, rollback, environment, candidate and post-deploy sentinels; any failed gate stops/rolls back per existing governance.

## Isolation and limits

- The dispatcher exists on **GitHub default branch `main`** because `issue_comment` workflows load from the default branch. Production application/control code remains on `fix/serverless-database-reliability`.
- No Khai-Hub or user's laptop required. GitHub Actions supplies short-lived `GITHUB_TOKEN` with narrowly scoped actions/issues write and contents read.
- The queue is **manual Owner-command-triggered**, not a standing automatic consent for all future releases.
- Approval of the GitHub Protected Environment remains a separate human gate.
- The GitHub REST dispatch endpoint returns no run ID; the bridge makes a best-effort read of the newly created Run and records an official workflow link if delayed.
- If Owner account token lacks permissions or GitHub Actions disallows dispatch, the bridge fails; do not bypass protections.
- Do not dispatch while an earlier Production Run is waiting for its Environment review.
- If the official workflow fails after dispatch, inspect the failure and follow the release governance; do not blindly retry with a new SHA.
- Remove the older one-shot R5-A bridge to reduce the reachable write-capable automation surface.

## Test and upgrade policy

`node --test test/owner-production-dispatch-bridge.test.js`

All logic changes require a reviewed PR to `main`, exact-SHA CI and attention to Actions permissions and untrusted issue comments. Never use `pull_request_target` to execute external PR code.
