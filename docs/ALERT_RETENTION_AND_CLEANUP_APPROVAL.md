# Alert Retention and Cleanup Approval Package

## Overview
This document outlines the proposed policies for alert-deduplication record retention, cleanup activities, and telemetry evidence storage for the SMS v3 application. 

> [!IMPORTANT]
> Automated cleanup scheduling is **not yet approved**. No automated cleanup cron jobs have been scheduled or activated on the hosted staging database during this gate.

## Retention and Cleanup Policy Table

| Requirement / Placeholder Field | Proposed Value | Approving Owner Role | Approval Status |
| :--- | :--- | :--- | :--- |
| **Alert-Deduplication Record Retention** | 30 days after expiry | Privacy/PDPA Owner | NOT APPROVED |
| **Cleanup Frequency** | Every 24 hours | Technical Owner | NOT APPROVED |
| **Cleanup Owner** | `[CLEANUP_OWNER_ROLE]` | Technical Owner | NOT APPROVED |
| **Cleanup-Failure Escalation** | Escalates to database owner if fail count >= 2 | Database Owner | NOT APPROVED |
| **Monitoring Evidence Location** | `[SECURE_MONITORING_BUCKET]` | Security Owner | NOT APPROVED |
| **Evidence Retention Period** | 90 days | Security Owner | NOT APPROVED |
| **Access-Control Owner** | `[ACCESS_CONTROL_ROLE]` | Security Owner | NOT APPROVED |
| **Deletion Approval** | Required prior to purging evidence | Privacy/PDPA Owner | NOT APPROVED |
| **Incident Legal-Hold Procedure** | Freeze cleanup operations on relevant hashes | Privacy/PDPA Owner | NOT APPROVED |

## Remaining Limitations
Until organization representatives authorize this package:
- Retention periods and automated cleanup scripts remain inactive or manual.
- Legal-hold mechanisms are not deployed.
