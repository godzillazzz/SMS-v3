# Legacy Vercel Project Safe Review and Deconfliction Plan

## 1. Approved Project Summary
- **Target Project Name**: `sms-v3-staging`
- **Deployment Status**: Active and operational
- **Approved Staging Alias**: `sms-v3-staging-ten.vercel.app`
- **Linked Git Repository**: `godzillazzz/SMS-v3`

---

## 2. Legacy Project Safe Inventory
A separate, read-only metadata audit of the separate Vercel project was performed. No changes were executed.

- **Project Existence**: YES (observed project named `sms-v3`).
- **Linked Git Repository**: `godzillazzz/SMS-v3` (same root repository reference).
- **Deployment Status**: Inactive / historic.
- **ERROR Deployments**: YES (historic failed build deployments exist in logs).
- **Custom Domains**: None observed (placeholder/Vercel standard subdomain alias only).
- **Environment Variable Names**: Connection and secret name placeholders exist. No values were read.
- **Deployment Protection**: Appears enabled / default.
- **Operator Confusion Risk**: YES (due to name similarity `sms-v3` vs `sms-v3-staging`).

---

## 3. Risk Classification
- **Risk Level**: **MEDIUM**
- **Confidence Level**: **HIGH**
- **Evidence/Rationale**: The project names are highly similar, which could lead operators to run CLI commands against the wrong target (e.g. configuring env variables or running deploys). However, there are no custom production domains attached to `sms-v3` that overlap with staging traffic, and no evidence suggests any current production user traffic is hitting this legacy project.

---

## 4. Deconfliction Options (Owner Approval Required)
The following options are defined. No option may be executed without direct sign-off from the Application and Technical Owners.

### Option 1: Rename Legacy Project (Recommended)
- **Action**: Rename the legacy Vercel project from `sms-v3` to `sms-v3-legacy-do-not-use` via Vercel dashboard.
- **Pros**: Instantly prevents CLI target confusion; preserves historic configuration if needed.
- **Rollback**: Rename back to `sms-v3`.
- **Constraint**: Must not change environment secrets or linked repository settings.

### Option 2: Remove Unused Domains
- **Action**: Audit and remove any custom domain names associated with the legacy project.
- **Pros**: Prevents DNS/alias confusion.
- **Rollback**: Re-add domains and verify DNS TXT record ownership.

### Option 3: Decommission / Delete Project
- **Action**: Permanently delete the legacy Vercel project `sms-v3`.
- **Pros**: Complete removal of target risk.
- **Rollback**: None (requires complete manual reconfiguration).

---

## 5. Next Steps
- Status remains **BLOCKED** pending owner review.
- Do not modify Vercel project configurations or environment variables during this gate.
