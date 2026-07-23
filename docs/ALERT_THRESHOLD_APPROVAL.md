# Alert Threshold Approval Package

## Overview
This document defines the proposed alert thresholds for the SMS v3 application. All proposed thresholds and staging baselines must be reviewed and approved by the respective organizational roles before production release.

## Threshold Matrix

| Signal Name | Staging Observed Baseline | Proposed Warning Threshold | Proposed Critical Threshold | Observation Window | Min Sample Requirement | Maintenance-Window Handling | False-Positive Guidance | Approving Owner Role | Approval Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Readiness Failure** | `[STAGING_BASELINE]` | 1 failure | 3 failures | 5 minutes | 1 request | Suppressed during deployments | Check database dependency status | Technical Owner | NOT APPROVED |
| **HTTP 5xx Rate** | `[STAGING_BASELINE]` | > 1% requests | > 5% requests | 10 minutes | 100 requests | Ignored during schema migrations | Verify third-party integration health | Technical Owner | NOT APPROVED |
| **Rate-Limit-Store HTTP 503** | `[STAGING_BASELINE]` | 1 failure | 5 failures | 5 minutes | 1 request | Suppressed during store maintenance | Check DB connection pool capacity | Database Owner | NOT APPROVED |
| **HTTP 429 Spike** | `[STAGING_BASELINE]` | > 50 denials | > 200 denials | 15 minutes | 10 requests | Excluded from scheduled load tests | Inspect client IP traffic pattern | Security Owner | NOT APPROVED |
| **Login Failure Spike** | `[STAGING_BASELINE]` | > 5 failures | > 20 failures | 10 minutes | 5 requests | Excluded during credential changes | Check for brute force indicators | Security Owner | NOT APPROVED |
| **Refresh Failure Spike** | `[STAGING_BASELINE]` | > 3 failures | > 15 failures | 10 minutes | 3 requests | Excluded during session migrations | Inspect JWT validation / rotation issues | Security Owner | NOT APPROVED |
| **Database Latency** | `[STAGING_BASELINE]` | > 200ms avg | > 1000ms avg | 5 minutes | 50 queries | Ignored during database maintenance | Verify locks and query execution plans | Database Owner | NOT APPROVED |
| **Function Timeout** | `[STAGING_BASELINE]` | 1 timeout | 5 timeouts | 10 minutes | 1 request | Suppressed during platform deployment | Verify serverless runtime settings | Technical Owner | NOT APPROVED |
| **Alert-Deduplication Store Failure** | `[STAGING_BASELINE]` | 1 failure | 3 failures | 5 minutes | 1 request | Suppressed during DB migration | Verify alert storage engine health | Technical Owner | NOT APPROVED |
| **Cleanup Failure** | `[STAGING_BASELINE]` | 1 failure | 2 failures | 24 hours | 1 execution | Excluded during scheduled DB outage | Verify cron service execution logs | Technical Owner | NOT APPROVED |
| **Backup Failure Placeholder** | `[STAGING_BASELINE]` | 1 failure | 2 failures | 24 hours | 1 execution | Excluded during backup storage migration| Check backup scripts and S3 connectivity | Backup Owner | NOT APPROVED |
