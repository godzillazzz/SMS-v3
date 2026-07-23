# Owner Decision Log

All decisions default to **NOT APPROVED**. This document serves as the formal log of organizational choices for SMS v3.

---

## Decision Records

### DEC-01: Staging Technical Acceptance
- **Owner Role**: Technical Owner
- **Decision Options**: APPROVE STAGING / REJECT STAGING / REQUEST CHANGES
- **Current Decision**: **ACCEPTED FOR SYNTHETIC-DATA STAGING PILOT CLOSEOUT** (via `INTERNAL-EVIDENCE-REF-PLACEHOLDER`)
- **Required Evidence**: Complete test coverage reports (69 passing tests) and code safety review. Safe Evidence Reference: `INTERNAL-EVIDENCE-REF-PLACEHOLDER`.
- **Restrictions**: Staging remains isolated; no deployment to production. Synthetic staging pilot completed.
- **Due Date Placeholder**: `[DUE_DATE]`
- **Approval Status**: **APPROVED WITH RESTRICTIONS**

### DEC-02: Production-Readiness Acceptance
- **Owner Role**: Application Owner
- **Decision Options**: APPROVE ROADMAP / REJECT ROADMAP
- **Current Decision**: **NOT APPROVED**
- **Required Evidence**: Completed gap register showing clear closure paths for all 18 areas.
- **Restrictions**: Roadmap approval does not constitute release authorization.
- **Due Date Placeholder**: `[DUE_DATE]`
- **Approval Status**: **NOT APPROVED**

### DEC-03: Real Notification Channel Selection
- **Owner Role**: Notification Owner
- **Decision Options**: TELEGRAM CHAT / SMS GATEWAY / SIEM WEBHOOK / ENTERPRISE_CHAT_CATEGORY / NONE (STAY MOCKED)
- **Current Decision**: **ENTERPRISE_CHAT_CATEGORY** (via `INTERNAL-EVIDENCE-REF-PLACEHOLDER`). Staging activation: **PASSED AND ROLLED BACK** (via `INTERNAL-EVIDENCE-REF-PLACEHOLDER`).
- **Required Evidence**: Vendor comparison sheet, cost estimation, SLA terms.
- **Restrictions**: Provider credentials must not be tracked in codebase. Selected category only; channel activation remains NOT APPROVED.
- **Due Date Placeholder**: `[DUE_DATE]`
- **Approval Status**: **APPROVED WITH RESTRICTIONS**

### DEC-04: Alert Threshold Approval
- **Owner Role**: Monitoring Owner
- **Decision Options**: ADOPT PROPOSED THRESHOLDS / DEFINE CUSTOM THRESHOLDS
- **Current Decision**: **ADOPT PROPOSED THRESHOLDS** (via `INTERNAL-EVIDENCE-REF-PLACEHOLDER`)
- **Required Evidence**: Staging log analytics showing normal metric bounds.
- **Restrictions**: Configured alert thresholds must trigger mock alerts only in staging until activation is cleared.
- **Due Date Placeholder**: `[DUE_DATE]`
- **Approval Status**: **APPROVED WITH RESTRICTIONS**

### DEC-05: Backup Host Server Approval
- **Owner Role**: Backup Owner
- **Decision Options**: PHYSICAL WINDOWS SERVER / NAS HOST / CLOUD BUCKET
- **Current Decision**: **NOT APPROVED**
- **Required Evidence**: Host specs checklist and security authorization.
- **Restrictions**: Script templates must target the approved host only.
- **Due Date Placeholder**: `[DUE_DATE]`
- **Approval Status**: **NOT APPROVED**

### DEC-06: Backup Storage Destination Approval
- **Owner Role**: Backup Owner
- **Decision Options**: LOCAL SYSTEM DRIVE / NETWORK NAS SHARE / OFFSITE TAPE
- **Current Decision**: **NOT APPROVED**
- **Required Evidence**: NAS access permissions control sheet and path mapping.
- **Restrictions**: Storage destination must exclude public cloud shares.
- **Due Date Placeholder**: `[DUE_DATE]`
- **Approval Status**: **NOT APPROVED**

### DEC-07: Encryption Key Custody
- **Owner Role**: Security Owner
- **Decision Options**: LOCAL KEYRING / HARDWARE SECURITY MODULE / ENCRYPTED VAULT
- **Current Decision**: **NOT APPROVED**
- **Required Evidence**: Secure vault registration receipt and key custodians signature.
- **Restrictions**: Private keys must never be committed to repository.
- **Due Date Placeholder**: `[DUE_DATE]`
- **Approval Status**: **NOT APPROVED**

### DEC-08: Backup Schedule Activation
- **Owner Role**: Backup Owner
- **Decision Options**: DAILY TASK SCHEDULE / WEEKLY TASK SCHEDULE / MANUAL RUNS ONLY
- **Current Decision**: **NOT APPROVED**
- **Required Evidence**: Windows Task Scheduler dry-run execution log.
- **Restrictions**: Backups must not write to network destinations until DEC-06 is approved.
- **Due Date Placeholder**: `[DUE_DATE]`
- **Approval Status**: **NOT APPROVED**

### DEC-09: Restore Rehearsal Schedule
- **Owner Role**: Restore-Test Owner
- **Decision Options**: WEEKLY REHEARSAL / MONTHLY REHEARSAL / NO SCHEDULE
- **Current Decision**: **NOT APPROVED**
- **Required Evidence**: Automated rehearsal script validation reports.
- **Restrictions**: Rehearsal restores must use staging target databases only.
- **Due Date Placeholder**: `[DUE_DATE]`
- **Approval Status**: **NOT APPROVED**

### DEC-10: Real Employee Data Import Approval
- **Owner Role**: Privacy/PDPA Owner
- **Decision Options**: APPROVE DATA MIGRATION / CONTINUE SAMPLE DATA ONLY
- **Current Decision**: **NOT APPROVED**
- **Required Evidence**: PDPA impact assessment report and signed import scripts.
- **Restrictions**: No real employee records may be imported prior to DEC-11.
- **Due Date Placeholder**: `[DUE_DATE]`
- **Approval Status**: **NOT APPROVED**

### DEC-11: Production Go/No-Go Decision
- **Owner Role**: Business Owner
- **Decision Options**: GO / GO WITH RESTRICTIONS / NO-GO
- **Current Decision**: **NOT APPROVED**
- **Required Evidence**: Completed sign-off grids from all 10 roles.
- **Restrictions**: Default status is NO-GO. Production environment deployment remains disabled.
- **Due Date Placeholder**: `[DUE_DATE]`
- **Approval Status**: **NOT APPROVED**
