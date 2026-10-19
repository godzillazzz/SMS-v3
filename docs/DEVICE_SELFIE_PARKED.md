# Attendance Device Selfie — PARKED (Owner decision, 19 Oct 2026)

Owner decision: **ข — พักฟีเจอร์นี้** after SENTINEL round 8 returned `RELEASE_DECISION: STOP`.

## What is parked
- Live-camera selfie enforcement for a FOREIGN (second) device
- ADMIN approval revokes the first device; ADMIN rejection makes the shift absent
- Orphan selfie reconciliation and retention purge
- Migration `202610190001_attendance_device_selfie` (new table only)

## Where it lives
- Parked branch: `feature/attendance-device-selfie-parked` at `76180cce`
- Integration branch `fix/serverless-database-reliability` still contains the same commits
  (`acaeb1af` … `76180cce`) because they were built on the release lineage.

## Open findings at the moment of parking (SENTINEL round 8)
- `R5-001` (HIGH) — `reconcileOrphans` behaviour with `olderThanMs = 0` and recently uploaded objects
  is not yet demonstrated by the reviewer's probe (expected `deleted=1, skippedRecent=0`).
- `R5-002` (MEDIUM) — writer-level canonical audit regression for every action is still missing.

Closed in earlier rounds: `R4-001` fail-open (now `503`), `R4-004` secret entropy, recursive/paginated
listing, reconcile fail-closed, `limitReached` reporting.

## Consequence for releases
`scripts/ci/preflight-release.js` refuses a release whose prisma tree differs from production unless
the manifest declares the migration. Therefore **no release can be cut from the integration branch
until either the migration is applied through its gate, or the parked commits are reverted.**

## How to resume
1. Re-open `feature/attendance-device-selfie-parked`.
2. Fix `R5-001` (probe: `olderThanMs=0` must delete the orphan, `skippedRecent` must be `0`) and add the
   writer-level canonical audit regression for every action.
3. SENTINEL re-review on the exact SHA.
4. Owner approves the migration gate (`DEVICE2-SELFIE` profile), then the deploy gate.
