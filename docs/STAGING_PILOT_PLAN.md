# Staging Pilot Plan

## Overview
This document outlines the controlled staging pilot plan for the SMS v3 application. The pilot must run strictly on the staging environment using synthetic sample data only.

## 1. Scope & Permitted Users
- **Environment**: Staging (`sms-v3-staging.vercel.app`).
- **Data Scope**: Synthetic mock employee records. No real personal identifier information (PII) permitted.
- **Permitted Users**: Authorized tester roles only:
  - `[TESTER_ADMIN_ROLE]`
  - `[TESTER_HR_ROLE]`
  - `[TESTER_USER_ROLE]`

## 2. Test Scenarios
- **Scenario A: Session Management**: Verify login, token refresh rotation, and logout behaviors under active session count limits.
- **Scenario B: Employee Lifecycle CRUD**: Verify creating, reading, updating, and soft-deleting synthetic employee files.
- **Scenario C: Rate Limiting Suppression**: Simulate 10+ failed login attempts from a single client to trigger rate limiter HTTP 429 response.
- **Scenario D: Shared Deduplication**: Simulate duplicate synthetic telemetry alerts to verify PostgreSQL deduplication and active cooldown suppression.

## 3. Evaluation Criteria
- **Success Criteria**:
  - 100% of core test scenarios execute without throwing unhandled exceptions.
  - Average HTTP response latency < 200ms.
  - Rate limiting blocks requests after configured limits.
  - Audit records append to `audit_logs` correctly.
- **Failure Criteria**:
  - Any HTTP 5xx error rate > 1% over the pilot window.
  - Failure to clean up temporary mock files.
  - Secrets or credentials leaked in logged outputs.

## 4. Evidence Collection & Rollback
- **Evidence**: Collect anonymized NDJSON application logs, test coverage reports, and database query latency records.
- **Rollback Procedure**:
  - Trigger immediate script-based database schema cleaning:
    ```bash
    npm run prisma:migrate -- --name reset
    ```
  - Purge Vercel deployment caches and redeploy baseline stable build.

## 5. Communication Plan
- **Pre-Pilot Notification**: Broadcast to `[TESTING_COMMUNICATION_CHANNEL]` before starting.
- **Incident Escalation**: Report runtime errors directly to `[TECHNICAL_OWNER_ROLE]`.
- **Completion Report**: Send results summary to `[APPLICATION_OWNER_ROLE]` for sign-off.
