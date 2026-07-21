# Nightly backup plan

`npm run backup` is a controlled utility. It is still **not an operational backup service** until pg_dump, checksum validation, restore verification, scheduling, retention, secure transfer, encryption where required, and alerts are proven in the company environment. See [backup runbook](backup-runbook.md).

Before enabling a company-server schedule:

1. Use a least-privilege PostgreSQL backup account.
2. Run `pg_dump --format=custom` nightly using a least-privilege backup role.
3. Encrypt the compressed dump with an approved encryption key and create a SHA-256 checksum.
4. Transfer the encrypted file and checksum over an authenticated secure channel to the company server.
5. Retain daily backups, weekly backups, and monthly backups according to the approved retention schedule.
6. Restore into an isolated environment on a regular schedule, validate the checksum, and record restore verification.
7. Log job success/failure and notify the responsible owner immediately on failure.

Do not put backup credentials in source code or a GitHub workflow. Configure them in the server's secret manager or environment.
