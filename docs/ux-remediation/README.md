# SMS-v3 — Repository reference index for Codex

This directory is the shared reference for **Codex Desktop and Codex Cloud**. All paths are relative to the repository checkout. Do not depend on files in the owner's Windows Downloads folder.

## Mandatory read order before project work

1. `AGENTS.md` — operating contract, branch/production constraints and Definition of Done.
2. `MASTER_HANDOFF.md` — **latest authoritative release checkpoint and current blockers**; older sections are historical.
3. `.agents/skills/sms-v3-autonomous-operator/SKILL.md` — evidence-first autonomous workflow.
4. For UX/UI, visual assets, printing or acceptance: `docs/ux-remediation/PLAN.md` — **Owner's task definitions and acceptance criteria**, not a current deploy-status feed.
5. Inspect affected code, tests, current remote branch SHA, GitHub CI and Vercel Preview/Production evidence before deciding what is actually complete.

**Plan chronology:** PLAN.md was last updated on 7 Oct 2026. Its embedded "R3 current Production", pending R4 and R5 task labels are historical snapshots. R4 was released on 8 Oct 2026. Read the newest `MASTER_HANDOFF.md` first, then verify live status. Do not re-implement tasks already merged or assume unmerged tasks are live.

## Reference files already tracked in this repo

| File | Use |
|---|---|
| `PLAN.md` | T01–T33 UX/UI, acceptance, performance and governance details |
| `T20_E2E_PROPOSAL.md` | Proposal only: existing Playwright / PR #87 reconciliation, isolated business-journey coverage, CI and Physical UAT separation; Owner scope acceptance before implementation |
| `sms-v3-leave-print-reference.png` | T29 leave print A4 reference |
| `sms-v3-timesheet-reference.png` | T31 individual monthly timesheet A4 reference |
| `sms-v3-loading-logo.webp` | T32 light-surface loading logo source |
| `sms-v3-loading-logo-dark.webp` | T32 dark-surface loading logo source |
| `sms-v3-logo-horizontal.webp` | T33 light-surface brand logo source |
| `sms-v3-logo-horizontal-dark.webp` | T33 dark-surface brand logo source |

For each task, compare its acceptance criteria in `PLAN.md` against current code, merged PRs, CI and actual browser evidence. Status classification should be **MERGED / DEPLOYED / VERIFIED / PARTIAL / BLOCKED / NOT STARTED**, with exact evidence and limitations.

## Security and release boundaries

- Work from the verified current Integration source (historically `fix/serverless-database-reliability`), not stale `main`. Do not assume the latest source without checking.
- This is a **public repository**. Do **not** commit machine-specific Codex/Khai-Hub settings (`.codex/config.toml`), `.env`, private keys, passwords, tokens, database connection strings, authenticated browser profiles, or sensitive Production logs.
- Never mutate Production employee/schedule/attendance data to test UI. Respect Protected GitHub Environment review and exact-SHA release gates. Updating this documentation is **not** a Production deployment authorization.
- G06.1 anti-buddy-punching remains subject to its own architecture, security and UAT gates. Do not silently add biometric Face/QR prerequisites or change device/offline/GPS enforcement.

## Session opener

`Read AGENTS.md, the latest ACTIVE/CLOSED section of MASTER_HANDOFF.md, the autonomous-operator skill, and this README. For any UX-related work, then read PLAN.md and relevant reference images. Refresh source/CI/runtime evidence, identify the earliest authorized unresolved gate, and continue through safe steps. Report exact SHAs, evidence and remaining blockers; never claim skipped checks passed.`
