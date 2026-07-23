# Notification Rollback Runbook

This document details the emergency rollback steps for deactivating staging notification delivery. Do not execute these steps during this gate.

---

## Rollback Procedures

### Step 1: Deactivate Flag
Set the following Vercel staging environment configuration flag to disabled:
`ALERTING_ENABLED=false`

### Step 2: Purge Provider Credentials
Delete or invalidate the environment variable keys in Vercel staging console:
- `ALERTING_API_TOKEN`
- `ALERTING_DESTINATION_ID`

### Step 3: Trigger Pipeline Redeployment
Execute a new Vercel deployment cache rebuild to propagate env deletions.

### Step 4: Verify Delivery Block
Inspect staging service logs; confirm zero outbound alerts are dispatched. Verify that failed notifications do not cause app crashes (middleware fails closed).

### Step 5: Verify Health endpoints
Verify that `/api/v1/health` and `/api/v1/ready` return HTTP 200.

### Step 6: Log Audit & Notifications
- Record the deactivation event in the central incident register (`INTERNAL-EVIDENCE-REF-PLACEHOLDER`).
- Notify the following owner roles immediately:
  - Technical Owner
  - Security Owner
  - Monitoring Owner
  - Business Owner
