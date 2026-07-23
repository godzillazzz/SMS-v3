# Staging Pilot Restrictions

This document establishes the boundaries and constraints governing the SMS v3 Staging Pilot. All participants must adhere strictly to these rules.

---

## 1. Data Restrictions
- **Synthetic Data Only**: All operations, forms, and database entries must utilize synthetic or mock data only.
- **No Real PII**: Real employee names, email addresses, phone numbers, raw identifiers, or database records are strictly prohibited.
- **Evidence Sanitization**: Any logs, test sheets, or screenshots collected as pilot evidence must be fully sanitized.

## 2. Infrastructure & Automation Boundaries
- **No Real Notifications**: The notification channel must remain mocked. No external provider (SMS/Telegram/SIEM) configuration may be activated.
- **No Backup Activation**: Windows Task Scheduler scheduling on production hosts or real NAS servers must remain disabled.
- **No Configuration Changes**: Changing Supabase properties, database credentials, or Vercel environment variables is prohibited without formal change control approval.
- **Secrecy Compliance**: Sharing cookies, JWT secrets, database connection hosts, or screenshots containing configuration variables is strictly prohibited.

## 3. Operational Bounds
- **No Production Decisiveness**: Staging pilot data or performance metrics must not be used to justify production release without formal review.
- **Incident Reporting Path**: Report any configuration leakage or exception immediately to `[INCIDENT_REPORTING_PATH_PLACEHOLDER]`.
- **Stop / Rollback Conditions**: Immediate termination of the pilot is required if:
  - Real employee data is accidentally introduced.
  - An environment variable value is leaked in log streams.
  - A database performance degradation affects cross-app instances.
