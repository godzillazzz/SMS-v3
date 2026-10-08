# MASTER HANDOFF

## ACTIVE — R4 Production verified; ordered remediation resumes — 8 ตุลาคม 2569

**สถานะ: R4 LIVE / VERIFIED.** Production release scope contains only work merged into `fix/serverless-database-reliability`; T19 (#530), T08, open UX work, and G06.1 implementation are excluded. Production workflow dispatch used Integration SHA `0c36e2fbc65d115c92bbd13402e96c95b4c6f06a` after the release manifest and workflow fixes merged. `PLAN.md` is absent from this branch; the Owner plan in open PR #521 remains reference scope only.

### R4 scope and source evidence

- Application source is PR #534 merge `59fb7f9ea4de1ab3403d16f1a750aec01c66de91`, tree `f6c59d08c982707206f170283efd652bbb9fee65`. Release ID `sms-v3-prod-59fb7f9ea4de-20261008` pins this exact application SHA.
- The release contains merged tasks T29, T07, T09, T16, T10–T15, and T17, plus the merged technical-smoke fix. T17 is PR #525 / merge `b10223153b26188c328cbfc56b4eeaee4af6af35`.
- Exact source CI [run 37729673741](https://github.com/godzillazzz/SMS-v3/actions/runs/37729673741) passed on `59fb7f9…`. Native Preview `dpl_BuwNdL5oW8NFfrTwMiMtaXA4PvUp` was READY in project `prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s`, with native SHA/ref `59fb7f9…` / `fix/serverless-database-reliability`. Preview `/api/v1/health` and `/api/v1/ready` returned 200; readiness reported `database=ok`.
- Technical Smoke [run 37730571924](https://github.com/godzillazzz/SMS-v3/actions/runs/37730571924) passed: 11 passed / 0 failed / 23 skipped. Credential-optional authenticated role suites were skipped and are not claimed as tested. Its artifact was `11529850250` (`sha256:7353f175de314a04d2285ac7856aa5dc1ea95ba676436416b0f571dba1835638`).
- Release-control PR #535 merged as `c8b96d7042f3e72303f3c84316370070d12d7b5b` and repinned the manifest to the exact application source. Runtime-sentinel correction PR #536 merged as `0c36e2fbc65d115c92bbd13402e96c95b4c6f06a`. Exact Integration CI [run 37733349855](https://github.com/godzillazzz/SMS-v3/actions/runs/37733349855) passed on that Integration SHA. Initial release-control PR #532 merged normally as `591d019736b8381314c36a32237023ec56e5f69b` and was superseded by #535/#536 before dispatch.

### Protected Production result

- Official `deploy-approved-production-v2.yml` run [37733703819](https://github.com/godzillazzz/SMS-v3/actions/runs/37733703819) completed **SUCCESS** on `fix/serverless-database-reliability` at `0c36e2f…`. Manifest preparation and the protected `Approve Production` job passed. Candidate verification, explicit promotion, and post-deploy verification passed; automatic rollback steps were skipped because verification succeeded.
- Immutable candidate and new canonical deployment: `dpl_J8ss5NqiDZu33QpAc8Bfrt9DvX1x`, READY, Production target, project `prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s`, native SHA/ref `59fb7f9…` / `fix/serverless-database-reliability`. The canonical alias `sms-v3-staging-ten.vercel.app` now resolves to this deployment. Its health returned 200 and readiness returned 200 / `database=ok` on an independent read after promotion.
- The protected workflow's canonical CORS checks and 20/20 base UI runtime sentinels passed. No authenticated employee/admin role flow was claimed. The previous Production deployment `dpl_AuwFqQcpUCvbuPaj1w78JBAzVLuo` remains READY / Production at SHA `b3e70834977a1b29b367e8a1d3b3cfebac0d74c8`; the release workflow verified it as the current canonical rollback checkpoint before candidate creation. Vercel's post-release rollback-candidate list selector returned 403, so the independently verified rollback evidence is the retained READY deployment record and the workflow's successful pre-promotion checkpoint check.
- Earlier protected run #37731997942 failed the runtime label check and its governed rollback to the prior canonical was confirmed in PR #536. The final successful run above used the corrected Thai labels; the failed attempt is not represented as a release success.
- Manifest set `run_migrations=false` and declared no database/schema/data, environment/secret, RBAC/authentication, CORS-policy, or business-policy changes. No Production business data or schema was mutated. Production promotion occurred only through the official protected workflow; no direct Vercel promotion or protection bypass was used.

### Ordered remediation after R4

| Item | Status | Remaining gate |
|---|---|---|
| T17 Accessibility | MERGED and included in R4 | PR #525 / merge `b10223153b26188c328cbfc56b4eeaee4af6af35`. |
| T19 | BLOCKED — Owner decision | PR #530 remains OPEN / DRAFT at `babf948d5d1979c01575e8db2f5515980654a892`. Owner must approve the metric/action-key to destination and exact query/filter mapping, and confirm whether filter/API-contract changes are in scope. Do not infer filters. |
| T18 | BLOCKED — current telemetry | Requires an authorized, redacted current top-route latency sample set; current p50/p95/max and 5xx evidence are unknown. |
| T24 | PARTIAL / VERIFY-FIRST | Existing query batching is recorded; current Preview timings, distinct-department workload measurements, and database-region evidence are still missing. Do not change schema, region, or environment without authorization. |
| T20 | NEXT — proposal first | Follow Owner scope in open PR #521; prepare the E2E proposal before implementing flows or adding dependencies. |
| G06.1 Phase 0 | NOT STARTED | Architecture, threat, and compatibility audit only, after T20; no implementation. |
| T08 | BLOCKED — Owner/API decision | Never infer schedule-revision differences client-side. |

Continue in order T19 → T18/T24 verify-first → T20 → G06.1 Phase 0, after the completed T17 closeout. Release completed work only after the required exact-SHA protected-release gates pass. No Production data/schema/migration/secret/env/RBAC/auth/business-policy change is authorized.

---


## HISTORICAL — R4 Production preflight before final manifest/runtime fixes — 8 ตุลาคม 2569 (superseded above)

This section records the pre-dispatch snapshot from before PRs #535 and #536 merged. Its earlier “not yet deployed” statements are historical; the active section above records the verified R4 outcome.

**สถานะ: Release-Control PR #532 เปิดอยู่; Production ยังไม่ได้เปลี่ยน.** ผู้ใช้สั่งให้ทำเฉพาะ release ของงานที่เสร็จและ Merge เข้า Integration แล้ว และหยุดหลัง Production verification. Source ที่ freeze คือ `origin/fix/serverless-database-reliability` SHA `59a7e944b4481292b9b297608a676f3f3eb2f862`, tree `f24c334ff2da8d025382cf9bcefb30cd9d5a6b04`. Source นี้เป็น descendant ของ Production SHA เดิม `b3e70834977a1b29b367e8a1d3b3cfebac0d74c8` และ workflow จะยืนยัน ancestry/tree ซ้ำก่อนสร้าง candidate.

- PR #532 head `00df723dd94e5e47265b68991eb476af9f2a596b` created successfully. Its Preview `dpl_AyL4L7DxfRdixSfF5izSpqh3bYyV` is READY with exact PR-head SHA/ref.
- First PR CI [run 37726108786](https://github.com/godzillazzz/SMS-v3/actions/runs/37726108786) failed at `npm test`: 1,337 passed / 1 failed. The sole failure was the stale R3 assertion in `test/attendance-time-policy-application-release.test.js` expecting `b3e708...` as the release SHA; it reported actual R4 `59a7e944...`. Browser regressions, dependency audits, environment contract, Prisma format/validate/generate, test migrations/seed, and migration status steps passed before that failure. The assertion now matches the R4 manifest; focused release checks pass 18/18 and the manifest guard passes. A local full `npm test` attempt could not initialize the shared workspace Prisma client; hosted CI is the required full-suite evidence. PR merge and Production remain blocked pending fresh exact-head CI SUCCESS and Preview runtime checks.

### Release scope — merged only

- T29 Printing/A4 — PR #497; T07 Approval Inbox — #499; T09 routing/deep links — #501 และ login-test stabilization #515; T16 Thai date/time — #504.
- T10 Personnel Readiness — #506; T11 Monthly Roster UX — #508; T12 settings architecture — #510; T13 leave-request form — #513; T14 onboarding — #516; T15 Thai UI copy — #518; T17 accessibility — #525.
- Technical-smoke hydration/timing fix — #527. Merged handoff/audit-only PRs #500, #503, #507, #509, #512, #514, #517, #523, #524, #528, #529, #531 are documentation/test governance only. T08 memo #500 makes no client-side schedule diff. T19 implementation PR #530 remains OPEN/DRAFT and is excluded; open #520 and #521 are also excluded.
- The exact source diff from current Production has no Prisma schema or migration changes. The only backend runtime diff found is optional `employeeId` filtering on existing read-only license/quota list endpoints; existing authorization checks remain in place. T07 decisions still use the existing server APIs; T13's quota is advisory in the form and the server remains authoritative; T11 does not infer shortage warnings. No authentication/RBAC, schedule approval, leave policy, attendance authority, GPS/device, database, environment, or security policy change was authorized or found in the released task scope.

### Exact source gates

- Exact Integration CI: run [37723174787](https://github.com/godzillazzz/SMS-v3/actions/runs/37723174787), SUCCESS on `59a7e944b4481292b9b297608a676f3f3eb2f862`.
- Exact Git Preview: `dpl_29u5qamLviMdHQNBTPPwZSoKRVJt`, READY; native SHA/ref `59a7e944b4481292b9b297608a676f3f3eb2f862` / `fix/serverless-database-reliability`, project `prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s`. The exact technical run checked Health/Readiness/database and trusted/untrusted CORS.
- Technical Smoke run [37724634808](https://github.com/godzillazzz/SMS-v3/actions/runs/37724634808), SUCCESS: 11 passed, 23 skipped, 0 failed; artifact `11527721225` (`sha256:48ba412bf7a37d888fcab11b9baed7c917280280260f25ed36389e71450fba72`). The passed tests cover health/readiness/assets/audit authorization boundary/CORS and login at 390/768/1440px. Authenticated ADMIN/MANAGER/VIEWER role suites were skipped by the credential-optional smoke workflow and must not be described as passed.
- The Vercel project API response does not expose `autoAssignCustomDomains`. The protected release workflow's `create-vercel-git-candidate.js` explicitly fails unless the live project property is `false`, before it creates a candidate; this must pass in the official workflow. No direct candidate creation or promotion is permitted.

### Live Production checkpoint and controls

- Fresh Vercel lookup resolves canonical `https://sms-v3-staging-ten.vercel.app` to READY Production `dpl_AuwFqQcpUCvbuPaj1w78JBAzVLuo`, native source SHA `b3e70834977a1b29b367e8a1d3b3cfebac0d74c8`, ref `fix/serverless-database-reliability`; the canonical alias is listed on that deployment. This is the rollback checkpoint for this release.
- Canonical `/api/v1/health` returned 200 `status=ok`; `/api/v1/ready` returned 200 `status=ready`, `database=ok`. Production deployment listing showed no active build.
- GitHub Environment `production-sms-v3-staging` was freshly read: required reviewer `godzillazzz` remains enabled; prevent-self-review and administrator bypass remain unchecked. No protection rule, environment, secret, data, or Production setting was changed. Protected workflow dispatch and normal Environment approval remain mandatory.
- No Production deployment, promotion, rollback, or Production data/schema/environment/secret/RBAC/auth/business-policy mutation has occurred in this release attempt yet. After Release-Control merge and exact merge CI, recheck canonical/rollback and dispatch only `deploy-approved-production-v2.yml` on Integration. Verify the immutable candidate and post-promotion canonical/runtime/rollback using workflow evidence; if deployment verification fails, rely on its governed automatic rollback and verify it.

---

## HISTORICAL — T18/T24 verify-first checkpoint at `9b57e6e7fe1a1aa9e8a244bc6817b2f57aa8d183` (superseded by current status above)

**สถานะ: T18 BLOCKED รอข้อมูล route latency ปัจจุบัน; T24 PARTIAL / VERIFY-FIRST.** ส่วนนี้ supersede สถานะ ACTIVE เก่าด้านล่าง. Integration SHA ที่ตรวจสดคือ `9b57e6e7fe1a1aa9e8a244bc6817b2f57aa8d183` บน `origin/fix/serverless-database-reliability`. `PLAN.md` ไม่มีใน Integration tree; ใช้เฉพาะแผน Owner ใน PR #521 ซึ่งยัง OPEN / NOT MERGED, head `40f25fb9416308d3c67ff61722969998cdea9cb8`, เป็นข้อกำหนด ไม่ใช่ฐานโค้ด.

### T19 recovery / closeout

- PR [#530](https://github.com/godzillazzz/SMS-v3/pull/530) ยัง OPEN / DRAFT / NOT MERGED; head `babf948d5d1979c01575e8db2f5515980654a892`, base `9b57e6e7fe1a1aa9e8a244bc6817b2f57aa8d183`.
- Exact-head CI [run 37721998095](https://github.com/godzillazzz/SMS-v3/actions/runs/37721998095) SUCCESS. Native Preview `dpl_Gmxv275TyCgpmsHx8w7XHhBUar8Z` is READY in project `prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s`, exact Git SHA/ref match (`codex/t19-dashboard-20261008`); CI Preview health/readiness/CORS step passed. Read-only `/api/v1/health` returned 200; `/api/v1/ready` returned 200 / `database=ok`.
- T19 acceptance remains BLOCKED: Owner must provide the approved `metric/action key → destination + exact route query/filter` mapping and confirm whether filter/API-contract changes are in scope. No filters are inferred; PR remains draft. Local frontend/build/browser evidence is recorded in PR #530. No Production release or mutation occurred.

### T18/T24 scope and evidence at exact Integration SHA

- Owner plan T18 requires current top-10 route latency samples, route-level N+1/pagination/index/cold-start/region review, and before/after results (p95 target <1,500 ms); adding an index or migration requires approval. T24's owner plan gives older Production observations and targets (`supervisor/daily` <5 s, the other listed endpoints <3 s on Preview sharing Production's DB region), but those observations are historical, not a current baseline.
- Exact Integration CI [run 37718184394](https://github.com/godzillazzz/SMS-v3/actions/runs/37718184394) SUCCESS on `9b57e6e7fe1a1aa9e8a244bc6817b2f57aa8d183`; `npm test`, integration tests, frontend tests, and production build passed. Its push-triggered Preview runtime step was SKIPPED. Native Integration Preview `dpl_64S7PBWQmMcspkGisGfPitnEQ2bV` is READY, project `prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s`, exact Git SHA/ref match (`fix/serverless-database-reliability`), URL `https://sms-v3-staging-ig28we8aq-godzillazz.vercel.app`. Read-only health returned 200 and readiness returned 200 / `database=ok`. Technical Smoke was not run on this SHA.
- The `/api/v1/system-health` route requires authenticated ADMIN authority. No authorized ADMIN session or current redacted route-sample export was available, so the current top ten routes, p50/p95/max, 5xx rate, and Production timings remain UNKNOWN; no Production endpoint or data was queried. The exact Preview's function region is `iad1`; `vercel.json` does not pin a region. The database region is UNKNOWN and was not inferred from or read from any secret. The Owner plan's earlier `sin1` observation is not current evidence.
- Read-only runtime-log query for the exact Preview, `performance_stage`, last 30 minutes returned no matching logs. A wider one-hour query failed because the available Vercel log retention rejected that window; it is not evidence that no logs exist.
- Source/test audit found existing T24 batching: `supervisor/daily` loads assignments with relations, batches leave and correction reads, hydrates policy events in bulk, bulk-loads actual sites, and caches default-site resolution by department. The existing 12-assignment test asserts one policy hydration query and one bulk actual-site query; distinct-department default-site load is not measured.
- Readiness center caps at 50 employees, selects related employee/schedule data in one employee query, batches approval rows by assignment month, and caches default-site resolution by department. Its existing 50-employee/single-department test asserts no per-employee employee/shift lookup, one approval batch read, and one site resolution. Distinct-department load is not covered.
- Dashboard uses grouped aggregates where available and caps database-query concurrency at two; its existing normal-path test asserts 13 mocked operations and peak concurrency ≤2. Approval summary also caps its query workers at two, and the badge polls every 60 seconds only while the document is visible. These source/test facts do not prove endpoint latency against current data.
- T24 remains PARTIAL: no current authenticated Preview timings or before/after comparison, no distinct-department workload measurement, and no DB-region evidence. No index/schema change is justified by the available measurements; no such change was made.

### Ordered work / release gate

| Item | Status | Remaining gate |
|---|---|---|
| T17 | MERGED | PR #525 / merge `b10223153b26188c328cbfc56b4eeaee4af6af35`; closeout evidence in prior handoff. |
| T19 | BLOCKED — Owner decision | Approved exact metric-to-filter mapping and filter-contract scope; PR #530 stays draft. |
| T18 | BLOCKED — current telemetry | Authorized, redacted current System Health route samples to identify the actual top ten routes. |
| T24 | PARTIAL / VERIFY-FIRST | Current Preview measurements, distinct-department workload evidence, and Owner decision before any region/environment/index change. |
| T20 | NEXT — proposal only | Owner plan says propose E2E coverage before implementing workflows; no test dependency or flow was added here. |
| G06.1 Phase 0 | NOT STARTED | Architecture/threat/compatibility audit only after T20. |
| T08 | BLOCKED — Owner/API decision | Never infer schedule revision diffs client-side. |

No Production deploy/promote/Environment approval, Production data/schema/migration/secret/env/RBAC/auth/business-policy mutation, or Technical Smoke occurred in this checkpoint. Do not attempt Production until the ordered batch and all exact-SHA release gates pass.

---

## ACTIVE — T19 scope audit / remediation checkpoint — 8 ตุลาคม 2569

**สถานะ: OPEN.** Current Integration at this checkpoint is d727f5ce01dbefdf06bdb3e8f6b61a27432933fd on origin/fix/serverless-database-reliability. The T19 audit used exact base HEAD d727f5ce01dbefdf06bdb3e8f6b61a27432933fd. T17 is merged. T19 and T18 lack authoritative task scope; T24 has source-level batching evidence but no measured Preview timing or database-region evidence. PLAN.md is absent at this Integration SHA. No Production deployment, promotion, Environment approval, Production data, schema/migration, secret/env, RBAC, authentication, or business-policy mutation occurred.

### T17 — merged and verified

- PR [#525](https://github.com/godzillazzz/SMS-v3/pull/525) merged normally as b10223153b26188c328cbfc56b4eeaee4af6af35. Its final PR head was ea211d48c9f0ec2e45fbdf3db9e779fb9a50b61d on base a41080cb9825e2d1939d17b057ff55bf5ab1d9a2.
- Exact PR-head CI [run 37715743778](https://github.com/godzillazzz/SMS-v3/actions/runs/37715743778) completed SUCCESS; its Preview runtime health/readiness/CORS step passed. Native Preview dpl_2YrtF3jQUtg3S5neQ1Pgh3S5Br78 was READY in project prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s with exact githubCommitSha ea211d48c9f0ec2e45fbdf3db9e779fb9a50b61d and ref codex/t17-a11y-rebuild; read-only health returned 200 and readiness returned 200 / database=ok.
- Exact merge CI [run 37716078657](https://github.com/godzillazzz/SMS-v3/actions/runs/37716078657) completed SUCCESS on merge SHA b10223153b26188c328cbfc56b4eeaee4af6af35. Its push-triggered Preview runtime step was skipped. Exact-SHA Integration Preview dpl_38Hm1Y3rXVhMtsAUcxDoLSji6SVv is READY in project prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s, with exact source SHA b10223153b26188c328cbfc56b4eeaee4af6af35 and ref fix/serverless-database-reliability; read-only health returned 200 and readiness returned 200 / database=ok. CORS passed on the exact PR head but was not separately verified on the merge SHA.
- Local T17 verification recorded before merge: frontend Vitest 154 files / 916 tests; configured Playwright 19/19; axe serious/critical violations 0 on Login and a synthetic Dashboard; root and frontend npm audit 0; TypeScript/build/bundle guard passed; Lighthouse accessibility 100/100 on those local pages. No Production data was used.

### PR #528 — T24 verify-first handoff update

- PR [#528](https://github.com/godzillazzz/SMS-v3/pull/528), head d9a9ac93fe17ce76fbb10aaaecddded05a343d6b, merged normally as d727f5ce01dbefdf06bdb3e8f6b61a27432933fd.
- Exact PR-head CI [run 37717085869](https://github.com/godzillazzz/SMS-v3/actions/runs/37717085869) completed SUCCESS. Preview dpl_74h1WBjHxjT27m7gAMNRrziGnrgT was READY with exact head SHA/ref; health and readiness returned 200 / database=ok, and CI Preview health/readiness/CORS step passed.
- Exact merge CI [run 37717449006](https://github.com/godzillazzz/SMS-v3/actions/runs/37717449006) completed SUCCESS on d727f5ce01dbefdf06bdb3e8f6b61a27432933fd. Its push-triggered Preview runtime step was skipped. Exact Integration Preview dpl_2cYSZocQaDsQbB7LuwP3jGVESody is READY in project prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s, with githubCommitSha d727f5ce01dbefdf06bdb3e8f6b61a27432933fd and ref fix/serverless-database-reliability; read-only health returned 200 and readiness returned 200 / database=ok. CORS was not separately checked on this merge SHA.

### T19, T18, T24 — current-head audit

- T19 is BLOCKED before implementation: PLAN.md is absent, this handoff contains no T19 scope or acceptance criteria, repository issue search returned no result, and the only T19 PR search hit is PR #528, which documents that the scope is missing but defines no task. Current Integration source and commit history contain no T19 implementation or task definition. Required Owner action: provide the authoritative T19 task definition and acceptance criteria.
- T18 is BLOCKED before implementation for the same missing-plan/scope reason; issue search returned no result, and PR search found only PR #528, which mentions T18 while recording that the scope is missing. No task-specific T18 requirements are available. Do not infer its intended behavior.
- T24 verify-first audit at exact HEAD b10223153b26188c328cbfc56b4eeaee4af6af35 found existing readiness-center batching: the list is capped at 50 employees, uses one employee query with related records and upcoming assignment, batches approval reads by month, and caches default-site resolution per department. Explicit schedule sites are selected with the assignments. The existing test “readiness center batches fifty employees without per-employee DB lookups” asserts zero per-employee employee/shift lookups, one approval batch read, and one site resolution for a 50-person, single-department fixture. A distinct-department workload can still issue one default-site query per department; this workload was not measured.
- Dashboard source already uses grouped workforce/leave/license aggregates when supported, caps per-request query concurrency at 2, and emits performance_stage timings when request IDs are present. The existing normal-path test asserts 13 mocked operations and peak overlap no greater than 2. Exact merge CI run 37716078657 passed npm test, integration, frontend tests, typecheck, and build.
- Exact Integration Preview metadata reports function region iad1; database region is UNKNOWN and was not inferred from or retrieved from a secret. A 30-minute runtime-log query scoped to dpl_38Hm1Y3rXVhMtsAUcxDoLSji6SVv found no performance_stage entries. No authenticated dashboard timing run or before/after Preview comparison is available, so T24 remains PARTIAL / VERIFY-FIRST.

### Remaining ordered work and release gate

| Work item | Status | Evidence / remaining gate |
|---|---|---|
| T29, T07, T09, T16, T10–T15 | MERGED to Integration | Prior PR, merge, CI, Preview, and task-specific evidence remain in historical sections. |
| T08 Approval Detail | BLOCKED — Owner/API decision | Do not infer schedule-revision diffs client-side. Owner must choose an authoritative immutable revision-diff/read API or defer the detail. |
| T17 Accessibility | MERGED | PR #525 / merge b10223153b26188c328cbfc56b4eeaee4af6af35; PR-head CI 37715743778 and merge CI 37716078657 SUCCESS; exact Preview source/READY and health/readiness verified. |
| T19 | BLOCKED — missing authoritative scope | Owner must provide task definition and acceptance criteria. |
| T18 | BLOCKED — missing authoritative scope | No T18 task definition in PLAN.md, an issue, a task-specific PR, or the handoff; PR #528 only records the missing scope. |
| T24 | PARTIAL — verify-first | Readiness/dashboard batching exists in source and passed exact merge CI; distinct-department default-site query fanout, database region, and before/after Preview timing remain unresolved. |
| T20 | NOT STARTED / SCOPE UNKNOWN | No task scope is recorded; preserve sequence after T19 and T18/T24. |
| G06.1 Phase 0 | NOT STARTED | Audit only. Roadmap PR #465 merged as b9fcc2259e72e4256ccda7aa23c22a3dcc1ec2ae; preserve its non-biometric-first threat/compatibility boundary. |

Technical Smoke for current Integration SHA d727f5ce01dbefdf06bdb3e8f6b61a27432933fd has not been verified. Current Production canonical/rollback, approved manifest, immutable candidate, Environment protection, and workflow dispatch eligibility were not freshly verified in this checkpoint. Production was not attempted. Do not promote until the ordered batch and every exact-source protected-release gate pass. Keep T08 blocked pending Owner/API decision and never infer schedule revision diffs client-side.

## HISTORICAL — T17 recovery checkpoint before merge — 8 ตุลาคม 2569 (superseded by ACTIVE section above)

**สถานะ: OPEN.** T17 is recovered on its dedicated worktree and PR #525. The old provenance blocker for `a132ac1…` is resolved. After syncing current Integration `a41080c…`, PR #525 was fast-forwarded; its latest verified head `645db469…` passed exact CI and has a matching READY Preview with health/readiness checks passing. The handoff update itself is documentation-only and must pass exact-head checks before merge. Use `origin/fix/serverless-database-reliability` as the only integration source; no `main` use or force-push. No Production deploy/promote/Environment approval or Production data, schema/migration, secret/env, RBAC, authentication, or business-policy change occurred.

### Current source and T17 recovery

- Fresh fetch of `origin/fix/serverless-database-reliability` is `a41080cb9825e2d1939d17b057ff55bf5ab1d9a2`. Exact integration CI run `37712005662` completed SUCCESS; its Preview runtime step was skipped because this was a push run. The native Vercel Preview is deployment `dpl_3rE5gLk49UyUEZCR2ED6riCbxi7f`, READY in project `prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s`, with `githubCommitSha=a41080…` and `githubCommitRef=fix/serverless-database-reliability`; authenticated read-only `/api/v1/health` returned 200 and `/api/v1/ready` returned 200 with `database=ok`.
- `PLAN.md` is absent at the current Integration SHA and is not present in the reachable approved-branch history. The Owner-supplied old T17 commits `259f794…` and `9d0b7d6…` are unavailable in this workspace/remote; the exact prior implementation could not be restored. T17 was recreated in `/workspace/SMS-v3/.worktrees/t17-a11y-rebuild`, branch `codex/t17-a11y-rebuild`, based on `9f1c84a…`.
- PR #525 is open against `fix/serverless-database-reliability`, fast-forwarded from `a132ac1505e0e752afedf13256c96a10c4f1a486` to `645db4697111d1e22ceaf78e9fea71f8592a2353`; its base now tracks Integration `a41080cb9825e2d1939d17b057ff55bf5ab1d9a2`. Exact-head CI run `37715294446` on `645db469…` completed SUCCESS; all 31 validation steps passed, including Preview health/readiness/CORS. Combined status reports Vercel success.
- For former PR head `a132ac1…`, native Vercel evidence is deployment `dpl_8kmrKkRUaHY4pDffUHMGRbPNXZpz`, state READY, target Preview, project `prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s`, `githubCommitSha=a132ac1505e0e752afedf13256c96a10c4f1a486`, ref `codex/t17-a11y-rebuild`; its Preview alias returned health 200 and readiness 200 / database ok. This resolves the former provenance blocker for `a132ac1…`.
- The latest verified PR head `645db4697111d1e22ceaf78e9fea71f8592a2353` has Vercel deployment `dpl_QiLFyXeYBYQ3xhdsNHVVpb1ZX8FR`, READY, project `prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s`, exact `githubCommitSha=645db469…` and `githubCommitRef=codex/t17-a11y-rebuild`. Authenticated read-only checks on its alias returned health 200 and readiness 200 / database ok. This is separate native evidence from the earlier `a132ac1…` Preview.
- Recreated changes align visible and accessible names on Login, password-toggle, command-menu, and dashboard-stat controls; remove the nested `main` landmark; improve existing light-theme contrast; and add `axe-core` plus configured Playwright accessibility regressions. The changes do not alter API, auth behavior, business policy, RBAC, schema, or data behavior.
- Local verification on the T17 implementation before the integration sync: frontend Vitest **154 files / 916 tests**; configured Playwright suite **19/19** including axe at desktop/mobile; serious/critical axe violations **0** for Login and synthetic Dashboard; root and frontend npm audit **0 vulnerabilities**; frontend TypeScript/build and bundle guard passed (**main 399,059/400,000; map 151,947/300,000; CSS 699,932/700,000; 48 JS chunks**); Lighthouse accessibility **100/100** for Login and synthetic Dashboard. No Production data was used.
- The integration-sync merge commit is `15329be715d45834be7e6f0bc5cbf399ad0b9dff`, with parents T17 `a132ac1…` and Integration `a41080c…`; relative to Integration, T17 changes 11 files. PR head `645db469…` adds the evidence handoff on top. `git diff --check` passed. Exact CI, native Preview provenance/READY, health/readiness/database, and the Preview runtime step all passed on `645db469…`.

### Production release gate — current source only

- Current Integration `a41080…` exact CI `37712005662` is SUCCESS. Its native Preview `dpl_3rE5gLk49UyUEZCR2ED6riCbxi7f` is READY and source/ref exact; live health and readiness/database checks returned 200. Technical Smoke for `a41080…` has not been verified in this task state. The R3 manifest still targets the older `b3e708…`; it is not a candidate for current Integration or the T17 PR.
- The previous exact-source Technical Smoke failure `37652582109` on `d2977e…` remains historical and is not current-source evidence. The production manifest, candidate, current canonical/rollback, GitHub Environment protection, and authenticated workflow dispatch must be freshly verified after the ordered remediation batch. Do not use a direct Vercel promote or any protection bypass.
- **Production was not attempted.** The current work is at T17 recovery/closeout; continue T19 and the verify-first T18/T24 gate before attempting any release. Do not alter Production data/schema, secrets/environment, RBAC, auth, or business policy.

### Final audit status / next gates

| Work item | Status | Evidence / remaining gate |
|---|---|---|
| T29, T07, T09, T16, T10–T15 | MERGED to integration; not promoted here | Prior PR, merge, CI, Preview, and task-specific evidence remain in historical sections. |
| T08 Approval Detail | BLOCKED — Owner/API decision | Do not infer schedule-revision diffs client-side. Owner must choose an authoritative immutable revision-diff/read API or defer the detail; any schema work requires separate authorization. |
| T17 Accessibility | RECOVERED; CODE HEAD VERIFIED; HANDOFF UPDATE CHECKS PENDING | PR #525 head `645db469…`, base Integration `a41080…`; exact CI `37715294446` SUCCESS; Preview `dpl_QiLFyXeYBYQ3xhdsNHVVpb1ZX8FR` READY with exact SHA/ref/project; health 200, readiness 200/database ok, CI Preview runtime/CORS step passed. This docs-only handoff refresh must pass exact-head CI/Preview before the PR is mergeable under governance. |
| T19 | NOT STARTED | Starts only after T17 merges and the new integration handoff/current HEAD are audited. |
| T18 | NOT STARTED / SCOPE BLOCKED | `PLAN.md` is absent; identify authoritative task scope before implementation. |
| T24 | PARTIAL / VERIFY-FIRST | Prior batching/query work #489 is recorded complete. Readiness/dashboard query work, DB/function region comparison, and before/after Preview timing remain unverified/deferred. |
| T20 | NOT STARTED | Wait for preceding tasks; audit then-current HEAD. |
| G06.1 Phase 0 | NOT STARTED | Architecture/threat/compatibility audit only; no implementation or Production data/schema/config/auth mutation. |

Required `AGENTS.md`, `MASTER_HANDOFF.md`, and `.agents/skills/sms-v3-autonomous-operator/SKILL.md` were re-read; `PLAN.md` is absent. Native source provenance and runtime evidence are verified on both the original T17 PR head `a132ac1…` and latest verified head `645db469…`. A docs-only follow-up requires CI/Preview on its resulting SHA before merge. No Production mutation occurred. Preserve task order T17 → T19 → T18/T24 verify-first → T20 → G06.1 Phase 0; keep T08 blocked pending Owner/API decision. Attempt Production only after the authorized three-task batch and every exact-source protected-release gate pass.

---

## ACTIVE — Master UX Remediation (7 ตุลาคม 2569)

**สถานะ: OPEN.** งานนี้ทำเฉพาะ code, tests, PRs และ Vercel Previews ตาม scope ที่อนุญาต ไม่มี Production deploy/promote/Environment approval และไม่มีการแก้ Production data, DB schema/migration, secret/environment หรือ security/business policy. T15 PR `#518` merge แล้วเป็น `9e533b2501bdc7ac1e63c98e09783f563b407479` จาก source `66ee6c7bf15fa6d0e7c9413192aa86829885db5c` บน base `62a3c242caf6559e0bf0b7d8bd9f57e347bf0fe0`; integration HEAD ปัจจุบัน `9e533b2501bdc7ac1e63c98e09783f563b407479`.

| Task | Status | PR / merge SHA | Exact-head CI | Preview |
|---|---|---|---|---|
| T29 Printing / A4 | MERGED | #497 / `eaa880753efd3476233caf8dce306f27b7eb2e4f` | `37591241274` success | READY — https://sms-v3-staging-git-codex-t29-printing-a4-20261007-godzillazz.vercel.app; Vercel record `4TQLNtPH3SKtZQKQqC2aqfVn1mnt` |
| T07 Unified Approval Inbox | MERGED | #499 / `b2d6250b93f8aaddc98846bb487f5884f7b0e062` | `37596463287` success | READY — https://sms-v3-staging-git-codex-t07-inbox-20261007-godzillazz.vercel.app; Vercel record `CmSN7H2DCxLD21Tt6ixZ2JTGGqdA` |
| T08 Approval Detail | BLOCKED — Owner/API decision | #500 decision memo / `a4557d3a7ea40a3260d3c78c025f050c3fa1f593` | `37597496396` success | READY — https://sms-v3-staging-git-codex-t08-memo-20261007-godzillazz.vercel.app; Vercel record `2ETgdtznJjq8fYJS3BkkqjZsiyf8` |
| T09 URL Routing / Deep Links | MERGED | #501 / `c2039b6194b0b886b604a0d07dd8173d8fa4fcca` | `37602743331` success | READY — https://sms-v3-staging-git-codex-t09-url-routing-20261007-godzillazz.vercel.app; Vercel record `8qmAAXU27Nm22ksa7UFUHsnZGthc` |
| T09 handoff closeout | MERGED | #503 / `8e47a96b84d01ee75a734b4c6682274223c62c83` | `37603802657` success | READY — https://sms-v3-staging-git-codex-handoff-t09-godzillazz.vercel.app; Vercel record `8mPibk1G7tsXehPW561cdg4pWEkZ` |
| T16 Thai Date/Time Foundation | MERGED | #504 / `092acf1700d3cc2c40ed5570945f7075293cd640` | `37605739766` success | READY — https://sms-v3-staging-git-codex-t16-date-time-20261007-godzillazz.vercel.app; Vercel record `FaMMCdsMkaJZFf38h5MFZCkp5gbB` |
| T16 handoff closeout | MERGED | #505 / `7365097446bc603705f77cef4c84d146904836dc` | `37606570564` success | READY — https://sms-v3-staging-git-codex-handoff-t16-20261007-godzillazz.vercel.app; Vercel record `9q7wrYFrLxB8ZSkfUhcR1fuZJpF6` |
| T10 Personnel Readiness | MERGED | #506 / `b51daf749376fa62f716c3e17f03bf6aa4d7a946` | `37608225288` success | READY — https://sms-v3-staging-git-codex-t10-readiness-20261007-godzillazz.vercel.app; Vercel dashboard `96DTYBY8ndz7xNirABKtEx5xbkGt` |
| T11 Monthly Roster UX | MERGED | #508 / `80d8a4e6139a8956d88afdd15d52e78f98bf8a48` | `37610538228` success | READY — https://sms-v3-staging-git-codex-t11-roster-ux-20261007-godzillazz.vercel.app; Vercel record `3JvpYdmXsfNbE7quaRMfANypGErc` |
| T12 Settings Information Architecture | MERGED | #510 / `adc4d679a4340b7eb2660c64cbfe3af6e98f3059`; source SHA `a4eae0473a0ab255fec932720b62d9e7abd229d8`, base `d0e5711c9d49ff36b47206496ded0720c16d91ae` | `37615572619` success (run #1804) | READY — https://sms-v3-staging-git-codex-t12-settings-ia-20261007-godzillazz.vercel.app; project `sms-v3-staging`, dashboard record `4cGRmEf6RD3XcNVomKe3Foxjujy8` |
| T13 Leave Request Form | MERGED | #513 / `956e06a84938230d0bb25bece9b0c1d2396a3a14`; source SHA `9a943ece5f73d73edbe815b6924aa9e2651d35b3`, base `2cefe479f093d7e25e8496646456217ca0748bbd` | `37619281721` success (run #1809) | READY — https://sms-v3-staging-git-codex-t13-leave-request-20261007-godzillazz.vercel.app; project `sms-v3-staging`, dashboard record `3aiN9ZGT7okNUZBf3zk83U22mTmD` |
| T14 Onboarding Checklist | MERGED | #516 / `164ca55536f73f680b4242b2f11b6b37493e4f16`; source SHA `e24613aaaedf346f1aa3bb072ff6dfbba50cc494`, base `6b4f9c345f8a479d69dd28e051e2bc06182427d6` | `37623899459` success | READY — https://sms-v3-staging-git-codex-t14-onboarding-godzillazz.vercel.app; project `sms-v3-staging`, dashboard record `3btNdnvY2fScVCz8Yzj5qDyjbi2d` |
| T15 Thai Language | MERGED | #518 / merge `9e533b2501bdc7ac1e63c98e09783f563b407479`; source `66ee6c7bf15fa6d0e7c9413192aa86829885db5c`, base `62a3c242caf6559e0bf0b7d8bd9f57e347bf0fe0` | Exact-head CI `37632112486` success | READY / exact-head Vercel status success — https://sms-v3-staging-git-codex-t15-thai-godzillazz.vercel.app; Vercel record `G3d1KmywugzEorTPNEZ2bdoxRRwv`; CI health/readiness/database/trusted CORS/untrusted CORS PASS |

T15 current-head audit found the named copy items were not yet fully localized. PR #518 translates active dashboard, approval-history, audit, shift-setup, personnel, registration, leave, settings and role labels, while leaving role/API codes and behavior intact; it also updates existing browser/source assertions to the Thai UI. Source SHA `66ee6c7bf15fa6d0e7c9413192aa86829885db5c` was based on `62a3c242caf6559e0bf0b7d8bd9f57e347bf0fe0` and merged as `9e533b2501bdc7ac1e63c98e09783f563b407479`. Exact-head CI `37632112486` passed all jobs, including Linux sharp, configured Playwright regressions, Prisma, backend and PostgreSQL integration, Attendance, physical-acceptance/read-only checks, frontend suite, typecheck, production build/bundle, hygiene, and Preview runtime checks (`PREVIEW_HEALTH=PASS`, `PREVIEW_READY_DATABASE=PASS`, `PREVIEW_TRUSTED_CORS=PASS`, `PREVIEW_UNTRUSTED_CORS=PASS`). Vercel marked the exact head successful in project `sms-v3-staging`; branch Preview is https://sms-v3-staging-git-codex-t15-thai-godzillazz.vercel.app, record `G3d1KmywugzEorTPNEZ2bdoxRRwv`. Local verification: frontend suite 321 files / 916 tests; TypeScript and `npm --prefix frontend run build`; bundle verifier passed (main 399,260 / 400,000 bytes, CSS 699,778 / 700,000); configured Chromium suite passed 17/17; focused source contracts 21/21; synthetic API browser fixture at 1366×768 and 375×812 showed no page/console errors or horizontal overflow; `git diff --check` passed. The first two CI runs caught stale T13/T14 browser and legacy source-copy assertions, which were updated without changing product behavior; final exact-head CI passed. Local full root `npm test` could not initialize DB-backed tests without `DATABASE_URL`; authoritative CI did run the full root suite with an ephemeral PostgreSQL service. No API/business logic, authorization, schema/migration, dependency, environment/secret, Production data, or Production deployment was changed.

T10 used the existing `/employees/readiness/center` server authority, whose response is capped at 50 rows. The collapsed Thai summary and coverage note reflect only that response; the employee table shows READY / NOT_READY only for returned records, and “ไม่มีผลตรวจ” when the API did not return that employee. No client-side readiness inference, backend/API, schema, RBAC, or policy change was made. Local verification: focused component tests, frontend suite 150 files / 904 tests, TypeScript, production build, bundle verification and `git diff --check` passed. Existing Playwright Chromium fixtures passed at desktop 1366×768 and mobile 375×812 (2/2): default collapse, filters and server-authoritative statuses, first table row above 900px, no horizontal overflow or page errors, GET-only mock API. Exact-head CI `37608225288` passed Linux sharp, T29/T09 browser regressions, Prisma, backend and integration suites, Attendance integrations, physical acceptance/read-only enforcement, frontend tests/typecheck/build/bundle/hygiene, and Preview health/readiness/database/trusted and untrusted CORS. Vercel exact-head status was success/READY. No authenticated Production page was accessed.

T11 retained the existing #471/#21 department ordering, department groups, schedule business logic, and T29 print path. The monthly grid is compact by default, hides shift times until the Thai toggle is selected, keeps date headers and the employee anchor sticky, highlights today/weekends, shows a lock icon instead of `MANUAL`, and shows daily assigned-shift counts with a note that they cover only the current page and selected departments. Loading/errors display an em dash. The existing `/schedule-calendar` response has no server-authoritative shortage warning field, so none is inferred. Local verification: focused tests 27/27, frontend suite 150 files / 904 tests, TypeScript, production build, bundle verification (`699,652` CSS bytes / `700,000` budget) and `git diff --check` passed. Playwright Chromium fixture used synthetic API responses and passed desktop 1366×768 and mobile 375×812 (2/2), with no page errors or schedule write requests. Exact-head CI `37610538228` ran the full configured browser suite: T11 desktop/mobile (2) and 9 existing print/routing tests all passed (11 total); frontend suite/typecheck/build/bundle/hygiene and Preview runtime health/readiness/database/trusted and untrusted CORS gates also passed. Vercel exact-head status was success/READY. No Production page or business data was accessed.

T12 implementation was isolated on `codex/t12-settings-ia-20261007`, based on integration SHA `d0e5711c9d49ff36b47206496ded0720c16d91ae`; PR #510 merged as `adc4d679a4340b7eb2660c64cbfe3af6e98f3059`. Source SHA `a4eae0473a0ab255fec932720b62d9e7abd229d8` passed exact-head CI run `37615572619` (run #1804), including Linux sharp, the configured Playwright browser suite, Prisma/backend/integration/Attendance/physical-acceptance/read-only enforcement, frontend suite, TypeScript, build, bundle and hygiene gates, plus `Verify integration PR Preview health, readiness, and CORS`: `PREVIEW_HEALTH=PASS`, `PREVIEW_READY_DATABASE=PASS`, `PREVIEW_TRUSTED_CORS=PASS`, `PREVIEW_UNTRUSTED_CORS=PASS`. Vercel marked the exact source READY in project `sms-v3-staging` at https://sms-v3-staging-git-codex-t12-settings-ia-20261007-godzillazz.vercel.app (dashboard record `4cGRmEf6RD3XcNVomKe3Foxjujy8`). Settings has nine Thai nested sections under `/app/settings/<section>`, mounts only the selected section, preserves query state and ADMIN-only authorization, and uses section-specific document titles. Registry values and ranges/options are visible in Thai, raw keys/authority are inside collapsed technical details, and known attendance/leave defaults are rendered as readable values. Settings-only markup and styles are route-lazy to preserve the production bundle budget. Existing unlabelled personnel master fields and notification toggles now have accessible names; existing settings API/configuration semantics are unchanged. Local verification: focused source contracts 76/76; frontend full suite 150 files / 905 tests; TypeScript/build passed; bundle verifier passed (main JS 391,690 bytes / 400,000; CSS 699,173 / 700,000); `git diff --check` passed. Playwright Chromium fixture passed desktop 1366×768 and mobile 375×812 (2/2), visiting all nine sections and checking selected-section-only mounting, titles, query preservation, values/ranges, collapsed keys, labelled controls, no overflow/page errors, and no API writes. All data was fixture-only. No Production deployment, business-data mutation, schema/migration, environment/secret, RBAC, or policy changes occurred.

Initial exact-head CI run `37614448199` failed only in the pre-existing T11 desktop Playwright flow: trace/artifact evidence shows the test started typing while `Login` was still rendered as the Suspense fallback; `AwardPublicExperience` then mounted and replaced the form, dropping the email value before submit. Both T11/T12 fixture helpers now wait for the loaded `.nexus-public[data-design="sms-command-nexus-full-bleed"]` marker before filling credentials; this is a deterministic readiness condition, not a sleep. Rerun `37615181038` exposed a legacy source guard still reading `main.tsx` after Settings was extracted to `pages/settings/SettingsPage.tsx`; the guard now follows its current owner module. Final exact-head T12 implementation CI run `37615572619` passed all jobs and Preview runtime checks. Documentation closeout PR #511 then failed only its Preview runtime check in CI run `37616294657` with `fetch failed`: CI constructs the hostname from the unshortened branch ref, while Vercel's READY deployment used a truncated, hash-suffixed alias for the long branch (`...-closeout-6c2fd1-godzillazz.vercel.app`). The CI-derived unshortened hostname returned DNS `ENOTFOUND`; this was an alias-length mismatch before an HTTP response, not application health evidence. Re-running the documentation closeout on a short branch keeps the workflow-derived hostname within Vercel's alias limit.

T13 Leave Request Form used branch `codex/t13-leave-request-20261007`, base `2cefe479f093d7e25e8496646456217ca0748bbd`, source `9a943ece5f73d73edbe815b6924aa9e2651d35b3`; PR #513 merged as `956e06a84938230d0bb25bece9b0c1d2396a3a14`. Exact-head CI run `37619281721` (run #1809) passed Linux sharp, backend unit/integration and Attendance/physical-acceptance/read-only gates, the full frontend suite, TypeScript, production build/bundle/hygiene, and Preview health/readiness/database/trusted and untrusted CORS. Vercel marked the exact PR source READY at https://sms-v3-staging-git-codex-t13-leave-request-20261007-godzillazz.vercel.app (project `sms-v3-staging`, dashboard record `3aiN9ZGT7okNUZBf3zk83U22mTmD`). The CI Preview runtime step passed. Local frontend suite passed 151 files / 907 tests; configured Playwright suite passed 15/15 using synthetic intercepted APIs at desktop 1366×768 and mobile 375×812; production bundle verifier and `git diff --check` passed. Local backend DB-backed cases could not run because local PostgreSQL was unavailable; exact-head CI did run and pass isolated PostgreSQL integration suites. Manager roles use an accessible employee search; self-service identity is locked and omitted from the submission payload; displayed quota totals come from existing server authority and over-quota remains advisory. No policy, authorization, schema/migration, dependency, Production data, or Production deployment changed.

T14 Onboarding Checklist used branch `codex/t14-onboarding`, based on integration SHA `6b4f9c345f8a479d69dd28e051e2bc06182427d6`, source `e24613aaaedf346f1aa3bb072ff6dfbba50cc494`; PR #516 merged as `164ca55536f73f680b4242b2f11b6b37493e4f16`. Exact-head CI `37623899459` passed Linux sharp, configured browser regressions, dependency audits, Prisma, backend and PostgreSQL integration, authoritative Attendance and physical-acceptance/read-only checks, frontend 153 files / 913 tests, typecheck/build, bundle/hygiene, and Preview runtime checks: health, database readiness, trusted CORS and untrusted CORS all PASS. Vercel marked the exact source READY in project `sms-v3-staging` at https://sms-v3-staging-git-codex-t14-onboarding-godzillazz.vercel.app (dashboard deployment record `3btNdnvY2fScVCz8Yzj5qDyjbi2d`). Local focused route contracts passed 5/5; configured Playwright passed 17/17 with synthetic GET-only fixtures at 1366×768 and 375×812; bundle verifier passed (main 397,174 / 400,000 bytes; CSS 699,778 / 700,000 bytes), root and frontend npm audits found 0 vulnerabilities, and `git diff --check` passed. The checklist reads individual server readiness checks plus existing leave-quota authority; a read-only employee filter was added to the protected license list query. The legacy readiness aggregate/photo blocker is not presented as an Attendance gate. Employee time-clock remediation was audited: account/schedule blockers direct employees to support text, device registration/status remains self-service, and supervisor navigation is provided only to ADMIN/MANAGER/SUPERVISOR. No schema/migration, dependency, RBAC, Attendance policy, Production data, or Production deployment changed. Local DB-backed root tests could not run because PostgreSQL was unavailable; authoritative CI PostgreSQL suites passed.

T16 added shared Thai/Bangkok/Buddhist-year date, month, and date-time formatting while keeping API/storage ISO/Gregorian. Date-only values preserve their calendar day. Verification: focused tests 19/19; frontend suite 149 files / 900 tests; TypeScript/build and `git diff --check` passed; exact-head CI included health/readiness/database/CORS checks. Authenticated Production pages were not accessed. No Production action occurred.

T08 current-source audit found no server-authoritative immutable schedule revision diff or previous-approved-revision detail API. Client-side derivation would violate the approval authority contract, so T08 remains blocked pending an Owner/API decision; memo PR #500 records the evidence. Independent tasks continue.

**Next task:** T17 Accessibility, from fresh integration HEAD `9e533b2501bdc7ac1e63c98e09783f563b407479`. Remaining sequence: T17 → T19 → T18/T24 verify-first → T20 → G06.1 Phase 0 architecture/threat model only. T08 remains blocked pending the Owner/API decision recorded above. Production status in this remediation is unchanged; the last recorded Production state in the historical handoff below is R2 source `2d9a21c9c8d940fbd5c3c8c9dadceae073f0a9ea`, deployment `dpl_FbXBhBdjcNLvYEpN9sXs3EV6VEuh`. This is the last recorded reference, not a fresh live Production verification.
---

## Historical task record — T29 Printing / A4 (7 ตุลาคม 2569)

**สถานะ: MERGED — PR #497 อยู่บน branch `codex/t29-printing-a4-20261007` จาก integration base `fd4c7a1b110bee9a9ee77bc5eb2510cb772ee40b`. Implementation SHA `adbec6c71c7763e43055c9a8937d3a1359ff7a40` ผ่าน exact-head CI run `37590710095` และ Vercel Preview check success/READY. Preview: https://sms-v3-staging-git-codex-t29-printing-a4-20261007-godzillazz.vercel.app; project `sms-v3-staging` (`prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s`), Vercel dashboard deployment `8PFaxFsSSdYdwCPSoBUMC2rz3bkF` (connector ไม่คืน `dpl_` id). Production ไม่ถูก deploy/promote และยังคง R2 ตามด้านล่าง.**

- Current-HEAD audit ยืนยัน root cause: `frontend/src/styles.css` มี global `@page` บังคับ A4 landscape; Leave ใช้ `body.printing-leave` ซ่อน shell และเรียก `window.print()`; generic table และ Audit เรียก `window.print()` จาก application document; Executive/Attendance มี `@page` ของตนเอง; Attendance report จำกัดความสูง 210mm และ `overflow:hidden` จึงอาจตัดแถว/เนื้อหา.
- Implementation: เปลี่ยนงานพิมพ์เป็น isolated iframe ที่ clone เฉพาะ print document; กำหนด `@page A4` ต่อการพิมพ์ครั้งนั้นหลังโหลด stylesheets; ลบ global/report `@page` ที่ชนกัน; Leave เป็น portrait margin 12mm ใช้ leave-type display authority, มีข้อมูลผู้แทน/รายละเอียดและลายเซ็น; generic table/Audit แสดงชื่อรายงาน ตัวกรอง วันเวลา ผู้พิมพ์ และพิมพ์เฉพาะ table โดยไม่รวม shell; roster ใช้ landscape, 31 date columns กว้างรวมตามค่ากำหนด 268mm, shift code 7pt, header repeat และคุม department group; Attendance report ปล่อยความสูงไหลต่อหน้าและ repeat header.
- Local evidence ณ ตอนนี้: focused Vitest 30/30, frontend full suite 880/880, TypeScript check ผ่านด้วย `npx tsc --noEmit` ใน frontend และ `npm --prefix frontend run build`, bundle verification ผ่าน (`FRONTEND_PRODUCTION_BUNDLE=PASS`), `git diff --check` ผ่าน. Playwright/Chromium 151 local fixture 4/4 ผ่าน; config กำหนด Vite working directory แบบ absolute เพื่อให้ CI ที่เรียกจาก root ใช้ fixture ถูกต้อง. PDF ตรวจด้วย `pdfinfo`: Leave 1 หน้า A4 portrait, Roster 1 หน้า A4 landscape, Generic table 5 หน้า A4 landscape, Executive/Attendance fixture 4 หน้า A4 landscape. CI จะอัปโหลดภาพ page-1 และ PDF; fixture ใช้ข้อมูลสังเคราะห์และไม่เรียก API/DB.
- CI browser job ใช้ `@playwright/test` และ `pdf-lib` ที่มีอยู่แล้วใน repo; ไม่มี dependency ใหม่. เครื่อง local ใช้ Node 24.19.0 ขณะที่ package กำหนด Node 22.x; authoritative CI ใช้ Node 22. Exact-head CI run `37590710095` บน implementation SHA `adbec6c71c7763e43055c9a8937d3a1359ff7a40` ผ่านทุกขั้น รวม Linux artifact, browser/PDF tests, backend tests/integration, frontend suite/typecheck/build, dependency audits, Prisma, hygiene และ Preview runtime gate; browser artifact `t29-print-browser-artifacts` id `11467999784`. Run `37589999655` ก่อนหน้า fail-closed ที่ HTTP 302 จาก Deployment Protection; แก้ด้วย bypass header ตาม helper ที่มีอยู่แล้วและจำกัดให้ branch Preview ที่ผ่าน host allowlist.
- Vercel bot ให้สถานะ Ready กับ exact-head status ของ SHA `adbec6c71c7763e43055c9a8937d3a1359ff7a40` ใน project `sms-v3-staging` (`prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s`); Preview alias คือ https://sms-v3-staging-git-codex-t29-printing-a4-20261007-godzillazz.vercel.app และ dashboard deployment id `8PFaxFsSSdYdwCPSoBUMC2rz3bkF`. GitHub-hosted CI step `Verify integration PR Preview health, readiness, and CORS` ใน run `37590710095` รายงาน `PREVIEW_HEALTH=PASS`, `PREVIEW_READY_DATABASE=PASS`, `PREVIEW_TRUSTED_CORS=PASS`, `PREVIEW_UNTRUSTED_CORS=PASS`. Sandbox fetch 403 เป็น proxy limitation และไม่ใช่สัญญาณระบบล่ม. Vercel connector ไม่ได้เปิด native `dpl_` id.
- สาเหตุของ runtime gate: branch Preview ป้องกันด้วย Vercel Deployment Protection; unauthenticated GitHub runner ได้ HTTP 302 ที่ `/api/v1/health` แทน JSON. แก้ gate ให้ใช้ `VERCEL_AUTOMATION_BYPASS_SECRET` ที่มีอยู่แล้ว เฉพาะกับ branch Preview hostname ที่ตรวจ allowlist แล้ว และไม่พิมพ์/แนบ secret ลง log หรือ artifact; หาก secret ไม่มีจะ fail closed. Unit test ล็อก header forwarding และกรณี secret หาย. ไม่ได้แก้ secret หรือ Vercel environment.
- Acceptance ของ implementation ผ่านจาก test/CI/Preview evidence ข้างต้น; PR #497 merge แล้วเป็น `eaa880753efd3476233caf8dce306f27b7eb2e4f`. direct Preview HTTP จาก sandbox ยังถูก proxy ตอบ HTTP 403, แต่ hosted CI ผ่าน runtime checks. ไม่มีการแตะ backend API, schema/migration, RBAC, auth/Attendance/device/GPS policy หรือ Production data; ไม่มี Production deployment/promote.

## Current state — R3 Technical Smoke ผ่าน; เตรียม release-control manifest แล้ว (7 ตุลาคม 2569)

**สถานะ: OPEN — Production ยังคงเป็น R2 (2d9a21c9c8d940fbd5c3c8c9dadceae073f0a9ea) และ rollback reference คือ dpl_FbXBhBdjcNLvYEpN9sXs3EV6VEuh. R3 T25 → T24 → T26 → T27 → T28 และ PR แก้ auth-refresh-lock fallback #495 merge เข้า integration แล้ว. R3 RELEASE_SHA คือ b3e70834977a1b29b367e8a1d3b3cfebac0d74c8; exact-SHA CI 37581186514 ผ่าน. ใช้ Preview https://sms-v3-staging-r01nag9m3-godzillazz.vercel.app / dpl_GhzQTqwXtvN28GUntKXEEtgximw9 (ไม่ใช่ Preview ของ PR head 0ced553f). Technical Smoke 37581750104 ผ่าน. Release-control manifest/test ของ R3 ถูกเตรียมให้ชี้ source, CI, Preview, Smoke และ rollback/canonical ของ R2; เมื่อ PR นี้ merge แล้ว ขั้นถัดไปคือให้ Owner dispatch Deploy Approved Production Manifest V2. ไม่มีการ dispatch Production workflow หรือ promote ในขั้นนี้.**

### Production now — R2

- Production source SHA: `2d9a21c9c8d940fbd5c3c8c9dadceae073f0a9ea`.
- Production workflow: [run 37572338555](https://github.com/godzillazzz/SMS-v3/actions/runs/37572338555), completed successfully. Workflow output ระบุ deployment `dpl_FbXBhBdjcNLvYEpN9sXs3EV6VEuh`, URL `https://sms-v3-staging-e71ppzlg5-godzillazz.vercel.app`; runtime, readiness/database, canonical SHA และ CORS checks ผ่าน.
- เจ้าของระบบยืนยันว่าตรวจหน้าจอหลังล็อกอินของ R2 ผ่านแล้ว.
- **Rollback reference ปัจจุบัน:** R2 deployment `dpl_FbXBhBdjcNLvYEpN9sXs3EV6VEuh`, source `2d9a21c9c8d940fbd5c3c8c9dadceae073f0a9ea`.
- ไม่มีการเขียน/ลบข้อมูลธุรกิจ, เปลี่ยน secret/environment/schema หรือส่งฟอร์มบน Production ระหว่าง R3.

### R2 release evidence

- Application RELEASE_SHA: `2d9a21c9c8d940fbd5c3c8c9dadceae073f0a9ea`; exact-SHA CI run `37570803508` ผ่าน.
- Preview: `https://sms-v3-staging-jqlzeasds-godzillazz.vercel.app`, deployment `dpl_G5oZbZ39TpUPceR5WiahRLxURGgR`.
- Automated Technical Smoke [run 37571365579](https://github.com/godzillazzz/SMS-v3/actions/runs/37571365579) ผ่าน. Release-control PR #486 merge `d868a6003d2e069245a8e166e17ff20211579b64`.

| PR | Head หลัง update | Exact-head CI | Vercel Preview | Merge commit |
|---|---|---|---|---|
| #475 | `9bb5d3a098a671ee6a14631546c03ce420f355af` | `37567238651` success | READY — https://sms-v3-staging-git-fix-ux-t01-loading-state-n-77d77f-godzillazz.vercel.app | `5f1f1f72df019fdffbf24d5fd8c221e70a6c5a2e` |
| #476 | `fdf903408a7d1e5d0658869b7fd7520d85523865` | `37567479738` success | READY — https://sms-v3-staging-git-fix-ux-t02-attendance-page-e7112f-godzillazz.vercel.app | `57e81ee9fab3590164da37a7e40e2b902d3149de` |
| #477 | `442ef0562a2d13d27e51e5279a317b0572795af6` | `37567934048` success | READY — https://sms-v3-staging-git-fix-ux-t03-remove-dev-copy-dfd2f3-godzillazz.vercel.app | `3ae26fc39c2c914c75d26daabe1945c946deafae` |
| #478 | `0b392472f1c56aa785b72e8f161ffd137534fbf9` | `37568236186` success | READY — https://sms-v3-staging-git-fix-ux-t06-login-20261006-godzillazz.vercel.app | `ad0cc766bf2e24d81ee025d19cdb9301b0f32809` |

### R3 PRs

| Task / PR | Head | Exact-head CI | Vercel status / Preview | Merge commit |
|---|---|---|---|---|
| T25 / #488 | `a846541aea13b6e27fb4963be65a5f69acd3ff55` | `37575249077` success | READY — https://sms-v3-staging-git-codex-r3-t25-secure-refres-0a8bee-godzillazz.vercel.app | `47c1628a092e8bc02fbc608500bcf6fc58abd1f5` |
| T24 / #489 | `d420ce2f3977d32e93f6a35e320f86f915635e38` | `37575658761` success | READY — https://sms-v3-staging-git-codex-r3-t24-performance-20261007-godzillazz.vercel.app | `70e807b8982277a0617552229ae6c7d993336be9` |
| T26 / #490 | `86923ed517ad61f6d05eb13e684f6f38e3db5ea5` | `37576069884` success | READY — https://sms-v3-staging-git-codex-r3-t26-approval-labe-a17eee-godzillazz.vercel.app | `c582eabb824b2fabcda734c387c0d4af3be3866d` |
| T27 / #491 | `bad8d3856d1d5018436da2455b513cb18e12d14b` | `37577516049` success | Vercel success — dashboard target only; alias and dpl id unavailable from connector | `463b1650eadde1b55345f2f1ca3244d9bf9ae713` |
| T28 / #492 | `f7c86882b10822e1277f68ec977a092c639b7784` | `37578638934` success | Vercel success — [deployment dashboard](https://vercel.com/godzillazz/sms-v3-staging/5mi7x24MXR4j3ccL4eS4wP823mQ3); alias/dpl id unavailable. Combined status on merge SHA is now success; connector target is a Vercel dashboard, not an alias/dpl record. | `dad05e83ad4fa44affa8175c520b087a5f94b509` |

### R3 — outcomes and unresolved read-only checks

- **T25 security:** source review confirmed refresh attempts could race between browser tabs; #488 adds cross-tab coordination via Web Locks. The follow-up lock-fallback correction changes unavailable `navigator.locks` to call refresh directly and warn once; `api.ts` `refreshAuth()` retains same-tab single-flight. Account-specific `Sermpong UAT` audit was not queryable: the audit endpoint requires ADMIN authorization and no authorized session was available. No evidence of token theft was found in accessible sources; the audit conclusion is UNKNOWN. No session was revoked and no account was suspended.
- **T24 performance:** #489 completed batching for supervisor/daily event-policy and actual-site reads; query-count test reduced policy reads from 72 per 12 assignments to one batch query and site reads from three queries to one. Approval summary polling is 60 seconds and visible-tab only. Focused backend 63/63, frontend 859/859, build and diff-check passed. Still deferred to the next round: readiness/employee-center query work, dashboard aggregation, DB/function region comparison, and before/after Preview timing. Database region and measured Preview timings remain UNKNOWN. Full local backend tests needing PostgreSQL could not complete in this sandbox; exact-head CI passed.
- **T26 labels:** null/blank approval `status` and `change_type` display `ไม่ระบุ`; other unmapped values display `อื่น ๆ`. Production read-only approval query was unavailable, so concrete unknown non-null values remain UNKNOWN; no Production DB rows were queried.
- **T27 queue/device UI:** #491 hides request UUIDs, shows sender and people icon, localizes event/status enums and avoids default device counts while loading. CI passed; local frontend suite 863/863, build and diff-check passed. Authenticated browser inspection was unavailable; jsdom fixture used. Vercel alias and dpl id were not returned.
- **T28 additions (6–10):** #492 removes schedule `AWAITING DATA` readiness/coverage cards; removes visible “ไม้กายสิทธิ์” and `CFG-06` wording; regression-tests the employee-link-specific Thai response for `/attendance/simple/bootstrap` 403; leaves bell/approval badges unset until a valid initial value (and hides zero); removes fake `••••••••••••` masked-token placeholder. Focused T28 regressions 14/14, frontend 871/871, build and diff-check passed. Exact-head CI run `37578638934` succeeded and Vercel status is success for the PR head. Authenticated schedule/settings pages were not opened; no credentials or Production data were used.

- **Next step:** after the R3 release-control PR passes CI and merges, the manifest is ready for Owner to run Deploy Approved Production Manifest V2. Production remains R2 until that separately approved workflow is run.

### R3 release candidate identity and P5 release-control

- RELEASE_SHA: b3e70834977a1b29b367e8a1d3b3cfebac0d74c8; tree SHA 4601da889216edba0b2d4d80b0af77acda65f14c.
- Application PR #495 head 0ced553f6e7dbc3b9047b3fe2a8e64f8f0fd4408 merged as b3e70834977a1b29b367e8a1d3b3cfebac0d74c8; exact-SHA CI [run 37581186514](https://github.com/godzillazzz/SMS-v3/actions/runs/37581186514) succeeded.
- Use exact integration Preview https://sms-v3-staging-r01nag9m3-godzillazz.vercel.app, deployment dpl_GhzQTqwXtvN28GUntKXEEtgximw9; the PR-head Preview for 0ced553f is not the release candidate.
- Automated Technical Smoke [run 37581750104](https://github.com/godzillazzz/SMS-v3/actions/runs/37581750104) completed successfully on GitHub-hosted runner. Its inputs pin URL, source SHA, and expected deployment ID above. Logs show health/readiness and credentialed CORS smoke checks passed; 11 smoke tests passed.
- R2 remains Production and rollback checkpoint: deployment dpl_FbXBhBdjcNLvYEpN9sXs3EV6VEuh, source SHA 2d9a21c9c8d940fbd5c3c8c9dadceae073f0a9ea.
- The R3 release-control PR updates the manifest/test to this exact release SHA, PR #495, CI 37581186514, Preview/deployment, Smoke 37581750104, and R2 canonical/rollback reference. Existing database, environment, secret, auth-policy, CORS, deployment, and rollback policies remain unchanged; batch size remains 500.
- Production workflow has not been dispatched. After release-control PR CI passes and it is merged, the manifest is ready for Owner to run Deploy Approved Production Manifest V2. Authenticated pages were not tested in Technical Smoke; account audit remains UNKNOWN. T24 timing, readiness/dashboard work, and DB/function region comparison remain deferred as recorded above.
- No Production release or rollback has occurred in R3; rollback reference remains the R2 deployment above.

### R2 application PRs

| PR | Head / RELEASE_SHA | Exact-head CI | Merge commit |
|---|---|---|---|
| #475 | `9bb5d3a098a671ee6a14631546c03ce420f355af` | `37567238651` success | `5f1f1f72df019fdffbf24d5fd8c221e70a6c5a2e` |
| #476 | `fdf903408a7d1e5d0658869b7fd7520d85523865` | `37567479738` success | `57e81ee9fab3590164da37a7e40e2b902d3149de` |
| #477 | `442ef0562a2d13d27e51e5279a317b0572795af6` | `37567934048` success | `3ae26fc39c2c914c75d26daabe1945c946deafae` |
| #478 | `0b392472f1c56aa785b72e8f161ffd137534fbf9` | `37568236186` success | `ad0cc766bf2e24d81ee025d19cdb9301b0f32809` |
| #486 release control | source `2d9a21c9c8d940fbd5c3c8c9dadceae073f0a9ea` | exact CI `37570803508`; smoke `37571365579`; release-control merge CI `37571946527` — all success | `d868a6003d2e069245a8e166e17ff20211579b64`; Production run `37572338555`; deployment `dpl_FbXBhBdjcNLvYEpN9sXs3EV6VEuh` |

---

## Historical handoff

The dated sections below record prior phases and are retained as historical context; they do not supersede the current R1B Production and R2 gate status above.
---


อัปเดต 6 ตุลาคม 2569 (เวลาไทย)

## สถานะงาน

- Integration base หลัง Phase B: `fix/serverless-database-reliability` @ `3ed0585567091e88135bdbc3f7087a589c30e7d4`.
- เฟส A: เสร็จ; เฟส B: merge #470 → #471 → #472 → #473 สำเร็จตามลำดับ.
- เฟส C: กำลังทำ T05 บน branch `fix/ux-t05-schedule-approvals-count-20261006` ซึ่งเริ่มจาก base SHA ข้างต้น; ยังไม่มี commit, push หรือ PR ของ T05.
- Vercel ของ merge SHA ล่าสุดในโปรเจกต์ `sms-v3-staging` แสดง deployment completed: https://vercel.com/godzillazz/sms-v3-staging/4XYyB1Quoqw4ivM5P2X41vc8aAU2. ตรวจ URL staging `/api/v1/health` และ `/api/v1/ready` โดยตรงไม่ได้เพราะ proxy ตอบ HTTP 403 CONNECT; จึงยังยืนยัน runtime health/provenance ผ่าน alias ไม่ได้.
- ไม่ได้ deploy Production, promote, แตะ Environment approval หรือเขียนข้อมูลลงฐานข้อมูล staging/Production.

## เฟส A+B — สถานะ PR

| PR | SHA ก่อน rebase → หลัง rebase | CI ของ SHA หลัง rebase | Merge | Preview | Acceptance |
|---|---|---|---|---|---|
| #470 | `26eeee832ea3e9cd0e6b0c171b46cd0680b9ac03` → `26eeee832ea3e9cd0e6b0c171b46cd0680b9ac03` (rebase no-op) | CI run `37457419185` success; Vercel success/Ready | merged `adb94c9135dbac9e0b94e3461869f7a7e8b20c10` | https://sms-v3-staging-git-fix-schedule-approval-stat-155f07-godzillazz.vercel.app | ผ่าน: label `changeType` ครบ 12 ค่าและมี test; ปุ่มไม่อนุมัติ disabled จนเหตุผลหลัง trim ≥5 ตัวอักษรพร้อม test. Frontend 828/828 และ build ผ่าน. |
| #471 | `739bb43590a89dbc696e4973d07bbbf90cc9ae6c` → `667666afc742df80aca1dac13dba666f47e240b4` | CI run `37457947822` success; Vercel success/Ready | merged `da6b44d302abee0ff1dc5575164da03b966ea2ac` | https://sms-v3-staging-git-fix-schedule-department-ro-7ffe45-godzillazz.vercel.app | ผ่าน: group-row CSS ครบธีมสว่าง/มืด/print และ sticky; fixture 1366×768/375×812 ไม่มี page overflow. พนักงาน `AN1,AN2,AN3` คงเป็นค่าเดียวพร้อม test. ไม่มี authenticated roster session จึงทดสอบด้วย fixture. |
| #472 | `06adee290b2fe2be4a359fdab2772a92d574f278` → `923447d7c7da6661463c64c2195dae01ad374cda` | CI run `37458878815` success; Vercel success/Ready | merged `5a0fbe299bedd165a580995dc326b54e946aaaa3` | https://sms-v3-staging-git-fix-schedule-auto-preview-108969-godzillazz.vercel.app | ผ่าน: conflict resolution คงการจัดกลุ่ม/print จาก #471 และ auto-schedule preview; frontend 833/833, focused backend 18/18, build ผ่าน. |
| #473 | `2282dda340bef35ec830a46e53be5f7bd09a3a80` → `d8c8ad0706c5d7feb9b038c6dde8204f622c1235` | CI run `37459833957` success; Vercel success/Ready | merged `3ed0585567091e88135bdbc3f7087a589c30e7d4` | https://sms-v3-staging-git-fix-schedule-batch-save-10-c701ee-godzillazz.vercel.app | ผ่านสำหรับ batch save จาก CI, frontend 835/835, build และ browser fixture ที่ 1366×768/375×812. Browser เข้า Preview จริงไม่ได้จาก proxy. ไม่ได้วัด benchmark 1,000 รายการ; ดู T22. |

## ตรวจ deployment หลัง Phase B

- Vercel project `sms-v3-staging` แสดง deployment ของ merge SHA `3ed0585567091e88135bdbc3f7087a589c30e7d4` ว่า completed ตาม dashboard link ในสถานะงาน.
- การยืนยันว่า staging alias เสิร์ฟ SHA นี้และ `/api/v1/health`, `/api/v1/ready` ทำงานยังไม่สำเร็จ: outbound proxy ปิด CONNECT ด้วย HTTP 403 ก่อนถึง Vercel. สถานะนี้เป็น UNKNOWN ไม่ใช่ PASS.

## T22 benchmark

เลือกข้อ (ข): งด benchmark ในรอบนี้. เกณฑ์ 15 วินาทียังรอวัดจากการใช้งานจริงบน staging. ไม่มีการเขียนหรือลบข้อมูลทดสอบในฐานข้อมูลใด.

## เฟส C — T05 กำลังดำเนินการ

- เพิ่ม `SCHEDULE_APPROVAL` ใน policy matrix ด้วย safe default ADMIN/SUPERVISOR; ถ้าคีย์ policy ทั้งหมดไม่อยู่ ใช้ default ในโค้ด ส่วน partial/invalid settings ยังคง fail-closed. ไม่มี migration หรือ DB write.
- Approval Center summary/list หา max revision ต่อเดือน แล้วนับ/แสดงเฉพาะแถว `PENDING` ที่ตรงกับ revision ล่าสุด; รายการมีชื่อเดือน/ฉบับ, ใช้ `changedAt` และปุ่มเปิดหน้าอนุมัติตารางกะ.
- Local verification: focused backend 26/26, focused frontend 6/6, frontend full suite 835/835, frontend build และ `git diff --check` ผ่าน.
- Full backend `npm test` บน URL เฉพาะ `127.0.0.1:5432/smsv3_test` (port ปิด): 1,319/1,327 ผ่าน; 8 ล้มเหลวในกลุ่ม DB-backed leave/schedule/shift ที่ต้องมี PostgreSQL และ backup script 2 tests ที่เรียก PowerShell (`pwsh` ไม่มีในเครื่อง). CI ของ T05 ยังไม่เริ่ม.
- Browser fixture ใช้ข้อมูล API จำลองแบบ read-only เพราะไม่มี authenticated session; ที่ 1366×768 และ 375×812 ปุ่มเปิดหน้าอนุมัติทำงาน, ไม่มี horizontal overflow/page error/failed request, API requests เป็น GET ทั้งหมด.
- ยังไม่มี commit, push หรือ PR ของ T05. ต้องได้ CI success และ Vercel Preview READY ก่อนเริ่ม T01.

## งานค้าง / ข้อจำกัด

- Runtime health/provenance ของ staging alias ยัง UNKNOWN เพราะ proxy ปิด CONNECT ด้วย HTTP 403 ก่อนถึง Vercel. หากต้องยืนยัน health ผ่าน alias ต้องมี network path ที่เข้าถึง staging ได้.
- T22 ยังไม่มี benchmark จริง; เกณฑ์ 15 วินาทีรอวัดจากการใช้งานจริงบน stagingตามตัวเลือก (ข).
- ไม่มีการตัดสินใจจาก Owner ที่ต้องใช้เพื่อทำ T05 ต่อในขณะนี้. ลำดับ Phase C ที่เหลือ: T01 → T02 → T03 → T06; แต่ละงานต้องได้ CI success และ Preview READY ก่อนเริ่มงานถัดไป.
