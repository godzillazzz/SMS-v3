# Production Approval Roadmap

## Overview
This document defines the structured roadmap of approval phases required to transition the SMS v3 application from staging to production. All owners are referenced by roles only.

---

## Phase 1: Organizational Owner Assignment
- **Prerequisite Evidence**: Unresolved role placeholders in `docs/OPERATIONAL_OWNERSHIP.md`.
- **Responsible Owner Role**: Application Owner
- **Expected Output**: Finalized mapping of operational roles to internal staff in secure registry.
- **Go/No-Go Criteria**: 
  - **Go**: All 10 operational roles assigned primary and backup representatives.
  - **No-Go**: Missing representation for any critical operational role.
- **Rollback / Stop Condition**: Halt progress and escalate to Application Owner if staffing assignment is blocked.

---

## Phase 2: Privacy and Security Review
- **Prerequisite Evidence**: Staging security controls verified; clean dependency audits.
- **Responsible Owner Role**: Security Owner & Privacy/PDPA Owner
- **Expected Output**: Completed SAST/DAST report and PDPA compliance sign-off.
- **Go/No-Go Criteria**:
  - **Go**: Zero high/medium vulnerability findings; PDPA data flow mapped and approved.
  - **No-Go**: Open security vulnerability or non-compliant personal data processing.
- **Rollback / Stop Condition**: Revert to staging security isolation and fix identified code/policy defects.

---

## Phase 3: Backup and Notification Activation
- **Prerequisite Evidence**: Verified script templates in `scripts/backup/` and alert matrix in `docs/MONITORING_ALERT_MATRIX.md`.
- **Responsible Owner Role**: Backup Owner & Notification-Channel Owner
- **Expected Output**: Active scheduling on approved Windows/NAS host and chosen real alerting destination.
- **Go/No-Go Criteria**:
  - **Go**: Automated dry-run backup succeeds; synthetic notification alerts successfully route.
  - **No-Go**: Backup failure exits with zero; secrets or connection variables leaked in log records.
- **Rollback / Stop Condition**: Revert `ALERTING_ENABLED=false` on Vercel and disable Task Scheduler on backup host.

---

## Phase 4: Controlled Staging Pilot with Sample Data
- **Prerequisite Evidence**: Staging-only deployment operational; mocked tests passing.
- **Responsible Owner Role**: Monitoring Owner & Technical Owner
- **Expected Output**: Staging pilot execution logs and metrics analysis.
- **Go/No-Go Criteria**:
  - **Go**: Successful execution of user workflows with sample data; active deduplication verified.
  - **No-Go**: High error rate (>1% 5xx) or system latency spikes.
- **Rollback / Stop Condition**: Purge staging pilot databases and redeploy baseline stable build.

---

## Phase 5: Real-Data Migration Approval
- **Prerequisite Evidence**: Approved staging pilot report; signed PDPA data import sheet.
- **Responsible Owner Role**: Database Owner & Privacy/PDPA Owner
- **Expected Output**: Executed migration scripts and verified data counts.
- **Go/No-Go Criteria**:
  - **Go**: Validation script shows database consistency; zero data leakage detected.
  - **No-Go**: Integrity violation, data corruption, or unapproved records imported.
- **Rollback / Stop Condition**: Restore database state to pre-migration baseline from cold snapshot.

---

## Phase 6: Production Go/No-Go Decision
- **Prerequisite Evidence**: Phase 1-5 approvals signed off.
- **Responsible Owner Role**: Application Owner & Business Owner
- **Expected Output**: Signed production go-decision form.
- **Go/No-Go Criteria**:
  - **Go**: All 10 approval gates signed; all tests pass; operational controls operational.
  - **No-Go**: Any single unresolved blocker in production readiness register.
- **Rollback / Stop Condition**: Retain staging-only state and defer production routing.
