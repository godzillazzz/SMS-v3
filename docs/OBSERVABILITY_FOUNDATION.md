# Observability Foundation

## Scope and status

This foundation uses application JSON logs, authenticated Vercel build/function logs, application audit records, Supabase database monitoring, and the existing health/readiness endpoints. No new paid monitoring service is connected or approved.

The application is staging-only and sample-data-only. Observability readiness does not grant production approval.

## Current signal sources

| Source | Currently visible | Appropriate use | Important limitation |
| --- | --- | --- | --- |
| Vercel build logs | Runtime version, dependency installation, build steps, build failures | Deployment diagnosis and build evidence | No business/runtime request behavior |
| Vercel function logs | Structured application events and platform request/function outcomes | HTTP status trends, safe error categories, function failures and duration | Retention and alert delivery depend on the approved platform plan |
| Application audit records | Login, failed login, refresh, logout, logout-all and employee mutation events | Security and accountability review | Not a general application log; confidential audit metadata must not be copied to platform logs |
| Supabase monitoring | Database availability, connections, resource usage and query performance | Connection/latency/capacity investigation | Alert availability and retention depend on the approved database plan |
| `GET /api/v1/health` | Lightweight process liveness | Frequent liveness checks | Deliberately does not test the database |
| `GET /api/v1/ready` | Required database dependency availability | Readiness checks and dependency-failure detection | Returns only a sanitized result, not dependency details |

## Structured log record

Every application record is one JSON object. Standard safe fields are:

- `timestamp`
- `level`
- `event`
- `deploymentEnvironment`
- `requestId`
- `route`
- `method`
- `status`
- `durationMs`
- `errorCategory`
- event-specific safe numeric results such as `removedCount`

HTTP records use route templates. They do not use complete request URLs and therefore do not copy query parameters. Request and response bodies and raw headers are excluded by default.

## Redaction and serialization policy

The centralized logger drops complete header/body containers and redacts prohibited key names, including password, credential, token, secret, cookie, CSRF, authorization, database connection, account identity, email, source address and HMAC/hash fields.

String-level protection also redacts connection-string shapes, token-like strings, email-address shapes, address shapes and long hexadecimal hash shapes. Error objects are reduced to a safe error name and category; messages, stack traces and nested driver details are not serialized.

The following must never be added to log calls:

- passwords or authentication/session tokens;
- cookies, CSRF values or authorization headers;
- request/response bodies or raw headers;
- raw account/email or source-address identity;
- employee records;
- database connection components or environment values;
- stored HMAC values;
- platform credentials or deployment-protection material.

Redaction is a final safety boundary, not permission to pass confidential data to the logger.

## Correlation IDs

The application generates a UUID for each request. In Vercel execution, it may accept a safely formatted platform request ID from the trusted platform header. Untrusted client `x-request-id` input is ignored. The selected ID is returned in the `x-request-id` response header and included in safe logs and audit metadata.

## Operational event catalog

| Event | Purpose | Safe fields |
| --- | --- | --- |
| `application_startup` | Confirms validated configuration reached application initialization | environment, configuration status, initialization status |
| `application_config_invalid` | Safely signals startup configuration validation failure | safe validation category, issue count |
| `application_listening` | Confirms the local long-running server bound its configured port | environment, listening status, port |
| `http_request` | Supports status-rate and duration monitoring | request ID, route template, method, status, duration |
| `readiness_check` | Measures successful dependency check duration | request ID, status, duration |
| `readiness_failure` | Signals required dependency unavailability | request ID, status, safe error category |
| `unexpected_http_5xx` | Signals unexpected server error | request ID, status, safe error category |
| `http_5xx` | Signals an operationally classified server response | request ID, status, safe error category |
| `database_operation_failure` | Classifies connection, constraint and input failures | request ID, status, safe error category |
| `database_client_error` | Replaces raw ORM error output with a safe client category | safe error category |
| `database_client_warning` | Replaces raw development ORM warning output with a safe client category | safe warning category |
| `authentication_failure` | Supports failed-login aggregate monitoring | request ID, status, generic failure category |
| `refresh_failure` | Supports refresh-failure aggregate monitoring | request ID, status, safe session category |
| `rate_limit_denied` | Supports HTTP 429 monitoring | request ID, route template, method, status, retry duration |
| `rate_limit_store_unavailable` | Signals fail-closed limiter HTTP 503 | request ID, route template, method, status, store-unavailable category |
| `rate_limit_cleanup_result` | Records explicit expired-row cleanup outcome | status, removed count |
| `rate_limit_cleanup_failure` | Signals explicit cleanup failure | status, safe error category |

Authentication audit behavior remains unchanged and authoritative. Platform events contain only the aggregate operational category and request ID; they do not duplicate confidential audit metadata.

## Coverage and remaining gaps

| Risk | Foundation signal | Remaining gap |
| --- | --- | --- |
| HTTP 5xx | `http_request`, `unexpected_http_5xx`, platform status | Real notification delivery is not configured/tested |
| Database connection/readiness failure | `readiness_failure`, `database_operation_failure`, readiness endpoint, database monitoring | Approved on-call threshold and owner unresolved |
| Excessive 401 | `http_request`, `authentication_failure`, `refresh_failure` | Baseline must be tuned against staging traffic |
| Excessive 429 | `http_request`, `rate_limit_denied` | Baseline and escalation owner unresolved |
| Limiter HTTP 503 | `rate_limit_store_unavailable`, `http_request` | Hosted outage simulation intentionally not performed |
| Login/refresh spikes | Dedicated safe events | No automatic notification delivery configured |
| Function timeout | Vercel function duration/timeout signals | A terminated function may not emit an application event |
| Database latency | readiness duration and database monitoring | Query-level threshold requires operational approval |
| Rate-limit table growth | database row/storage monitoring | Scheduled growth query and owner unresolved |
| Cleanup failure | cleanup result/failure events | Cleanup scheduling and notification unresolved |
| Backup failure | backup script result when manually run | Automated Windows Server/NAS scheduling remains deferred |

## Safe review procedure

1. Use authenticated platform/database access only.
2. Filter by event category, status, time window and request ID.
3. Never export unrestricted logs or complete database rows.
4. Redact screenshots before sharing and verify they contain no credentials, cookies, employee records or connection details.
5. Preserve necessary evidence with access control, a retention decision and an incident reference.
6. Escalate according to `INCIDENT_RESPONSE_RUNBOOK.md` and the ownership placeholders.
