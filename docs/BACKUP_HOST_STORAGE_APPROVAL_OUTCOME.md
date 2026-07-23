# Backup Host and Storage Approval Outcome

This document details the owner approvals and evidence references for the future backup infrastructure and policies.

---

## 1. Approval Decisions Matrix

| Parameter / Decision | Owner Role | Required Evidence | Evidence Ref | Decision Status | Restrictions | Blocker Impact | Next Action |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Backup Host Approval** | Backup Owner | Target server architecture specs | `INTERNAL-EVIDENCE-REF-PLACEHOLDER` | APPROVED FOR CONTROLLED STAGING BACKUP ACTIVATION | Valid only for `BACKUP_HOST_PLACEHOLDER` | Blocks staging backup | Proceed to staging config |
| **Storage Destination Approval** | Backup Owner | Target storage spec / folder mapping | `INTERNAL-EVIDENCE-REF-PLACEHOLDER` | APPROVED FOR CONTROLLED STAGING BACKUP ACTIVATION | Valid only for `BACKUP_STORAGE_PLACEHOLDER` | Blocks staging copy | Proceed to staging config |
| **Backup Service Account Approval** | Security Owner | Access directory permissions log | `INTERNAL-EVIDENCE-REF-PLACEHOLDER` | APPROVED FOR CONTROLLED STAGING BACKUP ACTIVATION | Bound to `BACKUP_SERVICE_ACCOUNT_PLACEHOLDER` | Blocks cron task execution | Map account outside Git |
| **Network Access Approval** | Network Owner | Port security policy, ping results | `INTERNAL-EVIDENCE-REF-PLACEHOLDER` | APPROVED FOR CONTROLLED STAGING BACKUP ACTIVATION | Controlled staging routing only | Blocks server connectivity | Apply firewall settings |
| **Least-Privilege Permission Approval** | Database Owner | DB backup role permissions script | `INTERNAL-EVIDENCE-REF-PLACEHOLDER` | APPROVED FOR CONTROLLED STAGING BACKUP ACTIVATION | Read-only db-backup role restriction | Blocks dump command run | Apply script in database |
| **Encryption-Key Custody Approval** | Security Owner | Key generation log and vault policy | `INTERNAL-EVIDENCE-REF-PLACEHOLDER` | APPROVED FOR CONTROLLED STAGING BACKUP ACTIVATION | Key stored in `ENCRYPTION_KEY_CUSTODY_PLACEHOLDER` | Blocks dump encryption | Register public GPG key |
| **Retention Period Approval** | Compliance Owner | Data retention policy document | `INTERNAL-EVIDENCE-REF-PLACEHOLDER` | APPROVED FOR CONTROLLED STAGING BACKUP ACTIVATION | Bounded retention limit (30 days) | Blocks cleanup cleanup run | Register configuration |
| **Backup Schedule Approval** | Backup Owner | Windows Task Scheduler specs | `INTERNAL-EVIDENCE-REF-PLACEHOLDER` | APPROVED FOR CONTROLLED STAGING BACKUP ACTIVATION | Staging scheduling deactivated post-run | Blocks automatic runs | Configure scheduler template |
| **Restore Rehearsal Target Approval** | Restore-Test Owner | Sandbox database architecture specs | `INTERNAL-EVIDENCE-REF-PLACEHOLDER` | APPROVED FOR CONTROLLED STAGING BACKUP ACTIVATION | Sandbox limited to `RESTORE_REHEARSAL_TARGET_PLACEHOLDER` | Blocks rehearsal run | Configure restore target |
| **Restore Rehearsal Frequency Approval** | Restore-Test Owner | Rehearsal frequency policy document | `INTERNAL-EVIDENCE-REF-PLACEHOLDER` | APPROVED FOR CONTROLLED STAGING BACKUP ACTIVATION | Run limits: weekly sandbox checks | Blocks restore verification | Register schedule |
| **Backup Failure Notification Approval**| Monitoring Owner | Alert policy and log router configs | `INTERNAL-EVIDENCE-REF-PLACEHOLDER` | APPROVED FOR CONTROLLED STAGING BACKUP ACTIVATION | Alerting de-activated after test | Blocks failure alerts | Configure alert triggers |
| **Evidence Retention Approval** | Auditor Role | Audit logs retention schedule | `INTERNAL-EVIDENCE-REF-PLACEHOLDER` | APPROVED FOR CONTROLLED STAGING BACKUP ACTIVATION | Retain audit logs for 1 year | Blocks compliance reviews | Apply log policy |
| **Deletion and Retention Cleanup Approval** | Compliance Owner | Retention script verification logs | `INTERNAL-EVIDENCE-REF-PLACEHOLDER` | APPROVED FOR CONTROLLED STAGING BACKUP ACTIVATION | Deletion target restricted to backup directory | Blocks file pruning | Apply cleanup script |
| **Emergency Disable Owner Approval** | Technical Owner | Emergency disable runbook sign-off | `INTERNAL-EVIDENCE-REF-PLACEHOLDER` | APPROVED FOR CONTROLLED STAGING BACKUP ACTIVATION | Immediate task deletion authority | Blocks rollback execution | Sign-off disable path |

---

## 2. Constraints & Security Rules
- **No Git Credentials**: No real credentials, paths, accounts, keys, or destinations are committed to Git.
- **De-activated State**: All scheduler and copying configurations remain deactivated outside staging tests.
- **Production Status**: Production backup activation remains **NOT APPROVED**.
