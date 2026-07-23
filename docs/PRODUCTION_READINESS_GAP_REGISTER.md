# Production Readiness Gap Register

## Overview
This document inventories the remaining gaps between the current technically operational staging environment and a production-ready deployment of the SMS v3 application. 

> [!IMPORTANT]
> Unresolved gaps represent **production blockers**. Production readiness remains **NOT APPROVED**.

## Readiness Gap Matrix

| Area / Control Item | Current Status | Verified Evidence | Remaining Gap | Risk if Unresolved | Required Owner Role | Required Approval | Target Evidence | Blocker Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Hosting Approval** | Staging operation only | sms-v3-staging on Vercel | Vercel production hosting approval | Host environment misconfiguration | Infrastructure Owner | Vercel Production sign-off | Signed authorization | **BLOCKER** |
| **2. PDPA / Privacy Approval** | Staging schema defined | prisma/schema.prisma reviewed | Full data protection review | Regulatory non-compliance (PDPA) | Privacy/PDPA Owner | PDPA compliance sign-off | Certified audit report | **BLOCKER** |
| **3. Security Approval** | JWT & cookies verified | Local security tests pass | Security policy and credential review | Credential exposure or session hijack | Security Owner | Security controls sign-off | Signed security review | **BLOCKER** |
| **4. Vulnerability Review** | Dependency audit clean | npm audit reports 0 vulnerabilities | In-depth SAST/DAST report | Undetected code vulnerabilities | Security Owner | Vulnerability sign-off | Scanning tools clean logs | **BLOCKER** |
| **5. Least-Privilege Access** | Schema restrictions set | Prisma schema constraints verified | Host & DB account access control review | Privilege escalation or database leak | Database Owner | ACL access matrix approval | Access control matrix sheet | **BLOCKER** |
| **6. Real Employee Data Import**| Staging uses sample data only | test/employee.service.test.js | Import schema verification & approval | Data corruption or privacy breach | Privacy/PDPA Owner | Import authorization | Validated import script run | **BLOCKER** |
| **7. Backup Automation Activation**| Readiness package prepared | scripts/backup/backup.example.ps1 | Schedule activation on Windows/NAS | Data loss in case of hardware fail | Backup Owner | Backup execution sign-off | Scheduled task execution logs | **BLOCKER** |
| **8. Restore Rehearsal Schedule** | Rehearsal template prepared | scripts/backup/restore-rehearsal.ps1| Weekly automated rehearsal schedule | Undetected backup corruption | Restore-Test Owner | Rehearsal schedule sign-off | Rehearsal database log outputs | **BLOCKER** |
| **9. Notification Channel Approval**| No-op provider active | docs/ALERTING_APPROVAL_CHECKLIST.md | Real chat/email/SIEM channel choice | Missed alerts and delayed response | Notification Owner | Alert channel authorization | End-to-end delivery logs | **BLOCKER** |
| **10. Alert Thresholds** | Staging templates created | docs/ALERT_THRESHOLD_APPROVAL.md | Signed operational thresholds | False positives or missed alerts | Monitoring Owner | Threshold values sign-off | Configured alerts dashboard | **BLOCKER** |
| **11. Operational Ownership** | Role placeholders set | docs/OPERATIONAL_OWNERSHIP.md | Actual name assignment to roles | No clear path for incident commander | Application Owner | Ownership matrix sign-off | Directory role assignments | **BLOCKER** |
| **12. After-Hours Escalation** | Escalation paths defined | docs/OPERATIONAL_OWNERSHIP.md | Testing and verification logs | Delayed midnight incident response | Incident Commander | On-call rota sign-off | Escalation drill log report | **BLOCKER** |
| **13. Evidence Retention** | Staging NDJSON configured | docs/ALERT_RETENTION_APPROVAL.md | Retention configuration & approval | Storage exhaustion or compliance gap | Privacy/PDPA Owner | Retention policy sign-off | Storage cleanup script logs | **BLOCKER** |
| **14. Incident Response Approval** | Runbooks documented | docs/INCIDENT_RESPONSE_RUNBOOK.md | Incident response policy sign-off | Disorganized response to outages | Incident Commander | Runbook authorization | Signed incident simulation log | **BLOCKER** |
| **15. Rate-Limit Monitoring** | Shared Postgres rate limiter | test/rate-limit.test.js | Production rate limit monitoring | Brute-force entry goes unnoticed | Monitoring Owner | Rate-limit alerting sign-off | Active monitor metrics | **BLOCKER** |
| **16. Shared Alert Deduplication**| Staging deduplication active | test/alert-dedup.test.js | Active deduplication state dashboard | Alert store exhaustion | Monitoring Owner | Deduplication policy sign-off | Deduplication analytics view | **BLOCKER** |
| **17. Prisma Deprecation Follow-up**| Warning present | package.json warning in logs | Migration from package.json to config | Deprecation incompatibility in Prisma 7| Technical Owner | Config migration sign-off | Clean validate/generate logs | **BLOCKER** |
| **18. Old Vercel Project Review** | Metadata inventory review complete | docs/LEGACY_VERCEL_PROJECT_REVIEW.md | Implement owner-approved deconfliction option | Stray legacy environment leakage | Technical Owner | Deconfliction execution sign-off | Decommissioning report | **BLOCKER** |
