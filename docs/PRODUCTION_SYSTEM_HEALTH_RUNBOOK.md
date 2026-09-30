# Production System Health Runbook

## Purpose
Use the existing ADMIN read-only **Performance and System Health** page as the first operational view. Metrics are runtime-instance rolling samples, not a global SLA. Never expose payloads, tokens, query strings, or user data in incident notes.

## Action thresholds
| Signal | Watch | Incident | First action |
| --- | ---: | ---: | --- |
| HTTP 5xx rate | >= 1% | >= 5% | Check warnings and slow-route table; compare deployment SHA/host with last known good release. |
| API p95 | >= 750 ms | >= 1,500 ms | Identify highest-p95 route and sample count; confirm whether DB latency rises with it. |
| Database latency | >= 250 ms | >= 750 ms or unavailable | Confirm readiness and DB warning state; avoid migrations/config mutations during triage. |
| Route p95 | >= 1,000 ms | >= 2,000 ms | Isolate the route and reproduce without recording sensitive request data. |
| Dropped samples | > 0 | sustained growth across refreshes | Treat the runtime sample window as incomplete and corroborate with platform logs. |

A single low-sample spike is not enough to declare an incident. Recheck the snapshot and sample count. `DEGRADED`, database unavailable, repeated 5xx, or multiple thresholds crossing together should be treated as actionable.

## Triage
1. Record generated-at time, environment, commit SHA, deployment host, request count, p50/p95, 5xx rate, DB latency, warning codes, and affected route templates.
2. Refresh once to distinguish a transient sample from a sustained condition.
3. Check the current Vercel deployment status and technical smoke. Do not change DB/API/RBAC merely to clear a dashboard warning.
4. If the condition began immediately after release and user impact is credible, roll back to the previous documented Production deployment, then rerun the technical smoke.
5. Preserve request IDs from user-visible errors when available, but do not copy tokens, payloads, or PII into the handoff.

## Release acceptance
A release may promote only after full frontend regression, production build, bundle budgets, UAT configuration contract, Preview Ready, and technical browser/API smoke pass. Authenticated ADMIN/MANAGER/VIEWER workflows remain mandatory when approved UAT credentials are available; absence of credentials must never be replaced with invented accounts.
