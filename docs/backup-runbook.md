# Backup prototype runbook

This is a prototype, not a production backup service. It runs outbound from the company server to PostgreSQL/Supabase; no inbound internet connection to the company server is required.

Set private environment variables on the company server: `DATABASE_URL`, `BACKUP_DIRECTORY`, `BACKUP_RETENTION_DAYS`, and, if encryption is required, `BACKUP_ENCRYPT_COMMAND` with `BACKUP_ENCRYPT_ARGS` using `{input}` and `{output}` placeholders. Run `npm run backup -- --dry-run` first. A real run calls `pg_dump --format=custom`, writes a temporary file, optionally encrypts it, atomically moves it to the backup directory, writes a SHA-256 sidecar, and appends JSON to `backup-results.ndjson`.

Verify a backup only with a disposable database and a non-production `VERIFY_ADMIN_DATABASE_URL`:

```text
npm run verify-backup -- path/to/smsv3-YYYYMMDDTHHMMSSZ.dump
```

The verification script creates an isolated database, runs `pg_restore`, checks Prisma migration metadata and basic table row counts, then drops the disposable database. Treat a failed verification as a failed backup.

Windows Task Scheduler example: create a daily task under a restricted service account; set the private environment through an approved secret mechanism; action: `npm.cmd run backup`; enable “stop task if it runs longer than” an approved limit; configure failure notification from the JSON result log.

Linux cron example: `0 2 * * * cd /opt/smsv3 && /usr/bin/npm run backup`. Redirect only standard output/error to a protected operational log; secrets belong in the service account environment, not the crontab.

Do not declare this operational until a real `pg_dump`, checksum validation, encrypted transfer (where required), restore verification, retention cleanup, and failure notification have all been tested.
