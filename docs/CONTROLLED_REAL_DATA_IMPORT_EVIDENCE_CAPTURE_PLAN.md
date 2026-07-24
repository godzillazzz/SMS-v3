# Controlled Real-Data Import Evidence Capture Plan

This document establishes the audit-safe evidence collection standards, allowed/prohibited data fields, retention policies, and reporting formats for controlled real-data import execution.

---

## 1. Evidence Collection & Classification Matrix

| Evidence Category | Allowed Data Fields | Prohibited Data Fields | Reporting Format |
| :--- | :--- | :--- | :--- |
| **Owner Approvals** | Approval status, reference placeholders (`REAL-DATA-OWNER-APPROVAL-REF-PLACEHOLDER`, `PDPA-APPROVAL-REF-PLACEHOLDER`)| Raw signature images, personal emails, phone numbers | Markdown Governance Summary |
| **Import Execution** | `importBatchId`, timestamp, accepted count, quarantined count | Employee PII, names, emails, IDs, raw source rows | Audit-Safe NDJSON Log |
| **Error Quarantine** | Line number, sanitized error category (`INVALID_EMAIL_FORMAT`)| Full raw payload rows, passwords, bank details | Sanitized Error Log |
| **System Diagnostics**| Execution duration, connection status | Database credentials, connection URLs, hostnames | Structured Diagnostic Log |

---

## 2. Retention & Audit Controls
- **Retention Requirement**: Evidence logs retained for policy period (`[EVIDENCE_RETENTION_PERIOD_PLACEHOLDER]`).
- **Audit Compliance**: Zero raw employee records, PII, passwords, connection strings, or screenshots permitted in tracked git documentation.
- **Production Status**: Real employee data import is **IMPORTED UNDER CONTROLLED GATE** (`CONTROLLED-IMPORT-EXECUTION-EVIDENCE-REF-PLACEHOLDER`, Awaiting Gate 5.17A closeout). Production activation remains **NOT ACTIVATED**. Production readiness remains **NOT APPROVED**.
