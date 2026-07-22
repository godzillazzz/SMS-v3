# Incident Response Runbook

## Status and safety boundary

This runbook is for staging operational readiness. It does not grant production approval and does not authorize a paid monitoring service.

Logs, exports, tickets, chat messages and screenshots must never contain credentials, tokens, cookie/CSRF values, authorization headers, employee records, raw account/source identities, stored hashes, environment values or database connection details.

## Severity levels

| Level | Definition | Target response | Incident commander |
| --- | --- | --- | --- |
| SEV-1 | Staging unavailable, readiness persistently failing, suspected credential exposure/unauthorized access, or sustained critical 5xx/database failure | Acknowledge within `[SEV1_ACK_MINUTES]`; stabilize immediately | `[INCIDENT_COMMANDER]` |
| SEV-2 | Major authentication/rate-limit/session degradation, repeated limiter 503, material latency or audit anomaly | Acknowledge within `[SEV2_ACK_MINUTES]` | `[INCIDENT_COMMANDER_OR_DELEGATE]` |
| SEV-3 | Limited degradation, isolated deployment/test failure, warning threshold without user-impact confirmation | Review within `[SEV3_REVIEW_HOURS]` | `[TECHNICAL_OWNER]` |
| SEV-4 | Observation, documentation issue or improvement item | Track in normal planning | `[APPLICATION_OWNER]` |

All response targets and owners are placeholders requiring approval.

## Standard response sequence

1. Acknowledge the alert and assign an incident reference, severity and incident commander.
2. Confirm scope using safe health/readiness status, event categories, aggregate counts and request IDs.
3. Preserve relevant evidence with restricted access. Do not export unrestricted logs or row contents.
4. Freeze new deployments and configuration changes when they could worsen the incident.
5. Contain safely without disabling authentication, CSRF, Deployment Protection, secure cookies, fail-closed limiting or audit logging.
6. Diagnose using the scenario procedures below.
7. Recover with the least-invasive reviewed action and verify root, health, readiness and affected regression flows.
8. Communicate through `[APPROVED_INCIDENT_CHANNEL]` using sanitized summaries.
9. Close only after monitoring is stable for `[STABILITY_WINDOW]` and evidence is preserved.
10. Complete a post-incident review with cause, timeline, detection gap, corrective actions, owners and due dates.

## Scenario procedures

### Application unavailable

1. Check root and health through authenticated access.
2. Check latest deployment state and safe function-error categories.
3. If the latest deployment correlates with failure, use the failed-deployment procedure.
4. If health fails across the last known Ready deployment, escalate SEV-1 to `[TECHNICAL_OWNER]`.

### Readiness failing

1. Confirm health remains independent and check repeated `readiness_failure` events.
2. Review safe database availability, connection and latency signals.
3. Do not print or change connection values during diagnosis.
4. Freeze schema/configuration changes and engage `[DATABASE_OWNER]`.
5. Recover only through an approved database/platform action, then verify readiness repeatedly.

### Login failures increasing

1. Compare `authentication_failure`, HTTP 401, HTTP 429 and audit aggregates.
2. Confirm whether an approved test is running.
3. Do not query or publish account identifiers.
4. If malicious activity is suspected, engage `[SECURITY_CONTACT]`; keep generic public responses and rate limits intact.

### Rate-limit HTTP 429 spike

1. Confirm `rate_limit_denied` count and shared-store readiness.
2. Check for an approved load/security test.
3. Do not weaken or bypass limits solely to reduce the alert.
4. Escalate unexplained sustained activity to `[SECURITY_CONTACT]`.

### Rate-limit store HTTP 503

1. Confirm `rate_limit_store_unavailable` and readiness/database signals.
2. Keep fail-closed behavior; do not switch silently to process memory.
3. Check connection capacity and database latency using safe aggregates.
4. Escalate repeated events to `[DATABASE_OWNER]` and `[INCIDENT_COMMANDER]`.

### Database latency or failure

1. Compare readiness duration, connection utilization and query/resource monitoring.
2. Identify recent deployment/migration timing without exposing identifiers.
3. Stop nonessential diagnostic load.
4. Do not reset, drop, truncate or repair migration history automatically.
5. Use only an approved recovery or rollback plan.

### Suspected credential exposure

1. Declare SEV-1 and restrict evidence access.
2. Do not paste the suspected value into tickets, chat or logs.
3. Record only the credential category and affected environment.
4. Engage `[SECURITY_CONTACT]`, `[TECHNICAL_OWNER]` and the relevant platform owner.
5. Rotate/revoke through approved secure controls, redeploy if required and verify dependent flows.
6. Review logs/audit records for misuse using safe aggregates.

### Suspected unauthorized access

1. Declare SEV-1 or SEV-2 based on evidence.
2. Preserve audit records and safe request IDs; restrict access.
3. Do not alter evidence-bearing records during initial triage.
4. Engage `[SECURITY_CONTACT]` and `[PRIVACY_PDPA_CONTACT]`.
5. Follow approved containment and notification decisions.

### Audit-log anomaly

1. Compare expected action counts and transaction behavior.
2. Verify database availability and application deployment timing.
3. Do not export confidential metadata or complete records.
4. Escalate missing, duplicated or unauthorized changes to `[SECURITY_CONTACT]` and `[DATABASE_OWNER]`.

### Failed deployment

1. Stop promotion and inspect redacted build/function error categories.
2. Confirm the previous approved deployment remains Ready.
3. Correct only through a reviewed commit/configuration change.
4. Do not run migrations from build/runtime or force-push history.

### Roll back to last known Ready deployment

1. Confirm the target is the approved staging project and identify the last known Ready deployment through authenticated metadata.
2. Verify database compatibility and whether a forward migration makes application rollback unsafe.
3. Obtain `[ROLLBACK_APPROVER]` approval.
4. Redeploy/alias the reviewed Ready deployment using the approved platform procedure; never disable Deployment Protection.
5. Verify root, health, readiness, login, refresh/session continuity, authorization, rate limiting and audit behavior.
6. Record only safe deployment/commit references and outcomes.

## Evidence preservation

- Preserve UTC timestamps, event categories, safe aggregate counts, request IDs, deployment/commit references and actions taken.
- Restrict evidence to `[INCIDENT_EVIDENCE_LOCATION]` with `[RETENTION_POLICY]` and access logging.
- Redact screenshots before sharing.
- Never preserve credentials or session material in general incident evidence.
- Record the chain of custody for SEV-1 evidence.

## Communication placeholders

- Incident channel: `[APPROVED_INCIDENT_CHANNEL]`
- Status update owner: `[COMMUNICATION_OWNER]`
- Update interval: `[UPDATE_INTERVAL]`
- Management escalation: `[MANAGEMENT_ESCALATION]`
- Security escalation: `[SECURITY_CONTACT]`
- Privacy/PDPA escalation: `[PRIVACY_PDPA_CONTACT]`
- Platform support escalation: `[PLATFORM_SUPPORT_PATH]`

No real personal names, phone numbers or email addresses belong in this document.
