# Monitoring and Incident Plan

## Current scope

This plan applies to the SMS v3 staging environment. The environment is sample-data-only and is not approved for production use. Automated Windows Server or NAS backup scheduling remains deferred.

Monitoring must record status, timestamps, correlation IDs, safe error categories, and aggregate counts only. Credentials, tokens, cookies, authorization headers, connection values, and employee payloads must never be included in alerts or incident notes.

## Monitoring signals

| Signal | Expected behavior | Alert condition | Initial owner |
| --- | --- | --- | --- |
| `GET /api/v1/health` | HTTP 200 | Two consecutive failures within the agreed monitoring interval | Application operations owner: pending assignment |
| `GET /api/v1/ready` | HTTP 200 with database ready | Any sustained readiness failure or repeated intermittent failure | Application and database operations owners: pending assignment |
| Failed login audits | Stable staging baseline | Spike threshold and evaluation window: pending approval | Security review owner: pending assignment |
| HTTP 401/403/429 rates | Stable staging baseline | Repeated or abrupt increase above an approved threshold | Application and security review owners: pending assignment |
| Vercel function errors | No sustained 5xx or timeout trend | Any sustained 5xx, timeout, or cold-start failure trend | Application operations owner: pending assignment |
| Supabase connectivity | Readiness remains healthy | Authentication, pool exhaustion, TLS, DNS, or timeout category appears repeatedly | Database operations owner: pending assignment |
| Audit-log review | Scheduled review completed | Review overdue or anomalous events found | Audit review owner: pending assignment |

Alert thresholds, monitoring interval, notification destinations, on-call coverage, and escalation deadlines require organizational approval before production use.

## Incident severity

- SEV-1: confirmed exposure of restricted data or credentials, or widespread unauthorized access. Immediately contain access and begin the approved security escalation.
- SEV-2: staging service unavailable, persistent database unavailability, or authentication/session controls failing without evidence of exposure.
- SEV-3: degraded behavior, recurring errors, elevated 401/403/429 events, or isolated function failures with a workaround.
- SEV-4: low-impact defect, monitoring gap, documentation issue, or non-urgent operational improvement.

## Response steps

1. Acknowledge the alert and assign an incident coordinator using the approved escalation channel.
2. Record the start time, environment, deployment identifier, safe error category, and correlation IDs. Do not copy sensitive request or response material.
3. Confirm the impact using health, readiness, Vercel function status, Supabase status, and safe audit-event counts.
4. Contain the issue. Disable a failing release or revoke affected sessions when authorized; do not delete staging data as a diagnostic shortcut.
5. Preserve safe evidence and note every action. Restrict evidence access according to its classification.
6. Restore service using the release rollback runbook when the rollback criteria are met.
7. Rotate potentially exposed secrets through approved platform controls. Never store replacement values in Git or incident notes.
8. Verify health, readiness, authentication, authorization, audit creation, and session revocation after recovery.
9. Communicate status through approved channels. Escalation contacts and response-time commitments are pending assignment.
10. Close the incident only after the owner accepts the recovery evidence and follow-up actions are assigned.

## Rollback decision criteria

Rollback to a known-good deployment when the current deployment causes persistent health/readiness failure, elevated sanitized 5xx responses, broken browser authentication or CSRF enforcement, authorization regression, missing required audit records, or an unsafe data migration. Prefer an application deployment rollback when the database schema is backward compatible.

Do not perform destructive database rollback. Stop and obtain database-owner approval if recovery would remove columns, tables, migrations, audit records, or user data.

## Post-incident review checklist

- Confirm impact, timeline, detection method, safe root-cause category, and recovery time.
- Confirm whether credentials, sessions, personal information, or audit integrity were affected.
- Review monitoring and alert thresholds without embedding sensitive payloads.
- Review missing tests, documentation, ownership, and operational controls.
- Assign corrective actions, owners, priorities, and target dates through the approved tracker.
- Verify secret rotation and session revocation where applicable.
- Verify rollback and recovery evidence is retained according to the approved retention policy.
- Record the production-readiness decision separately; an incident closeout does not approve production use.
