# Backup Failure Alert Controlled Test Plan

This document details the test plan for future controlled staging backup failure alert activation.

---

## 1. Purpose & Operational Boundaries
- **Purpose**: Validate end-to-end failure alert routing, payload sanitization, deduplication, and immediate route disabling without exposing operational secrets or database internals.
- **Environment Scope**: Staging environment only (`sms-v3-staging-ten.vercel.app`).
- **Data Scope**: Sample / Synthetic Data Only (Zero real employee records).

---

## 2. Test Scenarios Matrix

### Eligible Scenarios (Staging Only)
1. **Simulated Backup Command Failure**: Synthetic script exit code 1 (`BACKUP_FAILURE_ALERT_PLACEHOLDER`).
2. **Simulated Checksum Mismatch Failure**: Synthetic checksum comparison failure.
3. **Simulated Storage Copy Failure**: Synthetic target path access denial (`BACKUP_STORAGE_PLACEHOLDER`).
4. **Simulated Scheduler Missed-Run Signal**: Synthetic task delay notification (`BACKUP_SCHEDULER_TASK_PLACEHOLDER`).

### Prohibited Scenarios (Strictly Forbidden)
1. Production backup failure simulation.
2. Real database corruption or destructive operations against live database schemas.
3. Real vault credential invalidation or secret tampering.
4. Destructive storage cleanup or file deletion outside local temp workspace.
5. Real employee data exposure or transmission of actual user identities.

---

## 3. Sanitized Alert Payload Specification

### Approved Alert Template
```text
[ALERT] Environment: STAGING | Service: BACKUP_SERVICE | Case: SIMULATED_FAILURE | Ref: INTERNAL-EVIDENCE-REF-PLACEHOLDER
```

### Allowed Sanitized Payload Fields
- `deploymentEnvironment`: `staging`
- `event`: `backup_failure_alert`
- `severity`: `error`
- `failureCase`: `simulated_command_failure`
- `evidenceRef`: `INTERNAL-EVIDENCE-REF-PLACEHOLDER`

### Prohibited Payload Fields
- Database URL, host, name, username, or connection string.
- Backup filenames, dump paths, NAS share paths, or local file system paths.
- Windows Task Scheduler task names, service account usernames, or hostnames.
- SHA-256 checksum values, GPG key IDs, or raw encryption keys.
- Error stack traces, raw command stdout/stderr, or DB error messages.
- Real employee names, email addresses, phone numbers, or user records.

---

## 4. Execution Controls & Rollback
- **Deduplication / Cooldown**: Cooldown window suppresses repetitive alert transmissions.
- **Rollback / Disable**: Notification route is immediately disabled post-test.
- **Stop Condition**: Immediate abort if any secret, path, or raw error stack trace is detected in alert output.
