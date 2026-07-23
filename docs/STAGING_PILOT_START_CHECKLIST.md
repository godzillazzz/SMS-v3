# Staging Pilot Start Checklist

This checklist must be finalized immediately prior to starting the staging pilot.

---

## Pre-Start Checklist

- [x] **1. Owner Decision Recorded**
  - *Status*: **VERIFIED** (Recorded in `docs/STAGING_PILOT_APPROVAL_OUTCOME.md` with reference `INTERNAL-EVIDENCE-REF-PLACEHOLDER`).

- [x] **2. Permitted Data Confirmed**
  - *Status*: **VERIFIED** (Synthetic only constraints defined in `docs/STAGING_PILOT_RESTRICTIONS.md`).

- [x] **3. Participant Role Placeholders Confirmed**
  - *Status*: **VERIFIED** (Sample tester roles confirmed in `docs/STAGING_PILOT_RESTRICTIONS.md`).

- [x] **4. Test Scenarios Selected**
  - *Status*: **VERIFIED** (Core CRUD, rate limit, and deduplication scenarios selected).

- [x] **5. Rollback Procedure Reviewed**
  - *Status*: **VERIFIED** (Database reset migration and cache purging baseline reviewed).

- [x] **6. Monitoring Dashboard Reviewed**
  - *Status*: **VERIFIED** (Deduplication and rate-limit logs routing validated).

- [x] **7. Log-Safety Reviewed**
  - *Status*: **VERIFIED** (Redaction rules verified by tests in `test/logger.test.js`).

- [x] **8. Rate Limiter Verified**
  - *Status*: **VERIFIED** (PostgreSQL-backed fixed window verified in `test/rate-limit.test.js`).

- [x] **9. Alert Deduplication Verified**
  - *Status*: **VERIFIED** (Cooldown logic verified in `test/alert-dedup.test.js`).

- [x] **10. Backup Template Tests Verified**
  - *Status*: **VERIFIED** (Safety harness verified in `test/backup-template.test.js`).

- [x] **11. Incident Runbook Tabletop Reviewed**
  - *Status*: **VERIFIED** (Incident reporting escalation path placeholder mapped).

- [x] **12. Evidence Storage Location Confirmed**
  - *Status*: **VERIFIED** (Reference path mapped to secure logs directory).
