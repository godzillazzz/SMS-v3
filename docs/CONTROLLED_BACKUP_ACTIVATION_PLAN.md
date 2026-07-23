# Controlled Backup Activation Plan

This document details the step-by-step plan for the upcoming controlled staging backup activation. **All steps are planned only. No backup scripts are active, and no backup commands are run during this gate.**

---

## Controlled Staging Activation Steps

### Phase 1: Pre-Change & Environment Validation
1. **Pre-change Health Check** `[PLANNED ONLY]`
   - Verify staging health endpoints (`/`, `/api/v1/health`, `/api/v1/ready`) are fully operational.
2. **Confirm Sample/Synthetic Data Only** `[PLANNED ONLY]`
   - Confirm zero real employee names or production database tables exist in the target database.

### Phase 2: Configuration & Credentials
3. **Configure Secrets Outside Git** `[PLANNED ONLY]`
   - Map DB connection string and GnuPG public key outside Git using environment variables.

### Phase 3: Manual Execution & Verification
4. **Run One Manual Controlled Backup** `[PLANNED ONLY]`
   - Trigger manual pg_dump script to generate local raw dump.
5. **Create Checksum** `[PLANNED ONLY]`
   - Calculate SHA-256 hash of the generated raw file.
6. **Encrypt Backup** `[PLANNED ONLY]`
   - Run GPG encryption script using public keyring. Confirm raw dump is safely purged from server storage.
7. **Copy to Approved Placeholder Storage** `[PLANNED ONLY]`
   - Copy encrypted dump to `BACKUP_STORAGE_PLACEHOLDER`.

### Phase 4: Restore Rehearsal & Verification
8. **Run Isolated Restore Rehearsal** `[PLANNED ONLY]`
   - Restore encrypted backup to target `RESTORE_REHEARSAL_TARGET_PLACEHOLDER`.
9. **Verify Integrity** `[PLANNED ONLY]`
   - Confirm schema objects match source and checksum verification passes.
10. **Verify Retention Cleanup Dry-Run** `[PLANNED ONLY]`
    - Execute retention script with dry-run parameters; verify old file pruning works.
11. **Verify Failure Handling** `[PLANNED ONLY]`
    - Simulate network/storage loss; confirm failure alerting triggers correctly.

### Phase 5: Post-Verification Rollback & Closeout
12. **Rollback or Disable Schedule** `[PLANNED ONLY]`
    - Deactivate task schedules and purge staging credentials to restore clean default state.
13. **Collect Sanitized Evidence** `[PLANNED ONLY]`
    - Archive execution logs and sign-off files under reference `INTERNAL-EVIDENCE-REF-PLACEHOLDER`.
