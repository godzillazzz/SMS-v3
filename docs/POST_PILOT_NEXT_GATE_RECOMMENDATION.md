# Post-Pilot Next Gate Recommendation

This document outlines the recommended next operational readiness gates following the successful closeout of the synthetic-data staging pilot. No actions described herein may be activated during this milestone.

---

## Next Gate Options

### Option A: Notification Channel Activation
- **Prerequisite Owner Decision**: `DEC-03` (Real notification channel selection).
- **Required Evidence**: Signed channel choice matrix and provider account verification.
- **Security/Privacy Constraints**: Channel credentials must not be committed to Git; logs must redact notification content.
- **Rollback / Stop Condition**: Revert `ALERTING_ENABLED=false` on Vercel environment.
- **Production Blocker Affected**: Blocker 1 (Real Notification Channel) & Blocker 10 (Backup Failure Alerting).

### Option B: Backup Automation Activation
- **Prerequisite Owner Decision**: `DEC-05 / DEC-06` (Backup host and storage approvals).
- **Required Evidence**: Provisioned Windows Server spec sheet and mapped NAS share access logs.
- **Security/Privacy Constraints**: Encryption keys must be held in secure vault; backup dumps must use GnuPG.
- **Rollback / Stop Condition**: Deactivate task schedules in Windows Task Scheduler.
- **Production Blocker Affected**: Blocker 5 (Backup Host), Blocker 6 (Backup Storage), Blocker 7 (Encryption Key Custody), Blocker 8 (Backup Schedule).

### Option C: Real-Data Import Approval
- **Prerequisite Owner Decision**: `DEC-10` (Real employee data import approval).
- **Required Evidence**: Certified PDPA impact assessment report and verified import validation logs.
- **Security/Privacy Constraints**: Data mapping must use encrypted SSL channels; no PII logs.
- **Rollback / Stop Condition**: Purge database tables and restore cold database snapshot.
- **Production Blocker Affected**: Blocker 13 (Real Employee Data Import).

### Option D: Production Go/No-Go Preparation
- **Prerequisite Owner Decision**: Closeout of all preceding options.
- **Required Evidence**: Signed owner sign-off packet with 10 role signatures.
- **Security/Privacy Constraints**: Complete verification matrix; all items default to NOT APPROVED.
- **Rollback / Stop Condition**: Retain staging-only DNS routing.
- **Production Blocker Affected**: Blocker 14 (Production Go/No-Go Decision).
