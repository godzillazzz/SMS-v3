# Phase 2D — Hosted UAT Alignment & Isolation Recovery

Verified 2026-10-10 06:50 Asia/Bangkok. **PARTIAL / HOSTED_UAT_BLOCKED.** This checkpoint supersedes the overnight requirement for independent PR approval under the Owner-approved Solo-Owner policy. Owner sign-off is not independent review. Historical reports remain unchanged below their new checkpoint notices.

## Effective governance — VERIFIED
Public read-only GitHub REST inspections succeeded despite connector endpoint restrictions:
- main protected=true, SHA `ca9b3d12d67be10297ac98f5668e2cfeab74b4b4`.
- [Ruleset20230372](https://github.com/godzillazzz/SMS-v3/rules/20230372): active, exactly refs/heads/main, PR required, approvals=0, validate required from GitHub Actions integration15368; deletion/non_fast_forward blocked, bypass_actors=[], current user bypass=never.
- [Effective branch rules](https://api.github.com/repos/godzillazzz/SMS-v3/rules/branches/main) independently returned deletion/non_fast_forward/pull_request/required_status_checks. Legacy branch.protection.enabled=false does not negate active ruleset enforcement.
- No governance settings mutated by this task. PR589 reviews remain empty; that is not a missing required approval under the new policy. Security review performed by authoring agent remains explicitly non-independent.

## GitHub Environment comparison — VERIFIED
| Property | Hosted UAT | production-sms-v3-staging |
| --- | --- | --- |
| ID | 23924296870 | 19152678076 |
| Required reviewer | godzillazzz | godzillazzz |
| prevent_self_review | false | false |
| can_admins_bypass | false | false |
| Custom allowed branches | main only (policy62547425) | main, fix/serverless-database-reliability, release/approval-identity-branding-20260928, test/automated-uat-v3-authenticated |
| Scope in this patch | Authenticated UAT V3 only | Unchanged Production release jobs |

Evidence: [Hosted Environment](https://api.github.com/repos/godzillazzz/SMS-v3/environments/Hosted%20UAT), [Hosted branch policies](https://api.github.com/repos/godzillazzz/SMS-v3/environments/Hosted%20UAT/deployment-branch-policies), [Production Environment metadata](https://api.github.com/repos/godzillazzz/SMS-v3/environments/production-sms-v3-staging). These are configuration observations, not a workflow approval event.

The workflow now names literal `Hosted UAT`. Before secrets, the trust guard reads effective rules, requires PR/validate/force-push/deletion protection, verifies Owner reviewer/no admin bypass, and requires exactly the main branch policy (no tags/wildcards). Both checkouts remain exact github.sha; Owner/main-only dispatch, immutable Actions and read-only token scopes remain intact. GitHub enforces the actual pending Environment approval at execution time. The guard fails closed on unreadable metadata.

## Four roles / protected credential metadata — BLOCKED
The existing CLI has no authenticated GitHub session. Managed connector forbids Secrets APIs; unauthenticated Hosted secret-name endpoint401. Existence is UNKNOWN, not absent. No secret values read, guessed, copied or created. Production Secrets APIs were not accessed.

Configure these **only in Hosted UAT** from an authorized non-Production recoverable source:
- UAT_ADMIN_EMAIL, UAT_ADMIN_PASSWORD
- UAT_MANAGER_EMAIL, UAT_MANAGER_PASSWORD
- UAT_SUPERVISOR_EMAIL, UAT_SUPERVISOR_PASSWORD
- UAT_VIEWER_EMAIL, UAT_VIEWER_PASSWORD
- VERCEL_TOKEN (read-only identity verification capability for the intended team/project)
- VERCEL_AUTOMATION_BYPASS_SECRET (authorized Preview protection verification)

No DATABASE_URL, DIRECT_URL, SUPABASE_SERVICE_ROLE_KEY or Production release credentials are needed by this Hosted browser job. GITHUB_TOKEN is the built-in scoped workflow token, not a copied Environment secret. All four users must be synthetic/authorized, active, distinct IDs/sessions and correct roles, with no forced password reset; VIEWER must be attested unlinked for its expected403 contract. Before verified isolation, do not log in using these accounts.

Authorized administrator can list metadata without values:
`gh secret list --repo godzillazzz/SMS-v3 --env 'Hosted UAT' --json name,updatedAt`
This command was not executed successfully here because authentication is unavailable. Provision via the normal GitHub secret destination from the non-Production source; never copy Production credentials or publish values. The workflow fails closed on missing credentials.

## Infrastructure and runtime isolation — BLOCKED
- Existing provider Preview project `ezxanpfagitckpfsnflp`, ACTIVE_HEALTHY/ap-northeast-1, organization `skrvuqrwwnbkprdziekn`, Postgres17.
- Actual provider SQL executed within BEGIN READ ONLY returned database=postgres, transaction_read_only=on. Storage metadata returned private buckets attendance-face-evidence, employee-reference-photos and license-documents-g05-preview. No object contents, users, business rows or Production database were queried.
- Preview project-level approved non-secret fingerprint `fe001305fa0031e9572949cac8544dfc9c8d8aca9e4fc2749f565952e65c282c` matches normalized provider project+database identity. Mutable configuration is not immutable runtime proof.
- Historical Production release comparison from run37940068503 approved fingerprint `87dd67b4630d3e1fbdd639b318681a044a81d7755dfdc8d98c08f6943d5ac1db` differs. This is historical read-only evidence; current Production runtime fingerprint remains unverified.
- Baseline Preview `dpl_87a82hjHEDXtMUr8z6zwazVrjAkz`, READY at b4d08398ce14e8bef91be824f8b57d783331befe, correct ref/project/team. Installed deployment connector does not expose immutable env snapshot. Literal runtime fingerprint cannot be independently retrieved through current capabilities.
- Vercel metadata has separate Preview and Production SUPABASE_URL/SERVICE_ROLE rows, but both are Sensitive, and LICENSE_DOCUMENTS_BUCKET is a shared Preview/Production row. Provider buckets alone do not prove actual runtime bucket/project binding or disjoint access privileges.
- SMTP/OTP_FROM_EMAIL/DISABLE_EMAIL_NOTIFICATIONS metadata is Production-only; no Preview SMTP rows found. Source defaults notifications off and email transports require configuration. Current immutable runtime email-disable/sink configuration, outbound delivery and account classifications remain unverified; absence of mutable rows is not full separation proof.
- No resources created; no provider credentials decrypted; no Hosted login/mutation; target authorized=false/database_isolation_verified=false unchanged.

Next isolation evidence must bind exact Preview app SHA/deployment to actual in-process target, current authorized Production comparison, provider disposable classification, Preview-only storage project/bucket access, and disabled delivery or an isolated email sink. Use protected read-only diagnostics with dedicated Preview credentials after main integration; no new public credential/fingerprint endpoint was added.

## Selective Trusted Main preparation
Integration remains9abc97998f98265605f534de7874607a5f3b5a13; never promote its1036-file delta wholesale and never merge #87 wholesale. Prepare main-based harness-only candidate plus its direct helper/dependency/test closure. Main lacks Playwright dependency, technical-smoke helper, Preview resolver and database identity/guard utility modules. Main login form also lacks the harness-required auth-login-form ID; a minimal ID-only compatibility change is required, not copying the entire application.

Application-coupled role integration test belongs to the current Preview application lineage; evaluate it separately from pure harness fixtures on main. The selected main diff and exact validation must be reviewed against main, not inferred from PR589 CI. No disabled target flags may be enabled by selective integration. Final exact commits, CI runs, Preview identity and any candidate PR are recorded in the latest PR589 checkpoint to avoid self-referencing commit metadata.

## Validation and production boundary
New tests accept approvals=0 while rejecting missing effective PR/validate/deletion/force-push rules, incorrect CI integration identity, missing Owner reviewer, admin bypass, Production environment selection, wildcard/additional branches and tags. Local trust/isolation6PASS and workflow5PASS; actionlint and diff check passed. Full exact-head CI must be rerun after publication; old b4d0839 run37966928944 cannot certify this patch.

Production R5-B remains outside mutation scope: no Production deploy/promote/rollback/alias/env/secret/database/schema/account/data change performed. No MASTER_HANDOFF edit. Hosted24-case UAT is NOT EXECUTED; no Hosted leak-count or acceptance claim.

