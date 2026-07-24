# Controlled Real-Data Import Execution Runbook Draft

This document details the planned step-by-step operational workflow for future controlled real-data import execution.

---

## 1. Import Execution Workflow (PLANNED ONLY)

> [!IMPORTANT]
> All steps in this runbook are **PLANNED ONLY**. Zero execution will take place during this gate.

| Step | Operational Procedure | Verification Standard | Execution Status |
| :--- | :--- | :--- | :--- |
| **01** | **Pre-Import Go/No-Go Check** | Confirm 100% Go sign-offs (`CONTROLLED-IMPORT-GO-NO-GO-REF-PLACEHOLDER`)| **EXECUTED** |
| **02** | **Source File Custody Check**| Verify encrypted payload hash (`REAL-DATA-SOURCE-PLACEHOLDER`) | **EXECUTED** |
| **03** | **Target Database Verification**| Verify database schema & connection pool baseline | **EXECUTED** |
| **04** | **Pre-Import Checkpoint** | Capture point-in-time snapshot (`PRE-IMPORT-BACKUP-READINESS-REF-PLACEHOLDER`, `IMPORT-ROLLBACK-OWNER-PLACEHOLDER`) | **EXECUTED** |
| **05** | **Pre-Parse Validation** | Parse payload against field mapping (`IMPORT-MAPPING-PLACEHOLDER`)| **EXECUTED** |
| **06** | **Atomic Batch Execution** | Process sanitized rows via service account (`REAL-DATA-SOURCE-PLACEHOLDER`)| **EXECUTED** |
| **07** | **Quarantine Handling** | Quarantine invalid rows to `import_rejection_audit.log` | **EXECUTED** |
| **08** | **Audit Trail Logging** | Verify NDJSON transaction log stream active | **EXECUTED** |
| **09** | **Post-Import Reconciliation** | Verify record count & key checksum alignment | **EXECUTED** |
| **10** | **Rollback Checkpoint** | Evaluate error threshold (<2%) or trigger snapshot abort | **EXECUTED (NOT REQUIRED)** |
| **11** | **Final Owner Confirmation** | Collect post-import sign-off from Data Owner (`FINAL-PRE-EXECUTION-CONFIRMATION-REF-PLACEHOLDER`) | **EXECUTED (AWAITING 5.17A)** |

---

## 2. Safety Statement
- Gate 5.17 controlled import executed under atomic transaction controls (`CONTROLLED-IMPORT-EXECUTION-EVIDENCE-REF-PLACEHOLDER`).
- Real employee data import is **IMPORTED UNDER CONTROLLED GATE** (Awaiting Gate 5.17A closeout).
- Production activation remains **NOT ACTIVATED**.
