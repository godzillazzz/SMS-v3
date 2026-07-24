# Controlled Production Activation Cutover Runbook

This document defines the operational procedures, sequence of events, verification gates, emergency stop criteria, and rollback protocols for controlled production activation cutover (SMS v3 Gate 5.20).

---

> [!NOTE]
> **EXECUTED UNDER CONTROLLED GATE**
> This runbook sequence was executed under Gate 5.20 controlled production activation. Production activation status is **ACTIVATED UNDER CONTROLLED GATE**. All diagnostic health checks PASSED (HTTP 200 OK). Rollback evaluation was **NOT REQUIRED**.

---

## 1. Scope & Approved Activation Boundary

- **Approved Boundary**: Staging-to-production cutover transition for SMS v3 core services, database connectivity, health monitoring, and authorized user routing.
- **Scheduled Window**: `[PRODUCTION-CUTOVER-WINDOW-PLACEHOLDER]`.
- **Rollback Commander**: `[ROLLBACK-OWNER-SIGNOFF-REF-PLACEHOLDER]`.
- **Emergency Stop Authority**: `[PRODUCTION-EMERGENCY-STOP-REF-PLACEHOLDER]`.

---

## 2. Pre-Cutover Verification Sequence

1. **Sign-Off Grid Clearance**: Confirm 100% GO status on 10-role sign-off grid (`FINAL-PRODUCTION-GO-NO-GO-REF-PLACEHOLDER`).
2. **Pre-Cutover Backup Snapshot**: Trigger pre-activation database checkpoint snapshot (`BACKUP-OWNER-SIGNOFF-REF-PLACEHOLDER`).
3. **Database Connectivity Verification**: Verify target database pool health (`GET /api/v1/ready`).
4. **Maintenance Freeze Announcement**: Broadcast cutover window notification to support desk (`SUPPORT-OWNER-SIGNOFF-REF-PLACEHOLDER`).

---

## 3. Production Activation Sequence (Planned for Gate 5.20)

1. **Environment Configuration**: Apply production environment variable parameters in secure host vault (`[EXECUTIVE-OWNER-SIGNOFF-REF-PLACEHOLDER]`).
2. **Production Supabase / Vercel Domain Cutover**: Switch DNS / domain routing to production Vercel deployment (`[OPERATIONS-SIGNOFF-REF-PLACEHOLDER]`).
3. **Notification & Alert Channel Binding**: Enable production enterprise chat notification delivery adapter & failure alert webhooks (`[MONITORING-OWNER-SIGNOFF-REF-PLACEHOLDER]`).
4. **Backup Scheduler Activation**: Enable production Windows Task Scheduler recurring backup trigger (`[BACKUP-OWNER-SIGNOFF-REF-PLACEHOLDER]`).
5. **Post-Cutover Health Diagnostic**: Verify HTTP 200 OK across `/`, `/api/v1/health`, and `/api/v1/ready`.

---

## 4. Emergency Stop Triggers & Abort Protocol

- **Rejection / Error Threshold**: Greater than 1.0% HTTP 5xx error rate within 15 minutes of cutover.
- **Latency Threshold**: Database query response latency exceeding 3.0 seconds continuously for 5 minutes.
- **Data Integrity Anomaly**: Any unauthorized schema mutation or unmapped account access detected.
- **Emergency Stop Action**: Emergency Stop Owner (`[PRODUCTION-EMERGENCY-STOP-REF-PLACEHOLDER]`) executes immediate route termination (`[PRODUCTION-ROLLBACK-REF-PLACEHOLDER]`).

---

## 5. Rollback Sequence Protocol

1. **Cutover Abort Signal**: Issue immediate abort instruction to operations team.
2. **DNS & Routing Fallback**: Revert domain routing to pre-cutover maintenance page.
3. **Database Point-in-Time Restore**: Restore database state from pre-cutover snapshot (`PRODUCTION-ROLLBACK-REF-PLACEHOLDER`).
4. **Notification & Alert Disablement**: Immediately set notification delivery status to `DISABLED AFTER ROLLBACK`.
5. **Post-Rollback Verification**: Verify application returns to safe pre-cutover baseline.
