# Staging Pilot Evidence Checklist

This checklist gathers the required technical verification logs for staging acceptance.

> [!CAUTION]
> Real employee data is strictly prohibited on the staging environment. All tests must be conducted using synthetic sample data only.

---

## Technical Verification Items

- [ ] **1. Login / Logout Flow Continuity**
  - *Evidence Required*: HTTP requests containing secure token issuance, subsequent cookie clearing logs on logout.
  - *Method*: Execute login/logout lifecycle via test suite.

- [ ] **2. Refresh (F5) Continuity**
  - *Evidence Required*: Refresh request logs showing correct rotated token issuance without session termination.
  - *Method*: Run multi-request token rotation tests.

- [ ] **3. RBAC / Access Authorization**
  - *Evidence Required*: Request logs showing successful access for admin/HR roles, and clean HTTP 403 blocks for unauthorized endpoints.
  - *Method*: Run employee lifecycle permission tests.

- [ ] **4. Audit Event Logging**
  - *Evidence Required*: Clean NDJSON logs containing audit records with sanitized identifiers and zero sensitive details.
  - *Method*: Query `audit_logs` database table or read application log files.

- [ ] **5. Rate-Limit Suppression**
  - *Evidence Required*: HTTP 429 status response logs with valid `Retry-After` headers. Hashed identity values match stored counters.
  - *Method*: Simulate rapid requests exceeding limits.

- [ ] **6. Alert Deduplication**
  - *Evidence Required*: Single mock alert event written to log outputs despite multiple telemetry triggers within the cooldown window.
  - *Method*: Simulate telemetry events during active deduplication.

- [ ] **7. Service Health & Readiness**
  - *Evidence Required*: HTTP 200 responses from `/api/v1/health` and `/api/v1/ready`.
  - *Method*: Run HTTP health checks.

- [ ] **8. Backup Template Execution**
  - *Evidence Required*: Node.js test runner reports showing passing statuses for template file checks.
  - *Method*: Run `npm test test/backup-template.test.js`.

- [ ] **9. Incident Runbook Tabletop Exercise**
  - *Evidence Required*: Simulation logs documenting incident response actions for database outage.
  - *Method*: Execute incident dry-run.

- [ ] **10. Log-Safety Audit**
  - *Evidence Required*: Verified log outputs showing redaction of cookies, JWT tokens, IP addresses, database connection strings, and credentials.
  - *Method*: Inspect test log files.
