# Alerting Configuration Runbook

## Safety boundary

The current foundation has no real network delivery provider. Normal staging uses disabled/no-op delivery; automated tests may use the in-memory implementation. This runbook does not authorize a real destination or production activation.

Never place destination details, credentials, personal contacts, connection details, authentication/session material, raw identities, employee records or stored hashes in source code, documentation, alert payloads, logs, screenshots or general incident evidence.

## Configuration key names

Only these key names are documented here. Values belong in approved secure configuration controls and must not be copied into the repository or operational evidence.

- `ALERTING_ENABLED`
- `ALERTING_PROVIDER`
- `ALERT_COOLDOWN_SECONDS`
- `ALERT_LOGIN_FAILURE_THRESHOLD`
- `ALERT_REFRESH_FAILURE_THRESHOLD`
- `ALERT_HTTP_429_THRESHOLD`
- `ALERT_DATABASE_LATENCY_MS`
- `ALERT_FUNCTION_TIMEOUT_THRESHOLD`

The committed examples keep external delivery disabled. Spike/latency/timeout thresholds remain unset until operational approval.

## Secure configuration sequence

1. Complete `ALERTING_APPROVAL_CHECKLIST.md` through the approved organizational process.
2. Approve a delivery design and implement it in a separately reviewed milestone. Do not insert destination or credential material into the application repository.
3. Review the provider implementation for payload allowlisting, authentication storage, timeout behavior, retry bounds and explicit failure handling.
4. Approve staging warning/critical thresholds after observation against approved staging traffic.
5. Enter configuration only through the approved protected configuration console.
6. Validate that unsupported or incomplete enabled configuration fails startup safely.
7. Deploy through a reviewed commit and normal deployment path; do not run alert setup during ordinary HTTP requests.
8. Perform the synthetic staging test below and collect sanitized evidence.
9. Require owner acknowledgement before considering delivery active.

## Staging test procedure

1. Confirm the target is the approved protected staging deployment and uses sample data only.
2. Confirm the alert payload allowlist and redaction tests pass locally.
3. Confirm disabled/no-op delivery performs no network operation.
4. Use the in-memory provider only inside automated tests.
5. After a real provider is separately approved and implemented, emit one approved synthetic operational category through the protected staging path.
6. Verify one notification, one acknowledgement and the expected cooldown suppression using sanitized evidence.
7. Verify delivery failure returns an explicit failed outcome and does not claim success.
8. Disable the test configuration and confirm no later delivery occurs.

No real staging notification is authorized during Gate 5.6B1.

## Notification acknowledgement

- Record only the event category, severity, safe timestamp, environment label, safe request ID if needed, route template and acknowledgement outcome.
- Acknowledgement owner and timing remain the placeholders in the approval checklist.
- Do not copy a complete notification, destination, identity or platform credential into general evidence.
- A missing acknowledgement must follow the approved escalation timing; no timing is approved in this milestone.

## Delivery failure handling

1. Treat delivery exceptions, timeouts and non-success provider responses as failures.
2. Never convert a failed or disabled result into a delivered result.
3. Record only a safe failure category and approved aggregate count.
4. Preserve the original operational event in structured application logs.
5. Use an approved secondary escalation path only after that path is independently approved and tested.
6. If delivery configuration is unsupported or incomplete, fail validation safely and return to disabled configuration through protected controls.

## Cooldown and deduplication

- Gate 5.6B1 provides in-process cooldown/deduplication for foundation tests.
- Deduplication keys use event category and sanitized route template only; they do not contain identities.
- Repeated identical events are suppressed during the configured cooldown.
- Explicit reset and expiry behavior are covered by automated tests.
- In-process state is not shared between serverless instances and is not production-grade.
- An approved shared store, ownership, retention, concurrency behavior and failure policy remain required before production.

## Rollback and disabling procedure

1. Freeze alert configuration changes and preserve sanitized evidence.
2. Return delivery to the documented disabled state through approved protected configuration controls.
3. Redeploy the last reviewed Ready application commit when a code rollback is required.
4. Do not weaken authentication, CSRF, rate limiting, audit logging or Deployment Protection.
5. Verify root, health, readiness, authentication/session continuity and shared limiting.
6. Confirm no later notification was delivered and record only the safe result.

## Evidence handling

- Store evidence only at `[APPROVED_ALERT_EVIDENCE_LOCATION]`.
- Apply `[APPROVED_EVIDENCE_ACCESS_POLICY]` and `[APPROVED_EVIDENCE_RETENTION_PERIOD]` after approval.
- Preserve safe timestamps, categories, severity, aggregate counts, request IDs and acknowledgement outcomes.
- Redact screenshots before sharing.
- Do not export unrestricted logs or full alert records.

## Prohibited alert content

Alert payloads must never contain:

- credentials, environment values or connection details;
- authentication/session material or authorization headers;
- destination values or personal contact details;
- raw request/response bodies, raw headers, full URLs or query strings;
- raw account or source identities;
- employee records or confidential audit metadata;
- raw Error objects, messages, stack traces or driver details;
- stored cryptographic hashes or provider protection material.
