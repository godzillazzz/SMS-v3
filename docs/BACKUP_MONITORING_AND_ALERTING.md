# Backup Monitoring and Alerting

## Overview
This document specifies the telemetry signals, logging endpoints, and alert routing configurations for monitoring database backup operations.

> [!IMPORTANT]
> Alert notification delivery remains **PENDING** until the organization authorizes a target notification channel under the Gate 5.6 operational approval matrix.

## Telemetry Signals & Staging Thresholds

| Telemetry Signal | Description / Trigger | Recommended Warning Threshold | Recommended Critical Threshold | Observation Window | Min Sample Requirement |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Backup Job Success** | Emitted when backup completes and matches checksum | N/A (Status logging only) | N/A | Once per run | 1 execution |
| **Backup Job Failure** | Logical dump (`pg_dump`) exits with non-zero status | 1 failure | 2 consecutive failures | 24 hours | 1 execution |
| **Checksum Failure** | Calculated checksum does not match generated hash | N/A | 1 checksum mismatch | Immediate | 1 validation |
| **Encryption Failure** | symmetric cipher encryption command exits with error | 1 failure | 1 failure | Immediate | 1 execution |
| **Copy / Storage Failure**| Disk space shortage or target NAS directory inaccessible | 1 write error | 2 consecutive write errors | 24 hours | 1 execution |
| **Retention Cleanup Failure**| Cleanup routine fails to purge expired backup dumps | 1 failure | 3 consecutive failures | 72 hours | 1 execution |
| **Restore Rehearsal Failure**| Validation restoration on disposable instance fails | 1 warning | 1 critical failure | Weekly | 1 validation |
| **Backup Age Too Old** | Current time exceeds age of latest complete backup file | > 30 hours | > 48 hours | 24 hours | 1 check |

## Notification Policy
All alerts will write to the standard NDJSON results log. Once a real notification channel is selected and approved (e.g. Chat, Email, or SIEM), alert states will route dynamically to the designated owner.
