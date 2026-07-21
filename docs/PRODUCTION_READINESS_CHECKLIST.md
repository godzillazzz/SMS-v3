# SMS v3 production-readiness checklist

## Current decision

- [x] The current system is staging only.
- [x] Only sample data is approved.
- [ ] Organizational approval for production use is complete.
- [ ] Hosting plan and commercial-use approval are complete.
- [ ] Backup scheduling on the company server/NAS is operational and tested.
- [ ] Monitoring, alerting, and on-call ownership are assigned and tested.
- [ ] Privacy and security approvals are complete.

The unchecked items block production readiness. A successful staging technical review does not authorize production data or production credentials.

## Technical evidence required before production

- [ ] The production environment is provisioned through an approved secret manager.
- [ ] Database migration and rollback/forward-fix procedures are approved and rehearsed.
- [ ] Login, session rotation, CSRF, logout, authorization, audit, health, and readiness checks pass in the approved production-like environment.
- [ ] CORS contains only approved origins and never combines credentials with a wildcard.
- [ ] Automated backup, checksum, encryption, secure transfer, retention, failure notification, and disposable restore verification are scheduled and evidenced.
- [ ] Centralized rate limiting is approved for the chosen scale and serverless topology.
- [ ] Audit-log access, retention, monitoring, and incident escalation owners are assigned.
- [ ] Recovery objectives, privacy notices, data classification, and employee-data handling have formal approval.
