# Owner inputs required before self-host cutover

Do not paste secrets or database URLs into chat, GitHub, or repository files.
Provide values through the controlled deployment host or secret manager.

## Blocking inputs

- **Canonical domain:** final HTTPS hostname, whether the existing canonical
  hostname is retained, and DNS ownership/termination decision.
- **TLS:** certificate issuer/automation method, certificate paths or secret
  manager binding, renewal and expiry alert destination.
- **Host capacity:** Debian/Ubuntu version, server location, CPU, RAM, disk
  capacity/type, network bandwidth, firewall boundary, and public/private
  topology.
- **Private PostgreSQL:** host/port, database name, TLS requirement, backup
  role, least-privilege application role, and connection-pool policy. Keep
  credentials outside the repository.
- **Approved database identity:** generate the non-secret
  `APPROVED_DATABASE_TARGET_FINGERPRINT` on the controlled host from the exact
  private target. The fingerprint, not a URL, is the release approval value.
- **Private evidence storage:** provider/protocol, endpoint, namespace/bucket
  layout, authentication binding, checksum/read-handle behavior, retention,
  deletion, and backup method. Until supplied, only the provider contract is
  implemented.
- **Backups:** off-host destination, encryption/key custody, retention,
  verification frequency, RPO, and RTO for PostgreSQL and evidence files.
- **Scheduler:** Owner timezone, exact run schedule, secret-file custody,
  retry/alert destination, and whether systemd or another scheduler is used.
- **Observability:** log sink, health/readiness monitor, disk/DB/storage
  alerts, certificate expiry alerts, and time-drift alerts.
- **Capacity targets:** employee count, attendance photos/day, average
  compressed photo size, one-year evidence retention, License storage,
  report growth, database growth, and backup multiplier.

## WebAuthn and browser-origin decision

Before G06.2, decide whether the existing canonical origin remains in use.
If it changes, plan the coordinated values for `WEBAUTHN_RP_ID`,
`WEBAUTHN_ORIGIN`, `CORS_ORIGIN`, `COOKIE_DOMAIN`, and `COOKIE_SECURE`.
Do not change Production WebAuthn settings as part of this foundation.
