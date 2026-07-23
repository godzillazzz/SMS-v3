# Backup Environment Variable Inventory

## Overview
This document inventories the environment variables required for executing backup and restore rehearsal tasks. No values are stored in this inventory.

## Variable Inventory

| Environment Variable Name | Purpose / Description | Security Classification | Lifecycle / Storage Rules |
| :--- | :--- | :--- | :--- |
| **`BACKUP_DATABASE_URL`** | Database connection source URL | **SECRET** | Local-only; read dynamically from host env. Never print, log, or commit. |
| **`BACKUP_DIRECTORY`** | Directory on host where temporary dumps are created | Public Config | Local-only; configured on host. |
| **`BACKUP_ENCRYPTION_KEY_FILE`**| Path to the symmetric key or passphrase file | **SECRET** | Local-only; strict ACLs on host file. Never commit. |
| **`BACKUP_CHECKSUM_ALGORITHM`** | Algorithm used for integrity (defaults to SHA-256) | Public Config | Shared config. |
| **`BACKUP_RETENTION_DAYS`** | Number of days to keep backup dumps before purging | Public Config | Shared config. |
| **`REHEARSAL_DB_NAME`** | Name of the isolated database for restore validation | Public Config | Local-only; target database name. |
| **`BACKUP_NOTIFICATION_MODE`** | Routing policy for alerting (e.g. no-op, chat, email) | Public Config | Shared config. |
| **`BACKUP_LOG_DIRECTORY`** | Destination directory for NDJSON audit logs | Public Config | Local-only; path on host system. |

## Crucial Security Rules
1. **Secrets Security**: `BACKUP_DATABASE_URL` and `BACKUP_ENCRYPTION_KEY_FILE` contain sensitive authentication parameters. They must **never** be echoed, printed, logged, or included in commit diffs.
2. **Commit Policy**: Real `.env` or `.env.local` files containing these variables are ignored via `.gitignore` and must never be committed to source control.
