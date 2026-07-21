# Release and Rollback Runbook

## Scope

This runbook covers the Vercel staging deployment for SMS v3. It does not authorize production use, destructive database rollback, or deployment to a company server.

## Pre-release checklist

1. Confirm the reviewed main branch commit and intended deployment identifier.
2. Confirm root and frontend runtime declarations require Node 22.x and `.nvmrc` contains `22`.
3. Confirm backend tests, frontend tests, Prisma format/validate, production frontend build, and dependency audits pass at the reviewed commit.
4. Confirm the Git worktree contains no unrelated changes and tracked files contain no credentials or generated backup artifacts.
5. Confirm Vercel secrets are configured through protected environment controls and are not exposed as frontend variables.
6. Confirm the deployment uses the approved same origin, explicit credentialed CORS allowlist, and sample data only.
7. Review migration SQL before running the controlled migration command. Do not run migrations during normal API requests.
8. Confirm the known-good deployment identifier and rollback operator are recorded in the approved change record.

## Release verification

1. Verify the Vercel deployment reports Ready and references the reviewed commit.
2. Verify the configured Node runtime is 22.x in deployment evidence.
3. Verify the React application and API are served from the same approved origin.
4. Verify `GET /api/v1/health` and `GET /api/v1/ready`.
5. Verify valid and invalid login, refresh after protected-route reload, logout, and logout-all.
6. Verify refresh and CSRF cookie attributes in browser developer tools without copying cookie values.
7. Verify employee authorization, sample listing, soft-delete filtering, and required audit event categories.
8. Verify browser JSON and production errors contain no refresh token or internal error detail.

## Rollback to a known-good deployment

1. Declare the rollback decision and stop additional deployments or migrations.
2. Identify the last verified known-good Vercel deployment from the approved change record.
3. Promote or redeploy that exact known-good commit using normal Vercel controls. Do not rewrite Git history or force push.
4. Do not attempt a destructive schema downgrade. If the previous application is not compatible with the current schema, stop and obtain database-owner approval for a forward repair.
5. Record the safe deployment identifiers and timestamps; never record secret values or sensitive payloads.
6. Perform the post-rollback verification below before declaring service restored.

## Failed deployment response

1. Keep the current known-good deployment active where possible.
2. Classify the failure as build, runtime, environment configuration, database connectivity, migration, routing, authentication/session, or unknown.
3. Review sanitized Vercel function errors and correlation IDs without copying credentials, tokens, cookies, or employee payloads.
4. Correct the issue on a reviewed branch, rerun required checks, and use a normal commit and deployment flow.
5. If database migration partially completed, stop application retries and obtain database-owner review before any corrective SQL.

## Secret rotation

1. Treat suspected exposure as an incident and identify the affected secret categories without copying their values.
2. Rotate credentials through the owning platform's protected controls in a coordinated order.
3. Update only the approved deployment environment and ignored local environment.
4. Revoke affected refresh sessions and credentials where applicable.
5. Redeploy, verify health/readiness and authentication, and confirm old credentials no longer work using an approved safe procedure.
6. Never place rotated values in source, logs, tickets, reports, or chat.

## Migration cautions

- Run migrations as a controlled deployment step, never on ordinary serverless requests.
- Prefer backward-compatible, additive changes and a staged application rollout.
- Back up and verify restore capability before a migration that could affect retained data.
- Do not delete tables, columns, migration records, audits, or user data as part of rollback.
- Use a forward repair when rollback would be destructive or when the schema is already shared by a newer release.

## Post-rollback verification

- Vercel deployment is Ready and references the intended known-good commit.
- Frontend and API remain on the same approved origin.
- Health and readiness return their expected safe responses.
- Valid login, invalid login, refresh, protected-route reload, logout, and logout-all behave correctly.
- Refresh and CSRF cookie attributes and CSRF enforcement remain correct.
- ADMIN and non-admin authorization remains enforced.
- Sample employee listing excludes soft-deleted records.
- Required audit event categories continue to be created without sensitive metadata.
- Sanitized production errors and explicit CORS allowlisting remain active.
- Incident/change record contains evidence, owner, result, and follow-up actions without sensitive values.
