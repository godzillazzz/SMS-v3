# SMS-v3 Debian self-host package (verified current host topology)

Versioned templates only. No remote server, service, database, secret, DNS, TLS, or Cloudflare state is changed by this package.

## Verified topology and ingress decision

Read-only inspection evidence for `192.168.23.94` confirms nginx listens on `0.0.0.0:8080` and `[::]:8080`, Node listens on `*:3000`, PostgreSQL is loopback-only, nginx serves `/var/www/sms`, and `/api/` proxies to `127.0.0.1:3000`. The current public URL is `https://sms.xvela.app`; the origin also answers HTTP without an observed redirect. The current firewall does not restrict `8080` to Cloudflare CIDRs.

No `cloudflared` binary, process, systemd unit, or configuration was found. Therefore Cloudflare proxied-DNS versus an external tunnel remains UNKNOWN. The nginx artifact is a single explicit Variant A for Cloudflare proxied DNS, with the required real-IP directives shown as fail-closed placeholders. It does not pretend that a tunnel exists. Do not enable it until the actual Cloudflare DNS mode and CIDR list are verified.

For proxied DNS Variant A, configure the complete current Cloudflare IPv4 and IPv6 CIDR list:

```nginx
set_real_ip_from <EACH_CLOUDFLARE_CIDR>;
real_ip_header CF-Connecting-IP;
real_ip_recursive off;
```

The host firewall must allow public `8080` only from those Cloudflare CIDRs and deny all other sources. Direct Node `3000` and PostgreSQL `5432` must remain unreachable from the public network. If evidence later proves a loopback tunnel, use `TRUST_PROXY_LOOPBACK=true` only for that loopback peer and a separate approved tunnel artifact; do not mix trust models.

## Deterministic build and release layout

Build from the exact reviewed Git SHA with Node 22.x:

```text
npm ci --ignore-scripts --no-audit --no-fund
npm run prisma:generate
npm --prefix frontend ci --ignore-scripts --no-audit --no-fund
npm --prefix frontend run build
```

The release must contain root `node_modules`, `frontend/dist`, Prisma generated client, source, lockfiles, `package.json`, and the pinned local Prisma CLI. Do not rely on a global Prisma install. `systemd` never runs migrations automatically.

### One-time legacy directory migration

If `/opt/sms-v3/app` is a real directory, do not overwrite it. During a maintenance window, after a backup and checksum inventory:

```text
set -euo pipefail
mkdir -p /opt/sms-v3/releases /opt/sms-v3/shared
old=/opt/sms-v3/app
[ -d "$old" ] && [ ! -L "$old" ] || { echo 'already migrated or invalid'; exit 1; }
legacy="/opt/sms-v3/releases/legacy-$(date -u +%Y%m%dT%H%M%SZ)"
mv -- "$old" "$legacy"
ln -s -- "$legacy" "$old"
readlink -f "$old" | grep -Fx -- "$legacy"
```

This is an operator migration procedure, not executed by CI. Abort if the directory is absent, already a symlink, or the assertion fails.

### Release cutover

Each build is copied to `/opt/sms-v3/releases/<full-git-sha>`. Frontend output is staged from that exact release to `/var/www/sms.<full-git-sha>.next`, then atomically renamed to `/var/www/sms.<full-git-sha>` and linked as `/var/www/sms`. Keep the prior release and webroot for rollback. A cutover rehearsal must run in a scratch filesystem first; it must assert `readlink -f` for both API and frontend targets equals the same full SHA, and must run health/readiness checks only against a running scratch service. No green result may be claimed without those assertions.

## Environment and migration gate

Install the secret-managed file at `/opt/sms-v3/shared/app.env`, owner `root:smsv3`, mode `0640`. Use `deploy/debian/app.env.example` only as a checklist. Production requires real `DATABASE_URL`, `JWT_SECRET` (>=32 random characters), `CORS_ORIGIN=https://sms.xvela.app`, `RATE_LIMIT_STORE=postgres`, and a random `RATE_LIMIT_HASH_SECRET` (>=32 characters). For the loopback PostgreSQL endpoint, use `sslmode=require` only if the local PostgreSQL TLS configuration is actually enabled; otherwise use the reviewed local policy, never an unreviewed downgrade.

After backup and explicit migration review, run only against the intended database:

```text
npm run prisma:deploy
```

Never use `prisma migrate dev` or `prisma migrate reset`. Application rollback does not undo applied schema or business-data changes.

## Cutover, rollback, and rehearsal

Before production cutover, record `readlink -f /opt/sms-v3/app` and `readlink -f /var/www/sms`, expected full SHA, backup ID, and prior release. Atomically switch both symlinks, restart the service, then verify local `/api/v1/health`, `/api/v1/ready`, and static asset HTTP 200. Rollback atomically switches both symlinks to the same prior SHA and repeats all checks. Preserve logs; never retry a failed migration blindly. A rollback rehearsal on a disposable scratch tree is required evidence, but it does not authorize a remote cutover.

## Proxy identity and security

`TRUST_PROXY_LOOPBACK=false` is the safe default. The runtime trusts forwarded identity only when explicitly enabled, only for the first loopback peer, and never for a public peer. This protects per-IP login/passkey buckets and prevents forged forwarded chains. In proxied-DNS mode, nginx must normalize the client address using the verified Cloudflare CIDRs and `CF-Connecting-IP`; the firewall must enforce that nginx receives traffic only from those CIDRs.

Systemd uses `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`, `ProtectHome`, kernel/control-group protection, restricted address families, and explicit writable paths. Nginx headers are defined once at server level to avoid duplicate API headers; hashed assets use immutable caching and HTML/API responses are non-cacheable.

## Backup and restore

Use `npm run backup` with `BACKUP_DATABASE_URL`, restricted directory, retention, encryption, and off-host transfer configured externally. It creates and validates a custom-format dump, writes a SHA-256 sidecar, and removes partial output on failure. Run `npm run verify-backup -- <dump> <sha256>` only with `VERIFY_ADMIN_DATABASE_URL` pointing to a local disposable PostgreSQL endpoint. Never restore or verify against Production.

## Explicit blockers

Cloudflare DNS mode and CIDRs, TLS termination/certificate paths, and the 8080 firewall allowlist require operator verification before Variant A is enabled. No tunnel evidence exists. No deployment, restart, migration, firewall change, DNS/TLS change, or database mutation was performed.
