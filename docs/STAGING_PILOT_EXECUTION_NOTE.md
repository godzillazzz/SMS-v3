# Staging Pilot Execution Note

## 1. Pilot Approval Status
- **Staging Pilot Approval Outcome**: **APPROVED WITH RESTRICTIONS** (via `INTERNAL-EVIDENCE-REF-PLACEHOLDER`).
- **Current Recommendation**: **READY TO START SYNTHETIC-DATA PILOT**

---

## 2. Scope & Restrictions
- **Allowed Data**: Synthetic mock data only.
- **Prohibited Data**: Real employee personal identifier information (PII), live email addresses, or production database records.
- **Notification Delivery**: Remains **DISABLED** (Mock provider only).
- **Backup Automation**: Remains **NOT ACTIVATED** (Task scheduler inactive on host).
- **Vercel / Supabase Settings**: No changes to active configurations permitted.

---

## 3. Verified Start Conditions
The following pre-start baseline verifications were executed successfully:
- **Staging Health**: Verifications of `/`, `/api/v1/health`, and `/api/v1/ready` return HTTP 200.
- **Rate Limiter**: PostgreSQL-backed limiter successfully blocks requests exceeding thresholds with HTTP 429.
- **Deduplication**: Telemetry occurrence match and cooldown verified.
- **Log Safety**: NDJSON output streams successfully redact tokens, cookies, and connection secrets.
- **Backup Harness**: Node test runner reports 100% success for scripts validation tests.

---

## 4. Operational Guardrails & Rollback
- **Stop Conditions**: The pilot must be stopped immediately if:
  - Real employee data is loaded into the staging environment.
  - Sensitive environment variables are written to the application log stream.
  - High error rates (>1% HTTP 5xx) are detected.
- **Rollback Procedure**:
  - Re-run staging database reset migration:
    ```bash
    npm run prisma:migrate -- --name reset
    ```
  - Purge Vercel deployment cache and redeploy stable baseline build.
- **Evidence Handling Rule**: All verification evidence must be sanitized. Do not include raw cookies, tokens, or PII screenshots in any shared files.
