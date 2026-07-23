# Backup and Restore Runbook

## Overview
This runbook provides step-by-step procedures for manual backup, verification, and restore rehearsals for the SMS v3 application database. 

## 1. Preparing the Host & Tool Validation
Before running any backup or restore operations, ensure that the execution host has the correct client tools installed and configured:
- **PostgreSQL Client Tools**: Verify `pg_dump` and `pg_restore` versions match the database server major version.
  ```powershell
  pg_dump --version
  pg_restore --version
  ```
- **Encryption Tool**: Verify GnuPG (gpg) or OpenSSL is installed.
  ```powershell
  gpg --version
  ```

## 2. Manual Backup Execution
To perform a manual database backup:
1. Define the database connection variables in a temporary, protected command session (do not persist these to disk).
   ```powershell
   $env:PGHOST = "DATABASE_HOST_PLACEHOLDER"
   $env:PGPORT = "5432"
   $env:PGUSER = "DATABASE_USER_PLACEHOLDER"
   $env:PGPASSWORD = "DATABASE_PASSWORD_PLACEHOLDER"
   $env:PGDATABASE = "DATABASE_NAME_PLACEHOLDER"
   ```
2. Generate the logical database dump using pg_dump:
   ```powershell
   pg_dump --format=custom --schema=public --file="[BACKUP_DIR]/smsv3-manual-backup.dump"
   ```
3. Clear the credentials from the session immediately:
   ```powershell
   Remove-Item Env:\PGPASSWORD
   ```

## 3. Checksum Generation & Encryption
1. Generate the SHA-256 checksum file:
   ```powershell
   Get-FileHash -Algorithm SHA256 "[BACKUP_DIR]/smsv3-manual-backup.dump" | Out-File "[BACKUP_DIR]/smsv3-manual-backup.dump.sha256"
   ```
2. Encrypt the database dump using symmetric encryption:
   ```powershell
   gpg --symmetric --cipher-algo AES256 --output "[BACKUP_DIR]/smsv3-manual-backup.dump.enc" "[BACKUP_DIR]/smsv3-manual-backup.dump"
   ```
3. Remove the unencrypted backup dump file:
   ```powershell
   Remove-Item "[BACKUP_DIR]/smsv3-manual-backup.dump"
   ```

## 4. Transfer & Storage
Move the encrypted backup and the checksum file to the approved NAS storage location:
```powershell
Move-Item "[BACKUP_DIR]/smsv3-manual-backup.dump.enc" "[NAS_STORAGE_PATH]/"
Move-Item "[BACKUP_DIR]/smsv3-manual-backup.dump.sha256" "[NAS_STORAGE_PATH]/"
```

## 5. Isolated Restore Rehearsal Procedure
To verify backup integrity, perform a restore rehearsal on a separate, isolated target database:
1. Copy the encrypted backup from NAS storage to a local temporary working directory:
   ```powershell
   Copy-Item "[NAS_STORAGE_PATH]/smsv3-manual-backup.dump.enc" "[TEMP_DIR]/"
   Copy-Item "[NAS_STORAGE_PATH]/smsv3-manual-backup.dump.sha256" "[TEMP_DIR]/"
   ```
2. Decrypt the backup file:
   ```powershell
   gpg --decrypt --output "[TEMP_DIR]/smsv3-rehearsal.dump" "[TEMP_DIR]/smsv3-manual-backup.dump.enc"
   ```
3. Verify the checksum of the decrypted file:
   ```powershell
   $calculated = (Get-FileHash -Algorithm SHA256 "[TEMP_DIR]/smsv3-rehearsal.dump").Hash
   $stored = (Get-Content "[TEMP_DIR]/smsv3-manual-backup.dump.sha256").Split(" ")[0]
   if ($calculated -ne $stored) { throw "Checksum validation failed!" }
   ```
4. Verify custom dump structure:
   ```powershell
   pg_restore --list "[TEMP_DIR]/smsv3-rehearsal.dump"
   ```
5. Restore the schema and data to an isolated disposable database instance:
   ```powershell
   $env:PGDATABASE = "smsv3_rehearsal_db"
   pg_restore --clean --if-exists --dbname="smsv3_rehearsal_db" "[TEMP_DIR]/smsv3-rehearsal.dump"
   ```
6. Clean up temporary files:
   ```powershell
   Remove-Item "[TEMP_DIR]/smsv3-rehearsal.dump"
   Remove-Item "[TEMP_DIR]/smsv3-manual-backup.dump.enc"
   Remove-Item "[TEMP_DIR]/smsv3-manual-backup.dump.sha256"
   ```

## 6. Failure Handling & Cleanup
- **Backup Failure**: Delete any incomplete `.partial` files. Check database host availability and PG client tool paths.
- **Restore Failure**: Terminate database connections to the rehearsal instance, drop the corrupted target database, and verify encryption keys or checksum files for mismatch issues.
- **Rotation**: Expired backups (older than retention limits) must be deleted using automated file system scripts. Do not delete records from any other tables.
