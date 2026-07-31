# Deployment Environment Matrix

This matrix is derived from the current source code. It records names and requirements only; secret values belong in the deployment platform and must never be committed.

## Backend Runtime

| Variable | Requirement from code | Exposure / phase | Preview | Production | Expected format | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | Optional; defaults to development | Server / runtime | Platform-set | Platform-set | `development`, `test`, or `production` | `src/config/env.js` |
| `VERCEL_ENV` | Optional outside Vercel | Server / runtime | Platform-set | Platform-set | `development`, `preview`, or `production` | `src/config/env.js` |
| `VERCEL` | Optional outside Vercel | Server / runtime | Platform-set | Platform-set | Platform flag | `src/utils/logger.js` |
| `VERCEL_URL` | Optional outside Vercel | Server / runtime | Platform-set | Platform-set | Hostname without credentials | `src/config/env.js` |
| `PORT` | Optional; has default | Server / runtime | Platform-managed | Platform-managed | Integer 1–65535 | `src/config/env.js` |
| `DATABASE_URL` | Required | Secret / runtime | Required; dedicated staging database | Required; dedicated production database | PostgreSQL URL | `src/config/env.js`, `prisma/schema.prisma` |
| `DIRECT_URL` | Required when Prisma loads the schema | Secret / build and operations | Staging direct connection | Production direct connection | PostgreSQL URL | `prisma/schema.prisma` |
| `JWT_SECRET` | Required; minimum 32 characters | Secret / runtime | Required; Preview-specific | Required; Production-specific | High-entropy string | `src/config/env.js` |
| `JWT_EXPIRES_IN` | Optional; has default | Server / runtime | Optional | Optional | Duration such as minutes or hours | `src/config/env.js` |
| `JWT_ALGORITHM` | Optional; fixed default | Server / runtime | Optional | Optional | `HS256` | `src/config/env.js` |
| `JWT_ISSUER` | Optional; has default | Server / runtime | Optional | Optional | Non-empty identifier | `src/config/env.js` |
| `JWT_AUDIENCE` | Optional; has default | Server / runtime | Optional | Optional | Non-empty identifier | `src/config/env.js` |
| `CORS_ORIGIN` | Optional; computed default | Server / runtime | Configure explicit Preview origins | Configure explicit Production origins | Comma-separated origins; no wildcard | `src/config/env.js` |
| `CRON_SECRET` | Required only to authorize cron route | Secret / runtime | Set only if Preview cron is used | Set if Production cron is used | High-entropy string | `src/routes/operations.routes.js` |
| `LOGIN_RATE_LIMIT_WINDOW_MS` | Optional; has default | Server / runtime | Optional | Optional | Integer ≥ 1000 | `src/config/env.js` |
| `LOGIN_RATE_LIMIT_MAX` | Optional; has default | Server / runtime | Optional | Optional | Integer 1–1000 | `src/config/env.js` |
| `RATE_LIMIT_STORE` | Optional; defaults to memory | Server / runtime | Set for deployment topology | Set for deployment topology | `memory` or `postgres` | `src/config/env.js` |
| `RATE_LIMIT_HASH_SECRET` | Required when rate-limit store is PostgreSQL | Secret / runtime | Conditional | Conditional | High-entropy string, minimum 32 characters | `src/config/env.js` |
| `REFRESH_TOKEN_EXPIRES_DAYS` | Optional; has default | Server / runtime | Optional | Optional | Integer 1–90 | `src/config/env.js` |
| `REFRESH_TOKEN_EXPIRES_IN` | Optional override | Server / runtime | Optional | Optional | Whole-day duration | `src/config/env.js` |
| `AUTH_COOKIE_NAME` | Optional; has default | Server / runtime | Optional | Optional | Cookie-safe identifier | `src/config/env.js` |
| `CSRF_COOKIE_NAME` | Optional; has default | Server / runtime | Optional | Optional | Cookie-safe identifier | `src/config/env.js` |
| `COOKIE_SAME_SITE` | Optional; has default | Server / runtime | Optional | Optional | `lax`, `strict`, or `none` | `src/config/env.js` |
| `COOKIE_DOMAIN` | Optional | Server / runtime | Optional | Optional | Domain name | `src/config/env.js` |
| `COOKIE_SECURE` | Optional; forced secure in production mode | Server / runtime | HTTPS setting | HTTPS setting | `true` or `false` | `src/config/env.js` |
| `DISABLE_EMAIL_NOTIFICATIONS` | Optional; notifications run only when explicitly false | Server / runtime | Optional | Explicit operational choice | `true` or `false` | `src/services/notification-email.service.js` |

## OTP And Alerting

| Variable | Requirement from code | Exposure / phase | Preview | Production | Expected format | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `OTP_DELIVERY_PROVIDER` | Optional; defaults to disabled | Server / runtime | Optional | Set when OTP is enabled | `disabled` or `gmail_smtp` | `src/config/env.js` |
| `OTP_HASH_SECRET` | Required for Gmail SMTP OTP | Secret / runtime | Conditional | Conditional | High-entropy string, minimum 32 characters | `src/config/env.js` |
| `OTP_FROM_EMAIL` | Required for Gmail SMTP OTP | Server / runtime | Conditional | Conditional | Email address | `src/config/env.js` |
| `SMTP_HOST` | Required for Gmail SMTP OTP | Server / runtime | Conditional | Conditional | Hostname | `src/config/env.js` |
| `SMTP_PORT` | Required for Gmail SMTP OTP | Server / runtime | Conditional | Conditional | Integer 1–65535 | `src/config/env.js` |
| `SMTP_SECURE` | Optional; has default | Server / runtime | Optional | Optional | `true` or `false` | `src/config/env.js` |
| `SMTP_USERNAME` | Required for Gmail SMTP OTP | Secret / runtime | Conditional | Conditional | Provider username | `src/config/env.js` |
| `SMTP_PASSWORD` | Required for Gmail SMTP OTP | Secret / runtime | Conditional | Conditional | Provider credential | `src/config/env.js` |
| `OTP_CODE_EXPIRES_MINUTES` | Optional; has default | Server / runtime | Optional | Optional | Integer 5–30 | `src/config/env.js` |
| `OTP_MAX_ATTEMPTS` | Optional; has default | Server / runtime | Optional | Optional | Integer 3–10 | `src/config/env.js` |
| `OTP_REQUEST_LIMIT_PER_HOUR` | Optional; has default | Server / runtime | Optional | Optional | Integer 1–20 | `src/config/env.js` |
| `ALERTING_ENABLED` | Optional; defaults to false | Server / runtime | Optional | Optional | `true` or `false` | `src/config/env.js` |
| `ALERTING_PROVIDER` | Required to be supported when alerting is enabled | Server / runtime | Conditional | Conditional | Provider identifier | `src/config/env.js` |
| `ALERTING_API_TOKEN` | Required for enterprise chat provider | Secret / runtime | Conditional | Conditional | Provider token | `src/config/env.js` |
| `ALERTING_DESTINATION_ID` | Required for enterprise chat provider | Secret / runtime | Conditional | Conditional | Provider destination identifier | `src/config/env.js` |
| `ALERTING_TIMEOUT_MS` | Optional | Server / runtime | Optional | Optional | Positive integer | `src/config/env.js` |
| `ALERT_COOLDOWN_SECONDS` | Optional; has default | Server / runtime | Optional | Optional | Integer 1–86400 | `src/config/env.js` |
| `ALERT_DEDUP_STORE` | Optional; defaults to memory | Server / runtime | Set for deployment topology | Set for deployment topology | `memory` or `postgres` | `src/config/env.js` |
| `ALERT_DEDUP_HASH_SECRET` | Required when alert dedup store is PostgreSQL | Secret / runtime | Conditional | Conditional | High-entropy string, minimum 32 characters | `src/config/env.js` |
| `ALERT_DEDUP_RETENTION_SECONDS` | Optional; has default | Server / runtime | Optional | Optional | Integer 300–7776000 | `src/config/env.js` |
| `ALERT_LOGIN_FAILURE_THRESHOLD` | Optional | Server / runtime | Optional | Optional | Positive integer | `src/config/env.js` |
| `ALERT_REFRESH_FAILURE_THRESHOLD` | Optional | Server / runtime | Optional | Optional | Positive integer | `src/config/env.js` |
| `ALERT_HTTP_429_THRESHOLD` | Optional | Server / runtime | Optional | Optional | Positive integer | `src/config/env.js` |
| `ALERT_DATABASE_LATENCY_MS` | Optional | Server / runtime | Optional | Optional | Positive integer | `src/config/env.js` |
| `ALERT_FUNCTION_TIMEOUT_THRESHOLD` | Optional | Server / runtime | Optional | Optional | Positive integer | `src/config/env.js` |

## Frontend

| Variable | Requirement from code | Exposure / phase | Preview | Production | Expected format | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `VITE_API_BASE_URL` | Optional; defaults to `/api/v1` | Public browser value / build | Preview API origin or same-origin path | Production API origin or same-origin path | HTTPS URL or root-relative path; no credentials | `frontend/src/api.ts` |

## Operations And Tests

| Variable | Requirement from code | Exposure / phase | Preview | Production | Expected format | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `RUN_INTEGRATION_TESTS` | Required only to enable integration tests | Server / test | Do not configure | Do not configure | Explicit `true` | `test/integration/schedule-batch-write.integration.test.js` |
| `SEED_ADMIN_EMAIL` | Required for seed operation | Secret / operations | Dedicated test account only | Controlled operation only | Email address | `prisma/seed.js` |
| `SEED_ADMIN_PASSWORD` | Required for seed operation | Secret / operations | Dedicated test account only | Controlled operation only | Credential | `prisma/seed.js` |
| `SEED_ADMIN_NAME` | Optional for seed operation | Server / operations | Optional | Optional | Display name | `prisma/seed.js` |
| `BACKUP_DATABASE_URL` | Required unless `DATABASE_URL` supplies backup target | Secret / operations | Staging target | Approved Production target | PostgreSQL URL | `scripts/backup.js`, `scripts/backup-docker.js` |
| `BACKUP_DIRECTORY` | Optional; has default | Server / operations | Operator-selected | Operator-selected | Filesystem path | `scripts/backup.js`, `scripts/backup-docker.js` |
| `BACKUP_DRY_RUN` | Optional | Server / operations | Recommended before execution | Recommended before execution | `true` or `false` | `scripts/backup.js`, `scripts/backup-docker.js` |
| `BACKUP_RETENTION_DAYS` | Optional; has default | Server / operations | Policy integer | Policy integer | Positive integer | `scripts/backup.js`, `scripts/backup-docker.js` |
| `BACKUP_SCHEMA` | Optional; has default | Server / operations | Staging schema | Production schema | PostgreSQL identifier | `scripts/backup.js`, `scripts/backup-docker.js` |
| `BACKUP_POSTGRES_IMAGE` | Optional; has default | Server / operations | Approved image | Approved image | Container image reference | `scripts/backup-docker.js` |
| `BACKUP_ENCRYPT_COMMAND` | Required only for external encryption | Secret/server / operations | Conditional | Conditional | Approved executable | `scripts/backup.js`, `scripts/backup-docker.js` |
| `BACKUP_ENCRYPT_ARGS` | Optional arguments for encryption command | Secret/server / operations | Conditional | Conditional | Command arguments | `scripts/backup.js`, `scripts/backup-docker.js` |
| `VERIFY_ADMIN_DATABASE_URL` | Required for restore verification | Secret / operations | Local verification only | Never point at Production data | Local PostgreSQL admin URL | `scripts/verify-backup.js` |
| `LEGACY_MIGRATION_ALLOW_WRITE` | Required only for apply mode | Server / operations | Explicit `true` under approval | Production target is blocked by code | `true` | `scripts/migrate-legacy-data.js` |
| `LEGACY_MIGRATION_TARGET_CONFIRMATION` | Required only for apply mode | Server / operations | Must match staging target | Production target is blocked by code | `local` or `staging` | `scripts/migrate-legacy-data.js` |

## Deployment Rules

- Preview and Production use separate database projects or database branches.
- Hosted Vercel environments reject loopback hosts and local test/development database names.
- Local test defaults are available only when `NODE_ENV=test` and Vercel is not Preview or Production.
- Client-visible variables use the `VITE_` prefix and never contain secrets.
- Real environment files are excluded from Git and Vercel uploads; redacted example files remain available.
