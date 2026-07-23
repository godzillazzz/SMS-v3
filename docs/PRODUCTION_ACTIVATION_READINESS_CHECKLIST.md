# Production Activation Readiness Checklist

This checklist tracks the technical, operational, and compliance readiness items required prior to any future production activation of SMS v3.

---

## 1. Production Activation Checklist Items

| Item | Dimension | Verification Standard | Evidence Placeholder | Status |
| :--- | :--- | :--- | :--- | :--- |
| **01** | **Owner Approvals** | 10 operational role sign-offs collected | `PRODUCTION-GO-NO-GO-REF-PLACEHOLDER` | **PLANNING APPROVED (NOT ACTIVATED)** |
| **02** | **Data Owner Approval** | Data import authorization signed | `REAL-DATA-OWNER-APPROVAL-REF-PLACEHOLDER` | **DRY-RUN ACCEPTED W/ RESTRICTIONS (NOT IMPORTED)** |
| **03** | **PDPA Approval** | Privacy audit compliance certificate signed | `PDPA-APPROVAL-REF-PLACEHOLDER` | **OPEN / NOT APPROVED** |
| **04** | **Security Sign-Off** | Penetration test report (zero high findings)| `SECURITY-SIGNOFF-REF-PLACEHOLDER` | **OPEN / NOT APPROVED** |
| **05** | **Production Env Readiness** | Production Supabase & Vercel active | `INTERNAL-EVIDENCE-REF-PLACEHOLDER` | **OPEN / NOT APPROVED** |
| **06** | **Production Backup Readiness**| Host & NAS share writable | `BACKUP_HOST_PLACEHOLDER` / `BACKUP_STORAGE_PLACEHOLDER` | **OPEN / NOT APPROVED** |
| **07** | **Production Key Custody** | Production GnuPG keys registered in vault | `VAULT_SECRET_REFERENCE_PLACEHOLDER` | **OPEN / NOT APPROVED** |
| **08** | **Notification Readiness** | Enterprise chat production channel mapped | `ENTERPRISE_CHAT_DESTINATION_PLACEHOLDER` | **OPEN / NOT APPROVED** |
| **09** | **Failure Alert Readiness** | Backup failure alert triggers bound | `BACKUP_FAILURE_ALERT_PLACEHOLDER` | **OPEN / NOT APPROVED** |
| **10** | **Restore Governance** | Weekly rehearsal task configured | `INTERNAL-EVIDENCE-REF-PLACEHOLDER` | **OPEN / NOT APPROVED** |
| **11** | **Monitoring & Logs** | Central NDJSON log sink active | `INTERNAL-EVIDENCE-REF-PLACEHOLDER` | **OPEN / NOT APPROVED** |
| **12** | **Rollback Owners** | Assigned rollback & emergency owners | `PRODUCTION-ROLLBACK-OWNER-PLACEHOLDER` | **OPEN / NOT APPROVED** |
| **13** | **User Communication** | Cutover maintenance window notice published | `PRODUCTION-CUTOVER-WINDOW-PLACEHOLDER` | **OPEN / NOT APPROVED** |

---

## 2. Overall Readiness Summary
- **Total Checklist Items**: 13
- **Cleared Items**: 0 (Staging controls cleared conditionally in Gate 5.12A)
- **Open Items**: 13
- **Overall Production Activation Status**: **NOT APPROVED**.
