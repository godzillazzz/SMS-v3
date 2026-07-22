# Shared Alert Deduplication Runbook

## Status and safety boundary

Gate 5.6B2A adds a vendor-independent PostgreSQL shared-state foundation. The migration is committed for review but is not applied to the approved staging database in this milestone. Hosted configuration remains on the local-memory default, and external notification delivery remains disabled.

This runbook does not authorize production use, a real destination or an external monitoring service.

## Current limitation and architecture

Process-local memory is isolated to one runtime instance. Two serverless instances can receive the same operational event, hold separate counters/cooldowns and each decide that the event is eligible. That can produce duplicate delivery attempts after a real provider is introduced.

The shared foundation coordinates eligible event occurrences through one dedicated PostgreSQL table:

1. The policy selects only an approved event category.
2. Route and environment inputs pass the existing safety allowlist.
3. A dedicated backend-only secret creates a keyed HMAC-SHA256 deduplication key.
4. Event category, stored HMAC and aggregation window form the unique shared key.
5. One atomic insert/conflict update increments occurrences and reserves cooldown eligibility.
6. The store returns only eligibility, suppression, occurrence count and cooldown expiry.
7. The policy delivers only after an eligible shared decision.
8. A generic delivery state is recorded without destination or message content.

The safe alert-payload allowlist is unchanged. Request IDs may appear in an alert payload when safe, but they are deliberately excluded from deduplication keys and stored state.

## Dedicated data model

The `alert_deduplication_states` table contains only:

- generated record ID;
- approved event category;
- keyed deduplication hash;
- severity;
- aggregation-window start;
- occurrence count and last occurrence time;
- generic delivery status;
- last delivery-attempt time;
- cooldown expiry;
- record expiry;
- creation/update timestamps.

Allowed delivery states are `pending`, `suppressed`, `delivered` and `failed`.

The unique constraint covers event category, keyed hash and aggregation window. The expiry index supports controlled cleanup. No relationship to user, employee, audit or session records exists.

## UUID default representation

Database-generated UUID defaults defined by the reviewed migration SQL are authoritative. Prisma represents these defaults with `dbgenerated("gen_random_uuid()")` so schema comparison matches the database behavior without removing the default. Historical migration files must not be edited, and future UUID-backed models must use this same reviewed pattern. This representation alignment performs no database change.

## Configuration key names

Values belong only in approved secure backend configuration controls. Do not copy values into source control, tickets, screenshots or reports.

- `ALERT_DEDUP_STORE`
- `ALERT_DEDUP_HASH_SECRET`
- `ALERT_DEDUP_RETENTION_SECONDS`
- `ALERT_COOLDOWN_SECONDS`
- `ALERTING_ENABLED`
- `ALERTING_PROVIDER`

The deduplication secret must be independent from all other application secrets and must meet the configured minimum length. External alert delivery remains disabled throughout shared-store activation testing.

## Controlled migration procedure

This procedure is for a later approved staging activation task:

1. Obtain database, technical and security approval for the reviewed migration.
2. Confirm the migration creates only the dedicated alert-deduplication table, its check/unique constraints and expiry index.
3. Confirm a current staging backup/restore-verification decision through the approved operational process.
4. Provide database migration access through a secure process environment; do not print the connection value.
5. Run `npx prisma migrate deploy` manually from the controlled deployment workstation or approved migration job.
6. Run `npx prisma migrate status` and verify the new migration is recorded.
7. Verify the dedicated table, constraint and index names using metadata-only queries.
8. Do not add migration execution to builds, application startup, serverless initialization or HTTP requests.

Gate 5.6B2A stops before step 4. No staging migration was executed.

## Staging activation order

1. Complete the migration procedure and verify readiness remains healthy.
2. Approve retention, cleanup ownership and shared-store failure policy.
3. Add the independent deduplication secret through protected backend configuration.
4. Select the PostgreSQL deduplication store through protected backend configuration.
5. Keep external delivery disabled.
6. Deploy a reviewed commit and confirm the deployment is Ready.
7. Exercise synthetic simultaneous events across independent runtime instances.
8. Verify one eligible shared decision, suppressed duplicates, atomic occurrence count and generic delivery state.
9. Review safe store-failure and cleanup signals.
10. Roll back to memory/disabled operation if shared coordination cannot be verified.

Do not enable a real notification provider as part of shared-store activation testing.

## Failure policy

- PostgreSQL shared-store selection without the independent secret fails configuration validation.
- Shared-store unavailability returns a safe `store_unavailable` decision.
- Eligibility and suppression remain unknown on store failure; the application does not claim either outcome.
- Delivery is not attempted when the initial shared reservation fails.
- A delivery-state update failure cannot produce a successful delivery claim.
- Hosted execution must not silently fall back from PostgreSQL to process memory.
- Only the safe `alert_dedup_store_unavailable` operational category is emitted; raw database errors and connection details are excluded.

## Rollback procedure

1. Keep external delivery disabled and freeze further alert configuration changes.
2. Preserve sanitized event categories, safe counts, timestamps and request IDs where applicable.
3. Return the deduplication store selection to the approved disabled/local-safe configuration through protected controls.
4. Redeploy the last reviewed Ready commit and verify root, health, readiness, authentication/session continuity and shared login limiting.
5. Do not drop the table or edit migration history manually.
6. If schema removal is required, create a separately reviewed forward migration after retention/evidence review.
7. Record the safe rollback outcome and ownership decision.

## Cleanup and retention guidance

- Cleanup deletes only records whose dedicated expiry field has passed.
- Cleanup uses only the alert-deduplication Prisma model/table.
- Cleanup is explicit; it is not called from build, startup, serverless initialization or ordinary requests.
- No cleanup schedule is created in Gate 5.6B2A.
- Seven days is a suggested staging observation baseline, not a production approval.
- Retention must be approved against incident-evidence, privacy and storage requirements before hosted activation.
- Cleanup ownership, frequency, failure escalation and verification evidence remain unresolved.

## Monitoring signals

- `alert_dedup_store_unavailable`
- `alert_dedup_cleanup_result`
- `alert_dedup_cleanup_failure`
- safe occurrence-count and suppression aggregates;
- dedicated table row count and expiry backlog;
- delivery-state aggregate counts;
- readiness and database latency signals.

Signals must not include the stored HMAC, raw key input, destination details, identities or database details.

## Ownership placeholders

- Shared-store owner: `[SHARED_DEDUPLICATION_STORE_OWNER]`
- Database owner: `[DATABASE_OWNER]`
- Cleanup owner: `[ALERT_DEDUP_CLEANUP_OWNER]`
- Retention approver: `[ALERT_DEDUP_RETENTION_APPROVER]`
- Store-failure policy approver: `[ALERT_DEDUP_FAILURE_POLICY_APPROVER]`
- Security reviewer: `[SECURITY_OWNER]`
- Privacy/PDPA reviewer: `[PRIVACY_PDPA_OWNER]`
- Incident commander: `[INCIDENT_COMMANDER]`

All placeholders are unresolved production blockers. Actual names and contacts belong in the approved access-controlled organizational directory, not this repository.

## Prohibited stored content

Never store in alert deduplication state:

- request or response bodies;
- raw Error messages, stacks or driver output;
- complete URLs, query strings or raw headers;
- request IDs, user/account/source identities or employee records;
- audit metadata;
- credentials, authentication/session material or connection details;
- destination addresses, webhook URLs, telephone numbers or provider responses;
- raw deduplication input or any reusable secret.

## Production approval blockers

- migration review and controlled staging application;
- secure staging configuration of the independent deduplication secret;
- hosted PostgreSQL store selection;
- Ready hosted deployment after activation;
- cross-instance atomic/suppression verification;
- approved retention and cleanup schedule/owner;
- approved shared-store failure policy;
- approved real notification channel, owners and thresholds;
- real delivery, failure and acknowledgement tests;
- production-grade operational evidence and incident response approval.
