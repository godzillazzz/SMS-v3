# Privacy and Security Approval Checklist

## Approval status

- [x] Environment is staging-only.
- [x] Only clearly labelled sample data is approved.
- [ ] Production use approved.
- [ ] Automated production backup scheduling approved and tested.
- [ ] Production hosting and commercial use approved.

Unchecked items are required decisions, not implied approvals.

## Data classification

- [ ] Organization-specific data classification has been formally approved.
- [x] Database credentials, signing secrets, tokens, cookies, and session material are treated as restricted secrets.
- [x] Authentication and audit records are treated as restricted operational data.
- [x] Employee-domain data is treated as confidential even while staging contains sample records only.
- [x] Source code and non-secret configuration examples are treated as internal engineering material.
- [ ] Classification handling rules, retention periods, and approved storage locations are documented by the responsible organization.

## Access control

- [x] API authentication and ADMIN, HR, and USER authorization controls have automated coverage.
- [x] Employee endpoints require authentication and role checks for privileged changes.
- [x] Refresh sessions can be revoked per session and for all sessions.
- [ ] Staging user access list has been reviewed and approved by an assigned access-control owner.
- [ ] Joiner, mover, leaver, and emergency-access procedures have been approved.
- [ ] Periodic access recertification schedule and evidence owner have been assigned.

## Least privilege

- [x] Prisma remains the database access layer and business logic does not depend on a Supabase database SDK.
- [x] Secrets are supplied by ignored local files or deployment environment controls, not source code.
- [ ] Database role permissions have been independently reviewed against production requirements.
- [ ] Vercel, GitHub, Supabase, and operational administrator permissions have been reviewed and minimized.
- [ ] Service-account ownership and credential-rotation intervals have been approved.

## Privacy and PDPA review

- [ ] PDPA/privacy owner: pending assignment.
- [ ] Lawful basis and permitted processing purposes: pending approval.
- [ ] Privacy notice and data-subject request process: pending approval.
- [ ] Cross-border transfer, processor, and subprocessor assessment: pending approval.
- [ ] Data minimization and field-level collection review: pending approval.
- [ ] Privacy impact assessment requirement and outcome: pending determination.

## Security and vulnerability review

- [x] Production errors are designed to return sanitized messages while detailed diagnostics remain in server logs.
- [x] Browser refresh tokens use HttpOnly cookies, access tokens remain in memory, and cookie-authenticated state changes require CSRF validation.
- [x] CORS configuration requires an explicit allowlist when credentials are enabled.
- [x] Backend and frontend dependency audits are part of the review workflow.
- [ ] Independent security reviewer: pending assignment.
- [ ] Threat model and abuse-case review: pending approval.
- [ ] Penetration-test scope, schedule, remediation threshold, and sign-off: pending approval.
- [ ] Vulnerability disclosure and remediation service levels: pending approval.

## Retention and deletion

- [ ] Data retention schedule by record type: pending approval.
- [ ] Audit-log retention, access, export, and deletion requirements: pending approval.
- [ ] Refresh-session cleanup schedule: pending approval.
- [ ] Sample-data deletion and staging reset procedure: pending approval.
- [ ] Legal hold and approved secure-deletion procedure: pending approval.

## Backup and recovery

- [x] Technical backup and disposable local restore rehearsal completed using sample staging data.
- [x] Backup artifacts, checksums, logs, and credential files are excluded from Git.
- [ ] Automated Windows Server or NAS backup scheduling is implemented and tested; intentionally deferred for this gate.
- [ ] Operational ownership, alerting, retention, encryption-key custody, and recurring restore verification are approved.

## Approval placeholders

- Privacy approval — role/name: pending; decision/date: pending.
- Security approval — role/name: pending; decision/date: pending.
- Data owner approval — role/name: pending; decision/date: pending.
- Application owner approval — role/name: pending; decision/date: pending.
- Operations approval — role/name: pending; decision/date: pending.
- Production hosting/commercial approval — authority: pending; decision/date: pending.

This checklist records staging evidence only. It does not grant production approval.
