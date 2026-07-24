# Controlled Real-Data Import Rollback Decision Plan

This document defines the emergency stop criteria, transaction rollback triggers, quarantine procedures, and recovery protocols for future controlled real-data import execution.

---

## 1. Rollback Trigger Matrix & Abort Protocols

| Abort Trigger Category | Trigger Condition | Automated / Manual Action | Responsible Rollback Owner Placeholder |
| :--- | :--- | :--- | :--- |
| **High Rejection Rate** | Rejection rate exceeds 2.0% threshold | Abort transaction & revert database | `IMPORT-ROLLBACK-OWNER-PLACEHOLDER` |
| **Constraint Violation** | Unhandled unique index or schema error | Roll back active database transaction | `IMPORT-ROLLBACK-OWNER-PLACEHOLDER` |
| **Database Performance**| Table locking > 5 seconds or high latency | Terminate import service process | `IMPORT-ROLLBACK-OWNER-PLACEHOLDER` |
| **Privacy Violation** | Missing privacy consent or unredacted PII | Restore pre-import snapshot baseline | `IMPORT-ROLLBACK-OWNER-PLACEHOLDER` |

---

## 2. Emergency Recovery & Escalation
- **Post-Import Rollback Evaluation**: Evaluated after Gate 5.17 execution — rollback was **NOT REQUIRED** (`IMPORT-ROLLBACK-OWNER-PLACEHOLDER`).
- **Escalation Protocol**: Immediate incident notification sent to Rollback Commander (`IMPORT-ROLLBACK-OWNER-PLACEHOLDER`) if trigger breached.
- **Production Status**: Notification delivery remains **DISABLED AFTER ROLLBACK**. Backup automation remains **DISABLED AFTER TEST**. Real employee data import is **IMPORTED UNDER CONTROLLED GATE** (Awaiting Gate 5.17A closeout). Production activation remains **NOT ACTIVATED**.
