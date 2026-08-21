# SMS self-host foundation

This directory is a reference deployment foundation for the SMS Node.js API
and React/Vite frontend. It does not perform a Production cutover and does
not include G06.2 Attendance client behavior.

## Target architecture

`HTTPS reverse proxy/static server -> Node API -> PostgreSQL 16`

PostgreSQL data is kept in the named `sms_postgres_data` volume. Release
images are replaceable; the database volume, evidence storage, and backups
are separate operational assets. The reference frontend image contains only
the built static assets and Nginx configuration.

Use PostgreSQL 16 with UTF-8 and UTC server/database settings. The existing
initial Prisma migration enables `pgcrypto`, so the private cluster role used
for migrations must be allowed to install or use that extension according to
the Owner's least-privilege policy.

## Build and run boundaries

Build from an exact, clean Git SHA. The API image uses Node.js 22, generates
Prisma client code during the build, runs as the non-root `sms` user, and has
a `/api/v1/health` container health check. No environment file or secret is
copied into the image.

The `migrate` service is in the explicit `migration` Compose profile. Start
it only after a backup and migration review:

```text
docker compose -f deploy/self-host/docker-compose.reference.yml --profile migration run --rm migrate
docker compose -f deploy/self-host/docker-compose.reference.yml up -d postgres api frontend
```

Normal API startup never runs migrations. Never run `docker compose down -v`
against a persistent environment. Replacing an API image must not remove the
PostgreSQL volume.

The Compose file is a reference, not a secret store. Supply values from the
Owner-controlled process environment or an external protected environment
file outside the repository. Do not commit that file.

## Reverse proxy boundary

`nginx.conf` redirects HTTP to HTTPS, serves the SPA with an `index.html`
fallback, forwards `/api/`, `/health`, and `/ready` to the API, applies
request-size and timeout limits, and writes access/error logs. It overwrites
the incoming `X-Forwarded-For` value with the address observed by Nginx at
the trusted edge. The API must set `TRUST_PROXY` only to the private proxy
network or explicit proxy addresses, never `true` or `*`.

The reference uses the fail-closed placeholder hostname
`sms.example.invalid`; replace it with the approved canonical hostname when
rendering the deployment configuration. The reference certificate paths are
`/etc/nginx/tls/fullchain.pem` and `/etc/nginx/tls/privkey.pem`. The Owner
must provide the final hostname and certificate process before using the
configuration.

## Database target guard

Generic private PostgreSQL URLs are classified as direct only when they have
no pooling marker. They are not trusted merely because they are non-Supabase.
The deployment gate still requires `APPROVED_DATABASE_TARGET_FINGERPRINT`.
The fingerprint contains only normalized provider/endpoint/database identity,
not credentials. Generate it on the controlled deployment host and keep the
approved value with the release configuration; never put a connection URL in
Git or logs.

```text
node scripts/ci/verify-deployment-target.js --generate-fingerprint
node scripts/ci/verify-deployment-target.js
```

The normal release gate must compare the current target fingerprint to the
approved target and fail closed on a mismatch.

## Evidence storage

`src/services/evidence-storage.provider.js` defines the future private
evidence contract: `putIfAbsent`, `verify`, `createReadHandle`, `remove`, and
`healthCheck`. It includes checksum conflict semantics and an explicit
unconfigured provider that fails closed. It does not connect to an Owner
storage server and does not change current Supabase License storage. Existing
License storage remains on its current adapter until the Owner supplies a
private storage protocol and a separate migration gate is approved.

## Scheduler

The sample systemd unit calls the existing protected application routes; it
does not duplicate quota or reconciliation logic. The current route mapping
is:

- `GET /api/v1/internal/annual-leave-quota-provisioning`
- `POST /api/v1/internal/license-reconciliation`

Put `SMS_API_ORIGIN` and a path to a root-readable, service-readable
`CRON_SECRET` file in `/etc/sms/scheduler.env`. Do not put the secret itself
in the unit file or repository. Enable one timer per job after confirming the
Owner timezone and schedule.

## Backups and restore

The existing `scripts/backup.js` and `scripts/backup-docker.js` create
checksummed PostgreSQL custom-format dumps without logging connection values.
`scripts/verify-backup.js` restores only into a random disposable localhost
database and removes that database afterward. These scripts are reusable for
self-host operations, but this gate does not claim Production backup readiness
until an Owner destination, encryption/key custody, retention, RPO, RTO, and
successful restore evidence are supplied.

Evidence files require a separate private-storage backup policy. PostgreSQL
backups alone do not prove evidence recoverability.

## Domain and WebAuthn gate

The canonical HTTPS origin must be decided before G06.2 browser-local queues,
Service Worker, or WebAuthn cutover work. If the origin changes, review
`WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, `CORS_ORIGIN`, cookie settings, passkey
continuity, and any existing browser-local Attendance state together. This
foundation makes no Production WebAuthn or DNS change.

## Release and rollback model

An Owner-approved release should record a release ID, exact Git SHA/tree,
image digest, migration set, deploy time, deployer, and previous release.
Build and source identity checks happen before startup. Migrations are a
separate reviewed step. Start the candidate beside the previous release,
verify health/readiness and logs, switch traffic at the reverse proxy, and
retain the previous image for rollback. Rollback changes application traffic
only; it does not delete persistent volumes or reverse irreversible database
migrations.

## Current gate state

This foundation remains blocked for real cutover by Owner infrastructure
inputs listed in `OWNER_INPUTS.md`, especially the canonical domain/TLS and
private PostgreSQL/evidence-storage identities. No Production resource was
changed by this work.
