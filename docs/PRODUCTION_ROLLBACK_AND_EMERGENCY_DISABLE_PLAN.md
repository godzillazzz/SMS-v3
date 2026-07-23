# Production Rollback and Emergency Disable Plan

This document details the emergency stop procedures, rollback triggers, and disabling protocols for SMS v3 production services.

---

## 1. Rollback Triggers & Disabling Protocols

| Disabling Domain | Emergency Trigger Condition | Automated / Manual Procedure | Assigned Rollback Owner |
| :--- | :--- | :--- | :--- |
| **Data Import Rollback** | Schema corruption or unvalidated data import | Restore database snapshot & purge unvalidated rows | `PRODUCTION-ROLLBACK-OWNER-PLACEHOLDER` |
| **Notification Disabling** | Alert flooding or unredacted PII exposure | Set `ALERTING_ENABLED=false` and disable provider route | `PRODUCTION-ROLLBACK-OWNER-PLACEHOLDER` |
| **Backup Task Disabling** | Host disk full or storage transfer failure | Disable Windows Task Scheduler task immediately | `PRODUCTION-ROLLBACK-OWNER-PLACEHOLDER` |
| **Access Revocation** | Unauthorized access attempt or token leak | Invalidate all JWT refresh tokens & set `MAINTENANCE=true` | `PRODUCTION-ROLLBACK-OWNER-PLACEHOLDER` |

---

## 2. Governance & Communication
- **Evidence Collection**: Mandatory NDJSON audit log capture during emergency stop.
- **Communication Protocol**: Immediate escalation notice to Incident Commander role (`PRODUCTION-ROLLBACK-OWNER-PLACEHOLDER`).
- **Production Status**: Notification delivery remains **DISABLED AFTER ROLLBACK**. Backup automation remains **DISABLED AFTER TEST**.
