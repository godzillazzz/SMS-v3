# Real-Data Import Rollback and Audit Plan

This document defines the automated transaction rollback procedures, pre-import snapshot checkpoints, audit log schemas, and post-import verification criteria for future real-data import execution.

---

## 1. Rollback & Pre-Import Checkpoint Architecture

| Control Stage | Safeguard Specification | Responsible Role Placeholder | Recovery Protocol |
| :--- | :--- | :--- | :--- |
| **Pre-Import Checkpoint** | Point-in-time database snapshot & active connection freeze | `IMPORT-ROLLBACK-OWNER-PLACEHOLDER` | Capture snapshot baseline prior to import |
| **Batch Error Threshold** | Rejection rate > 2% triggers automatic batch abort | `IMPORT-ROLLBACK-OWNER-PLACEHOLDER` | Roll back active database transaction |
| **Constraint Breach** | Unhandled foreign key or unique index violation | `IMPORT-ROLLBACK-OWNER-PLACEHOLDER` | Revert to pre-import snapshot baseline |
| **Privacy / PDPA Stop** | Missing consent certificate or unredacted PII flag | `IMPORT-ROLLBACK-OWNER-PLACEHOLDER` | Immediate abort & purge transient data |

---

## 2. Audit Trail & Post-Import Verification Standards
- **Audit Logging Schema**: Every import transaction logged in NDJSON format containing `importBatchId`, `lineNumber`, `status` (`ACCEPTED`/`QUARANTINED`), and `errorCode`.
- **Post-Import Verification**: Automated row-count verification and primary key checksum audit against pre-import manifest (`IMPORT-DRY-RUN-EVIDENCE-REF-PLACEHOLDER`).
- **Real Data Status**: Real data import remains **NOT IMPORTED / NOT APPROVED**.
- **Production Status**: Production activation remains **NOT ACTIVATED**.
