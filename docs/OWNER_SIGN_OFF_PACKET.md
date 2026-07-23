# Owner Sign-off Packet

This document outlines the formal staging acceptance sign-off requirements for organizational review. All approvals default to **NOT APPROVED** and require manual confirmation of target evidence.

---

## 1. Sign-off Grid

| Approving Role | Review Scope | Required Evidence | Approval Decision | Restrictions / Scope Bounds | Sign-off Date |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Business Owner** | Commercial alignment and release authorization | Completed staging pilot report and gap analysis | DEFAULT: **NOT APPROVED** | No production user onboarding until GO | `[DATE]` |
| **Application Owner** | System usability and functional acceptance | Functional walkthrough of core UI workflows | DEFAULT: **NOT APPROVED** | Staging environment only | `[DATE]` |
| **Technical Owner** | System design and dependency compliance | Repository cleanliness, dependency audits, build logs | DEFAULT: **NOT APPROVED** | No code alterations permitted | `[DATE]` |
| **Database Owner** | DB schema constraints, migrations, access control | Schema diagram, access logs, query statistics | DEFAULT: **NOT APPROVED** | Restricted to staging credentials | `[DATE]` |
| **Infrastructure Owner**| Vercel staging deployment and environment variables | Configuration files review, build pipelines logs | DEFAULT: **NOT APPROVED** | Read-only access verification | `[DATE]` |
| **Security Owner** | Encryption, cookies, CSRF, vulnerability metrics | SAST/DAST scanner report, JWT token validations | DEFAULT: **NOT APPROVED** | No external domains attached | `[DATE]` |
| **Privacy/PDPA Owner** | Personal data lifecycle and logging sanitization | Log audits, DB schema data processing map | DEFAULT: **NOT APPROVED** | Zero real employee data imported | `[DATE]` |
| **Backup Owner** | Backup template validity and restore rehearsals | Test harness outputs, script dry-run logs | DEFAULT: **NOT APPROVED** | No active task scheduling on NAS | `[DATE]` |
| **Monitoring Owner** | Telemetry tracking and alert policies | Active dashboards, test notification traces | DEFAULT: **NOT APPROVED** | No real notifications enabled | `[DATE]` |
| **Incident Commander** | Operational ownership, escalation, runbooks | On-call rota schedule, tabletop simulation report| DEFAULT: **NOT APPROVED** | Dry-run simulations only | `[DATE]` |
