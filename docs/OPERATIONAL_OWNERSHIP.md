# Operational Ownership

## Approval Status
All ownership entries are unresolved placeholders. Unresolved primary/backup ownership, escalation paths, and approval authority are production blockers.

| Responsibility Role | Primary Responsibility | Backup Responsibility | Acknowledgement Time Target | Escalation Time Target | Approval Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Application Owner** | Business alignment & roadmap | Backup business operations | 4 hours | 24 hours | UNRESOLVED - PRODUCTION BLOCKER |
| **Technical Owner** | Architecture & code quality | Backup system architecture | 1 hour | 4 hours | UNRESOLVED - PRODUCTION BLOCKER |
| **Database Owner** | Schema & database engine stability | Backup database management | 30 minutes | 2 hours | UNRESOLVED - PRODUCTION BLOCKER |
| **Security Owner** | Security compliance & audits | Security incident response backup | 15 minutes | 1 hour | UNRESOLVED - PRODUCTION BLOCKER |
| **Privacy/PDPA Owner** | Personal data privacy & regulatory compliance | Backup data privacy officer | 2 hours | 8 hours | UNRESOLVED - PRODUCTION BLOCKER |
| **Monitoring Owner** | Telemetry ingestion & metrics config | Backup monitoring pipeline setup | 1 hour | 4 hours | UNRESOLVED - PRODUCTION BLOCKER |
| **Incident Commander** | Outage coordination & triage | Backup incident coordinator | 15 minutes | 1 hour | UNRESOLVED - PRODUCTION BLOCKER |
| **Backup Owner** | Backup execution & recovery tests | Backup restore automation verification | 4 hours | 12 hours | UNRESOLVED - automation deferred |
| **After-Hours Escalation Role** | On-call duty & overnight response | Secondary on-call contact | 30 minutes | 1 hour | UNRESOLVED - PRODUCTION BLOCKER |
| **Notification-Channel Owner** | Alert destination & credential config | Backup notifier admin | 2 hours | 8 hours | UNRESOLVED - PRODUCTION BLOCKER |

## Decision Responsibilities

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

## Required Completion Evidence

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
