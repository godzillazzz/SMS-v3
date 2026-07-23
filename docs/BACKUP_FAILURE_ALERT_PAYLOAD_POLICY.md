# Backup Failure Alert Payload Policy

This document defines payload sanitization rules and privacy controls for backup failure alerts.

---

## 1. Payload Sanitization Matrix

| Payload Field | Status | Policy Rule / Redaction Constraint |
| :--- | :--- | :--- |
| `deploymentEnvironment` | **ALLOWED** | Must be set to `staging` or `test`. |
| `alertType` | **ALLOWED** | Sanitized event identifier (e.g. `backup_failure`). |
| `severity` | **ALLOWED** | Fixed enum (`info`, `warn`, `error`, `critical`). |
| `failureCase` | **ALLOWED** | High-level category (e.g. `command_failed`, `checksum_mismatch`). |
| `evidenceRef` | **ALLOWED** | Generic reference placeholder (`INTERNAL-EVIDENCE-REF-PLACEHOLDER`). |
| `rollbackOwner` | **ALLOWED** | Role placeholder only (e.g. `Incident Commander`). |
| `DATABASE_URL` | **PROHIBITED** | Strictly redacted; never present in alert payload. |
| `dbHost` / `dbName` | **PROHIBITED** | Strictly redacted; database host and name prohibited. |
| `backupFilename` | **PROHIBITED** | Strictly redacted; actual backup output names prohibited. |
| `storagePath` / `nasPath` | **PROHIBITED** | Strictly redacted; target storage network paths prohibited. |
| `taskName` | **PROHIBITED** | Strictly redacted; Task Scheduler task names prohibited. |
| `checksumValue` | **PROHIBITED** | Strictly redacted; SHA-256 hashes prohibited. |
| `keyId` / `gpgKey` | **PROHIBITED** | Strictly redacted; encryption key IDs prohibited. |
| `stackTrace` / `rawOutput` | **PROHIBITED** | Strictly redacted; raw command stdout/stderr prohibited. |
| `employeeRecords` / PII | **PROHIBITED** | Strictly redacted; personal employee data prohibited. |

---

## 2. Policy Enforcement & Production Scope
- All outgoing alert payloads pass through central redaction filters (`src/services/logger.js` & `src/services/alertingPolicy.js`).
- Production backup failure alert payloads are **NOT APPROVED**.
- Alert delivery in production remains **DISABLED AFTER ROLLBACK**.
