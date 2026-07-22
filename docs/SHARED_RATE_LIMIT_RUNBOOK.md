# Shared Rate Limiter Runbook

## Status and scope

The shared PostgreSQL rate limiter is implemented for staging activation but is not active in hosted staging yet. Its migration must be reviewed and applied through the controlled migration procedure before `RATE_LIMIT_STORE` is changed to `postgres` in Vercel.

The limiter protects `POST /api/v1/auth/login`. Password-reset endpoints do not exist. Refresh is deliberately unchanged in this gate because automatic browser session restoration must remain reliable; refresh abuse controls should be assessed separately with session-aware limits.

Default login policy:

- Fixed window: 15 minutes, configured by `LOGIN_RATE_LIMIT_WINDOW_MS`.
- Maximum: 10 requests per window, configured by `LOGIN_RATE_LIMIT_MAX`.
- Keys: separate `login-ip` and `login-account` buckets.
- Response above the limit: generic HTTP 429 with `Retry-After` and rate-limit headers.

## Architecture

The middleware normalizes the request IP and submitted account identifier. On Vercel it reads the platform-provided `x-vercel-forwarded-for` client-IP header; local execution ignores forwarded headers and uses Express's direct request IP. This keeps the proxy trust boundary explicit. It then derives an HMAC-SHA256 digest using `RATE_LIMIT_HASH_SECRET`. Only the digest, scope, fixed-window timestamp, counter, and timestamps are stored. Raw email addresses and IP addresses are never stored in rate-limit records.

The service abstraction supports:

- `memory`: intended for automated tests and local development. State is process-local.
- `postgres`: required for shared staging enforcement across serverless instances.

The PostgreSQL store uses one atomic `INSERT ... ON CONFLICT ... DO UPDATE` statement for each bucket increment. A unique constraint on scope, key hash, and window start prevents duplicate buckets. The expiry index supports bounded cleanup. The store never falls back silently to memory: an unavailable PostgreSQL limiter returns a generic HTTP 503 and records only a safe request correlation ID.

## Environment keys

Backend-only keys:

- `RATE_LIMIT_STORE`
- `RATE_LIMIT_HASH_SECRET`
- `LOGIN_RATE_LIMIT_WINDOW_MS`
- `LOGIN_RATE_LIMIT_MAX`
- `DATABASE_URL`
- `DIRECT_URL`

`RATE_LIMIT_HASH_SECRET` must be a strong, independent secret of at least 32 characters. It must not reuse the JWT secret, a database password, or another application secret. Store it only in the approved secure backend environment. Never expose it through a `VITE_` variable, frontend build output, report, log, or API response.

## Controlled migration procedure

Do not run migrations from a Vercel build, application startup, serverless function, or request handler.

1. Review `prisma/migrations/202607220001_shared_rate_limit_buckets/migration.sql` and the backup/restore readiness record.
2. Load the approved staging migration connection into the operator's secure local environment without printing it.
3. Run `npx prisma validate`.
4. Run `npx prisma migrate deploy` from the controlled operator environment.
5. Run `npx prisma migrate status` and verify the new migration is applied.
6. Verify the `rate_limit_buckets` table, unique bucket constraint, and expiry index without inspecting application records.
7. Add `RATE_LIMIT_HASH_SECRET` and set `RATE_LIMIT_STORE` to `postgres` in the Vercel staging environment.
8. Redeploy the approved staging commit and confirm the deployment is Ready.
9. Run safe hosted below-limit, exact-limit, above-limit, expiry/reset, and cross-instance checks.
10. Review 429, 503, database latency, and function-error telemetry before closing the gate.

Migration status for this change set: created locally, not applied to Supabase by this gate.

## Activation and rollback

Activation order is migration first, secure environment configuration second, and staging redeployment third. Do not enable the PostgreSQL store while its table or hashing secret is absent.

If staging activation causes unacceptable errors:

1. Stop the hosted verification traffic.
2. Capture only sanitized correlation IDs and error categories.
3. Roll back the application to the last approved staging deployment, or explicitly set the staging store to `memory` only with owner approval while the system remains staging-only.
4. Do not drop the table or migration during an incident.
5. Investigate database availability, permissions, pooler capacity, query latency, and secret presence without exposing their values.
6. Re-enable PostgreSQL only after the failure is understood and the full staging verification passes.

There is no automatic fallback from PostgreSQL to memory.

## Monitoring and failure handling

Monitor:

- Login 429 rate and sustained spikes.
- Limiter 503 responses and safe `rate_limit_store_unavailable` events.
- PostgreSQL query latency and connection errors.
- Vercel function error rate and duration.
- Rate-limit table row growth and expiry-cleanup duration.
- Unexpected differences between login IP and account bucket denial rates.

The public failure response is generic. Server logs must contain no raw account identifier, IP address, request body, authorization header, token, cookie, database connection value, or hashing secret.

## Expired-row cleanup

Normal PostgreSQL increments opportunistically remove expired rows from the exact `rate_limit_buckets` table. The store also exposes an explicit cleanup operation that targets only the Prisma `RateLimitBucket` model. The `expires_at` index supports these deletions.

If operational monitoring shows that opportunistic cleanup is insufficient, schedule a controlled SQL or Prisma cleanup for this table only. Review the exact target and predicate before execution. Never use a broad or dynamically computed table name.

## Privacy notes

Rate-limit rows are pseudonymous security telemetry, not authentication records. Limit access to operators who need it, retain rows only as long as operationally necessary, and avoid joining limiter hashes with employee or user profiles. Changing the hashing secret makes newly generated hashes unlinkable to old buckets; plan such rotation around active windows.

## Ownership placeholders

- Application owner: `[ASSIGN BEFORE STAGING ACTIVATION]`
- Database migration approver: `[ASSIGN BEFORE STAGING ACTIVATION]`
- Security reviewer: `[ASSIGN BEFORE STAGING ACTIVATION]`
- Incident escalation owner: `[ASSIGN BEFORE STAGING ACTIVATION]`
- Monitoring owner: `[ASSIGN BEFORE STAGING ACTIVATION]`
