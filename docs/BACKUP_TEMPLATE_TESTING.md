# Backup Template Testing

## Overview
This document describes the automated safety validation harness for the database backup and restore rehearsal PowerShell templates. 

## How the Safety Harness Works
The test suite at `test/backup-template.test.js` validates the behavioral safety of example templates (`backup.example.ps1` and `restore-rehearsal.example.ps1`) without running real database dump or network copy operations.

### Mocks and Boundaries
1. **Command Mocks**: The tests create mock implementations of external command-line utilities (`pg_dump`, `gpg`, `pg_restore`) in a temporary directory and prepends it to the `PATH` environment variable.
   - `pg_dump`: Simulates generation of custom logical dump files by writing dummy text to the `--file` target.
   - `gpg`: Simulates file encryption by writing dummy text to the `--output` target.
   - `pg_restore`: Instantly exits with successful status (exit code 0).
2. **Cmdlet Mocks**: The `Get-FileHash` cmdlet is mocked in the PowerShell execution session to return a static synthetic SHA-256 hash.
3. **Data Mocking**: All tests use placeholder connection strings, synthetic key files, and temporary directories on the local file system.

### Deletion and Cleanup
All temporary directories and files created during testing are strictly deleted under a `finally` block in each test case. No temporary files or test artifacts remain on the local disk.

## Security Constraints
During test suite execution:
- **No live connections**: No network connections are made to the database, Supabase, NAS, or network shares.
- **No scheduling**: No tasks are added or registered on the Windows Task Scheduler.
- **No real dumps**: No real database data or employee records are queried or dumped.

## Remaining Approvals before Real Activation
Real activation of automated backups is blocked and remains **inactive** until:
- Accountable owners (Security, Database, Infrastructure, Backup, and Privacy Owners) sign off the Go/No-Go activation matrix.
- Real NAS credentials, server IPs, and database secrets are configured on the target host's execution environment.
