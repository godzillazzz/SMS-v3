# CI/CD Production for `sms-v3-staging`

## Architecture

The repository uses three guarded workflows:

- `.github/workflows/ci.yml` runs on the development branch and pull requests. It uses an ephemeral PostgreSQL service named `sms_v3_test` and never receives production secrets.
- `.github/workflows/deploy-production.yml` is manual-only. It validates an exact commit on `fix/serverless-database-reliability`, waits for the `production-sms-v3-staging` environment reviewer, applies Prisma migrations with `DIRECT_URL`, builds a prebuilt Vercel artifact, deploys only `sms-v3-staging`, and runs health checks.
- `.github/workflows/rollback-production.yml` is manual-only and promotes an existing deployment after project and confirmation guards. It never changes database schema or data.

The GitHub Actions migration job is the production migration source of truth. The existing Vercel build wrapper remains fail-closed for direct Vercel builds. The deployment workflow passes `CI_MIGRATION_COMPLETED=true` only after its migration job succeeds, so the prebuilt application build does not run a second migration.

## Fixed Target

- Project: `sms-v3-staging`
- Project ID: `prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s`
- Team/Org ID: `team_nemCExHbZ8EAhSgsvefHPAEz`
- Canonical URL: `https://sms-v3-staging-ten.vercel.app`
- Rollback target: `dpl_2fFBpA923SKdf72unemSkvcyCstw`

The workflows fail if the Vercel project, team, confirmation text, or commit branch does not match. They never target `sms-v3`.

## Required GitHub Environment

Create the protected GitHub Environment:

`production-sms-v3-staging`

Configure at least one required reviewer and restrict deployment access to the approved branch policy. Do not enable automatic production deployment until one manual run completes successfully.

Required environment secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `DATABASE_URL`
- `DIRECT_URL`

Required environment variable:

- `APPROVED_DATABASE_TARGET_FINGERPRINT`

The fingerprint is generated from the approved runtime/migration target pair by `scripts/ci/verify-deployment-target.js`. Store only the resulting hash, never a connection string. The workflow compares the runtime URL and direct URL without printing either value.

## Database URL Policy

`DATABASE_URL` is the pooled/runtime URL. `DIRECT_URL` is the direct PostgreSQL URL used by Prisma migration commands. They must identify the same approved database, but their hosts may differ for a pooler/direct pair.

The target guard rejects malformed URLs, local hosts, Docker hosts, `sms_v3_test`, `sms_v3_dev`, and equivalent test database names. It also rejects a missing or mismatched approved fingerprint.

`DIRECT_URL` is required by `prisma/schema.prisma`. It is never replaced with `DATABASE_URL`; a missing direct URL fails closed before migration.

## CI Checks

CI runs, in order:

1. Install root and frontend dependencies.
2. Validate and generate Prisma client.
3. Apply migrations to the ephemeral `sms_v3_test` service.
4. Verify zero pending test migrations.
5. Run backend, integration, and frontend tests.
6. Run frontend typecheck and build.
7. Run diff, secret-pattern, and generated-file hygiene checks.

CI uses test-only credentials defined inside the ephemeral job service. It does not use Vercel, Supabase, production storage, or production database variables.

## Manual Production Deployment

From GitHub Actions, run **Deploy sms-v3-staging Production** with:

- `commit_sha`: an exact commit already reachable from `origin/fix/serverless-database-reliability`
- `confirm_project_name`: `sms-v3-staging`
- `confirm_environment`: `production`
- `rollback_deployment_id`: the known-good deployment for reporting only

For a linkage investigation, set `diagnostic_only` to `true`. This mode uses the same protected Vercel Environment and exact project guards, captures Vercel CLI output through the sanitizer, and reports only identity/linkage categories. It does not run Prisma, build, deploy, or health jobs. Keep it `false` for a production deployment.

The reviewer approval occurs before the migration job. The migration job runs:

```text
prisma generate
prisma migrate status
prisma migrate deploy
prisma migrate status
```

The application deploy cannot start if the target guard, migration, or post-migration status fails.

## Health Gate

The post-deploy gate checks both the deployment URL and the canonical domain:

- `/`
- `/login`
- `/api/v1/health`
- `/api/v1/ready`
- discovered CSS/JavaScript assets

Readiness must return `status=ready` and `database=ok`. Authenticated Dashboard and License smoke tests remain pending until an approved dedicated non-human test account is available. No production user credentials are embedded in workflows.

## Application Rollback

Run **Rollback sms-v3-staging Production** manually with:

- `deployment_id`: an existing deployment belonging to `sms-v3-staging`
- `confirmation`: `ROLLBACK_SMS_V3_STAGING`

The workflow validates project ownership, promotes the existing deployment, and verifies canonical health. It does not run `migrate down`, delete data, edit `_prisma_migrations`, or revert additive schema changes.

## Troubleshooting

- Missing `DIRECT_URL`: add the approved direct PostgreSQL URL to the protected GitHub Environment. Do not copy it into source, logs, or workflow YAML.
- Fingerprint mismatch: verify the approved database pair with the system owner and update only the protected Environment variable.
- Migration failure: do not deploy the application. Preserve the previous deployment and investigate the sanitized error category.
- Health failure: leave automatic rollback disabled, record the deployment ID, and use the manual rollback workflow after reviewer approval.

## Safe Disable and Rotation

To disable production automation, remove reviewer access or disable the workflow in GitHub Actions; do not delete database migrations. Rotate `VERCEL_TOKEN`, database credentials, and SMTP/storage credentials through their owning systems, then update only the protected GitHub/Vercel environment entries. Never commit replacement values.
