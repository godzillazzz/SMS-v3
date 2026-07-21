# SMS v3 staging runbook

SMS v3 is a staging system. Only approved sample data may be used. Record the current URL as `https://<approved-staging-domain>`; never place credentials in this document.

## Deployment

1. Review the commit and confirm CI passes on `main`.
2. Run controlled Prisma migrations from an approved trusted environment with `npm run prisma:deploy`; migrations never run during API requests.
3. Deploy the selected `main` commit to the Vercel staging project.
4. Confirm the deployed commit matches the reviewed commit, then execute the health, readiness, and browser-session checks below.

Required server-side environment-variable keys are: `DATABASE_URL`, `DIRECT_URL` (migration environment only), `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_ALGORITHM`, `JWT_ISSUER`, `JWT_AUDIENCE`, `NODE_ENV`, `CORS_ORIGIN`, `REFRESH_TOKEN_EXPIRES_IN`, `AUTH_COOKIE_NAME`, `CSRF_COOKIE_NAME`, `COOKIE_SECURE`, and `COOKIE_SAME_SITE`. The frontend may receive only the non-secret `VITE_API_BASE_URL` when a relative same-origin API path is not used.

## Verification

- Request `/api/v1/health`; expect HTTP 200 and an application status response.
- Request `/api/v1/ready`; expect HTTP 200 only when the database is reachable.
- Sign in with an approved sample account. Confirm the browser receives an HttpOnly refresh cookie scoped to `/api/v1/auth` and a readable CSRF cookie scoped to `/`.
- Confirm refresh, logout, and logout-all send credentials and a CSRF header matching the readable cookie. Never copy cookie or token values into tickets or logs.
- Reload a protected route and confirm session initialization finishes before protected content renders.
- Confirm invalid login uses the same public message and does not disclose account state.

## Rollback

Promote the last verified Vercel deployment or redeploy its reviewed commit. Do not force-push or rewrite `main`. Database migrations require a reviewed forward-fix unless a separately tested, non-destructive rollback has been approved. Re-run health, readiness, and authentication checks after rollback.

## Secret rotation

Use the approved secret manager and rotate one credential class at a time. Update staging environment variables, redeploy, verify readiness, and revoke the old value. Rotating `JWT_SECRET` invalidates current access tokens; rotating database credentials requires coordinated updates to application and migration environments. Never place old or new values in source control, logs, screenshots, or this runbook.

## Backup and restore verification

On the restricted company Windows server or NAS-connected machine, provide `BACKUP_DATABASE_URL`, `BACKUP_DIRECTORY`, and the approved retention/encryption variables through the service-account environment. Run `npm run backup`; the script creates a custom-format logical dump and SHA-256 sidecar under the ignored backup directory. Scheduling, secure transfer, encryption-key custody, and failure notifications must be configured separately.

Restore verification is allowed only against local PostgreSQL. Set `VERIFY_ADMIN_DATABASE_URL` to a local administrative database and run `npm run verify-backup -- <backup-file>`. The verifier checks the checksum and custom format, creates a random disposable database, verifies required restored tables, and deletes the database. Never point restore verification at Supabase or another shared database.

## Incident response

- Application owner: `<name / contact pending>`
- Security contact: `<name / contact pending>`
- Database owner: `<name / contact pending>`
- Infrastructure/Vercel owner: `<name / contact pending>`

For an incident, preserve safe request IDs and timestamps, disable affected staging access when approved, rotate exposed credentials, and notify the listed owners. Do not collect secrets or employee records in incident notes.
