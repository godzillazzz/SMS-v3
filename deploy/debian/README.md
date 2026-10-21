# SMS-v3 Debian self-host package (current host topology)

This is a versioned package for the approved host layout. It does not deploy, restart, migrate, or contact a remote server.

## Verified target assumptions and unknowns

Known from the task: application release root `/opt/sms-v3/app`, release store `/opt/sms-v3/releases`, environment `/opt/sms-v3/shared/app.env`, frontend web root `/var/www/sms`, systemd unit `sms-v3.service`, API `127.0.0.1:3000`, public nginx listener `8080`, and public URL `https://sms.xvela.app`.

Cloudflare mode, whether Cloudflare terminates TLS or passes through to the host, the origin TLS certificate paths, firewall allowlist, and current nginx server block are UNKNOWN until an authorized read-only server inspection. Do not change the `8080` listener or TLS topology based on this template. The nginx example intentionally listens on `8080` only and leaves TLS termination to the existing host/Cloudflare configuration.

## Runtime and deterministic release layout

Build from the exact reviewed Git SHA with Node.js 22.x:

```text
npm ci --ignore-scripts --no-audit --no-fund
npm run prisma:generate
npm --prefix frontend ci --ignore-scripts --no-audit --no-fund
npm --prefix frontend run build
```

The release must contain the root `node_modules`, `frontend/dist`, Prisma generated client, source, lockfiles, and `package.json`. Do not rely on a globally installed Prisma CLI: `npm run prisma:generate` and `npm run prisma:deploy` resolve the pinned local Prisma 6.12.0 binary. `systemd` never runs migrations automatically.

Copy the complete build to `/opt/sms-v3/releases/<full-git-sha>`, make the directory immutable to the service user after validation, then update `/opt/sms-v3/app` atomically to the selected release (a symlink is recommended). Keep at least one previously verified release for rollback. The service and nginx templates use `/opt/sms-v3/app` and `/var/www/sms` respectively.

## Environment and migration gate

Install the secret-managed file as `/opt/sms-v3/shared/app.env` with owner `root:smsv3`, mode `0640`. Do not commit or print it. Use `deploy/debian/app.env.example` only as a variable checklist. Production requires a real `DATABASE_URL`, `JWT_SECRET` (>=32 random characters), `CORS_ORIGIN=https://sms.xvela.app`, and the configured private storage values.

After a backup and explicit migration review, run from the selected release directory against the intended database only:

```text
npm run prisma:deploy
```

This is forward-only `prisma migrate deploy`; never use `prisma migrate dev` or `prisma migrate reset`. If migrations are not approved, do not run this command. Application rollback does not undo an applied schema or business-data change.

## Cutover and rollback

```text
# Operator procedure; review exact SHA and current symlink first.
ln -sfn /opt/sms-v3/releases/<full-git-sha> /opt/sms-v3/app.next
mv -Tf /opt/sms-v3/app.next /opt/sms-v3/app
systemctl restart sms-v3.service
curl --fail --silent --show-error http://127.0.0.1:3000/api/v1/health
curl --fail --silent --show-error http://127.0.0.1:3000/api/v1/ready
```

To roll back, atomically point `/opt/sms-v3/app` to the prior verified release, restart the service, and verify both endpoints. Preserve logs and do not retry a failed migration blindly. Nginx continues serving the deployed frontend from `/var/www/sms`; update that directory atomically from the same release only after the API is ready.

## Health, proxy identity, and security

`/api/v1/health` checks process health. `/api/v1/ready` checks PostgreSQL and must return HTTP 200 before traffic is cut over. `TRUST_PROXY_LOOPBACK=false` is the safe default. Set it to `true` only when nginx is the immediate loopback peer; the application then trusts forwarded identity only from loopback. Direct public Node access must be blocked. This protects per-IP login/passkey rate buckets and audit request identity from forged `X-Forwarded-For` headers.

The systemd unit enables `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`, `ProtectHome`, a restricted address family, and explicit writable paths. Nginx adds security headers and immutable hashed-asset caching while keeping HTML/API responses non-cacheable.

## Backup and restore

Use the repository's `npm run backup` with `BACKUP_DATABASE_URL`, a restricted backup directory, retention, and externally managed encryption/off-host transfer. It creates a custom-format dump, validates it with `pg_restore --list`, writes a SHA-256 sidecar, and removes partial files on failure. Use `npm run verify-backup -- <dump> <sha256>` only with `VERIFY_ADMIN_DATABASE_URL` pointing to a local disposable PostgreSQL endpoint. Never restore or verify against Production.

## Explicit prerequisites/blockers

A real secret file, PostgreSQL role/database, backup destination/encryption, firewall policy, current nginx/Cloudflare TLS mode, certificate paths, DNS, and monitoring are operator prerequisites. No remote server, service, database, secret, DNS, TLS, or Cloudflare state was changed by this package.
