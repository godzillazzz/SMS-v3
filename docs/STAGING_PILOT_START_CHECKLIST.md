# Staging Pilot Start Checklist

This checklist must be finalized immediately prior to starting the staging pilot.

---

## Pre-Start Checklist

- [x] **1. Owner Decision Recorded**
  - *Status*: **VERIFIED** (Recorded in `docs/STAGING_PILOT_APPROVAL_OUTCOME.md` with reference `INTERNAL-EVIDENCE-REF-PLACEHOLDER`).

- [x] **2. Permitted Data Confirmed**
  - *Status*: **VERIFIED** (Synthetic only constraints defined in `docs/STAGING_PILOT_RESTRICTIONS.md`).

- [ ] **3. Participant Role Placeholders Confirmed**
  - *Status*: **NOT STARTED**

- [ ] **4. Test Scenarios Selected**
  - *Status*: **NOT STARTED**

- [ ] **5. Rollback Procedure Reviewed**
  - *Status*: **NOT STARTED**

- [ ] **6. Monitoring Dashboard Reviewed**
  - *Status*: **NOT STARTED**

- [x] **7. Log-Safety Reviewed**
  - *Status*: **VERIFIED** (Redaction rules verified by tests in `test/logger.test.js`).

- [x] **8. Rate Limiter Verified**
  - *Status*: **VERIFIED** (PostgreSQL-backed fixed window verified in `test/rate-limit.test.js`).

- [x] **9. Alert Deduplication Verified**
  - *Status*: **VERIFIED** (Cooldown logic verified in `test/alert-dedup.test.js`).

- [x] **10. Backup Template Tests Verified**
  - *Status*: **VERIFIED** (Safety harness verified in `test/backup-template.test.js`).

- [ ] **11. Incident Runbook Tabletop Reviewed**
  - *Status*: **NOT STARTED**

- [ ] **12. Evidence Storage Location Confirmed**
  - *Status*: **NOT STARTED** (Pending location placeholder confirmation).
