# Operational Ownership

## Approval status

All ownership entries are unresolved placeholders. Unresolved primary/backup ownership, escalation paths and approval authority are production blockers.

| Responsibility | Primary owner | Backup owner | Approval/status |
| --- | --- | --- | --- |
| Application owner | `[APPLICATION_OWNER]` | `[APPLICATION_OWNER_BACKUP]` | UNRESOLVED - PRODUCTION BLOCKER |
| Technical owner | `[TECHNICAL_OWNER]` | `[TECHNICAL_OWNER_BACKUP]` | UNRESOLVED - PRODUCTION BLOCKER |
| Database owner | `[DATABASE_OWNER]` | `[DATABASE_OWNER_BACKUP]` | UNRESOLVED - PRODUCTION BLOCKER |
| Security contact | `[SECURITY_CONTACT]` | `[SECURITY_CONTACT_BACKUP]` | UNRESOLVED - PRODUCTION BLOCKER |
| Privacy/PDPA contact | `[PRIVACY_PDPA_CONTACT]` | `[PRIVACY_PDPA_BACKUP]` | UNRESOLVED - PRODUCTION BLOCKER |
| Incident commander | `[INCIDENT_COMMANDER]` | `[INCIDENT_COMMANDER_BACKUP]` | UNRESOLVED - PRODUCTION BLOCKER |
| Backup owner | `[BACKUP_OWNER]` | `[BACKUP_OWNER_BACKUP]` | UNRESOLVED - automation deferred |
| After-hours escalation | `[AFTER_HOURS_ESCALATION]` | `[AFTER_HOURS_BACKUP]` | UNRESOLVED - PRODUCTION BLOCKER |
| Deployment approver | `[DEPLOYMENT_APPROVER]` | `[DEPLOYMENT_APPROVER_BACKUP]` | UNRESOLVED - PRODUCTION BLOCKER |
| Migration approver | `[MIGRATION_APPROVER]` | `[MIGRATION_APPROVER_BACKUP]` | UNRESOLVED - PRODUCTION BLOCKER |
| Monitoring/threshold approver | `[MONITORING_APPROVER]` | `[MONITORING_APPROVER_BACKUP]` | UNRESOLVED - PRODUCTION BLOCKER |

## Decision responsibilities

| Decision | Responsible placeholder | Required consultation |
| --- | --- | --- |
| Declare/close SEV-1 or SEV-2 | `[INCIDENT_COMMANDER]` | Technical, security, database and privacy owners as applicable |
| Roll back deployment | `[ROLLBACK_APPROVER]` | Application and technical owners; database owner when schema compatibility matters |
| Change alert threshold | `[MONITORING_APPROVER]` | Technical, security and database owners |
| Rotate a credential | `[SECURITY_CONTACT]` | Relevant platform owner and technical owner |
| Apply database migration | `[MIGRATION_APPROVER]` | Database and application owners |
| Approve production release | `[PRODUCTION_APPROVER]` | Security, privacy/PDPA, technical, database, operations and backup owners |
| Approve data retention/deletion | `[PRIVACY_PDPA_CONTACT]` | Security, application and database owners |
| Approve backup automation | `[BACKUP_OWNER]` | Database, security and operations owners |

## Required completion evidence

Before production consideration, record without personal contact data in this repository:

- each role is assigned through the approved internal directory/process;
- primary and backup acknowledgement is tested;
- after-hours escalation is tested;
- alert/notification delivery is tested;
- severity and response targets are approved;
- staging thresholds are observed and approved;
- incident evidence location/access/retention is approved;
- rollback authority and database compatibility review are tested;
- backup automation ownership and restore-verification schedule are approved.

Actual names and contact details must remain in the approved access-controlled operational directory, not in source control.
