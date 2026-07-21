# Backup and restore-verification runbook

The scripts are controlled backup utilities, not an automatically scheduled production backup service. They run outbound from the company server to PostgreSQL/Supabase; no inbound internet connection to the company server is required.

Set private environment variables on the company server: `BACKUP_DATABASE_URL` (or `DATABASE_URL`), `BACKUP_DIRECTORY`, `BACKUP_RETENTION_DAYS`, and, if encryption is required, `BACKUP_ENCRYPT_COMMAND` with `BACKUP_ENCRYPT_ARGS` using `{input}` and `{output}` placeholders. Run `npm run backup -- --dry-run` first. A real run calls `pg_dump --format=custom`, validates the dump with `pg_restore --list`, writes a temporary file, optionally encrypts it, atomically moves it to the backup directory, writes a SHA-256 sidecar, and appends a credential-free result to `backup-results.ndjson`.

Verify a backup only with a disposable database and a localhost-only `VERIFY_ADMIN_DATABASE_URL`:

```text
npm run verify-backup -- path/to/smsv3-YYYYMMDDTHHMMSSZ.dump
```

The verification script validates the SHA-256 sidecar and custom dump format, creates an isolated local database, runs `pg_restore`, checks Prisma migration metadata and core tables, then drops the disposable database. It rejects non-local database hosts. Treat a failed verification or cleanup as a failed backup. Decrypt an encrypted backup through the approved process before running `pg_restore` verification.

Windows Task Scheduler example: create a daily task under a restricted service account; set the private environment through an approved secret mechanism; action: `npm.cmd run backup`; enable “stop task if it runs longer than” an approved limit; configure failure notification from the JSON result log.

Linux cron example: `0 2 * * * cd /opt/smsv3 && /usr/bin/npm run backup`. Redirect only standard output/error to a protected operational log; secrets belong in the service account environment, not the crontab.

Do not declare this operational until a real `pg_dump`, checksum validation, encrypted transfer (where required), restore verification, retention cleanup, and failure notification have all been tested.
