# Backup Failure Alert Controlled Activation Runbook

> [!IMPORTANT]
> All steps in this runbook are **PLANNED ONLY**.
> Notification delivery remains **DISABLED AFTER ROLLBACK** in the current milestone.

---

## 1. Runbook Step Matrix (PLANNED ONLY)

| Step # | Runbook Step Description | Expected Outcome | Status |
| :--- | :--- | :--- | :--- |
| **Step 1** | Pre-Test Health Check | Verify HTTP 200 on staging health routes | **PLANNED ONLY** |
| **Step 2** | Pre-Activation State Check | Confirm notification delivery is disabled before activation | **PLANNED ONLY** |
| **Step 3** | Staging Route Binding | Bind staging destination (`ENTERPRISE_CHAT_DESTINATION_PLACEHOLDER`) outside Git | **PLANNED ONLY** |
| **Step 4** | Deployment Check | Confirm staging deployment contains approved payload filter | **PLANNED ONLY** |
| **Step 5** | Synthetic Trigger Execution | Trigger exactly one synthetic backup failure event | **PLANNED ONLY** |
| **Step 6** | Delivery Verification | Verify exactly one sanitized alert payload received | **PLANNED ONLY** |
| **Step 7** | Deduplication Check | Trigger second synthetic failure; verify alert suppressed by cooldown | **PLANNED ONLY** |
| **Step 8** | Fail-Closed Check | Simulate invalid destination; verify alert fails closed without exception | **PLANNED ONLY** |
| **Step 9** | Route Disabling / Rollback | Re-disable staging alert route outside Git immediately post-test | **PLANNED ONLY** |
| **Step 10**| Post-Test Disabled State | Verify notification delivery status is DISABLED AFTER ROLLBACK | **PLANNED ONLY** |
| **Step 11**| Evidence Collection | Collect sanitized NDJSON audit logs (`INTERNAL-EVIDENCE-REF-PLACEHOLDER`) | **PLANNED ONLY** |

---

## 2. Emergency Abort & Rollback Instructions
- In case of unexpected alert flooding, unredacted secret in payload, or destination error:
  1. Immediately set `ALERTING_ENABLED=false` in execution context outside Git.
  2. Confirm provider route is closed.
  3. Log incident via `INTERNAL-EVIDENCE-REF-PLACEHOLDER`.
