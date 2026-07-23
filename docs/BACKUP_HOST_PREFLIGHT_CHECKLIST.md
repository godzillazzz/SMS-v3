# Backup Host Preflight Checklist

## Overview
This document represents the preflight verification checklist required before scheduling automated backup tasks on a target execution host. 

> [!IMPORTANT]
> All items must be verified and resolved. Unresolved items are **production blockers**.

## Preflight Verification Checklist

| Checklist Item / Area | Requirement / Verification Target | Observed Status / Target | Blocker Status |
| :--- | :--- | :--- | :--- |
| **Approved Host Identity** | Host must match approved inventory identifier | `[HOST_IDENTITY_PLACEHOLDER]` | PRODUCTION BLOCKER |
| **Operating System & Patches** | OS must be patched according to corporate policy | `[OS_PATCH_STATUS_PLACEHOLDER]` | PRODUCTION BLOCKER |
| **Time Synchronization** | Host clock must synchronize to NTP server | `[NTP_STATUS_PLACEHOLDER]` | PRODUCTION BLOCKER |
| **PostgreSQL Client Tools** | `pg_dump` and `pg_restore` versions >= database version | `[PG_CLIENT_VERSION_PLACEHOLDER]` | PRODUCTION BLOCKER |
| **Installed Encryption Tool** | GnuPG (gpg) version >= 2.2 installed | `[GPG_VERSION_PLACEHOLDER]` | PRODUCTION BLOCKER |
| **Approved Service Account** | Dedicated non-interactive OS user account | `[SERVICE_ACCOUNT_PLACEHOLDER]` | PRODUCTION BLOCKER |
| **Network Access to DB** | Direct firewall permit rule for DB port 5432 | `[FIREWALL_DB_PLACEHOLDER]` | PRODUCTION BLOCKER |
| **Network Access to Storage** | Direct firewall/SMB permit rule to approved NAS | `[FIREWALL_NAS_PLACEHOLDER]` | PRODUCTION BLOCKER |
| **Least-Privilege Access** | Service account restricted to backup/transfer directories | `[ACL_PRIVILEGE_PLACEHOLDER]` | PRODUCTION BLOCKER |
| **Host Disk Space** | At least 3x database size free on host temp drive | `[HOST_FREE_SPACE_PLACEHOLDER]` | PRODUCTION BLOCKER |
| **Backup Destination Capacity**| NAS directory storage capacity verified | `[NAS_FREE_SPACE_PLACEHOLDER]` | PRODUCTION BLOCKER |
| **File Permissions** | Read-write permissions limited strictly to service account | `[FILE_ACL_PLACEHOLDER]` | PRODUCTION BLOCKER |
| **Malware / EDR Compatibility**| Endpoint security/EDR exclusions configured for pg_dump | `[EDR_COMPATIBILITY_PLACEHOLDER]` | PRODUCTION BLOCKER |
| **Logging Location** | Standard NDJSON file writable on host | `[LOG_WRITABILITY_PLACEHOLDER]` | PRODUCTION BLOCKER |
| **Scheduler Availability** | Windows Task Scheduler or cron daemon status ACTIVE | `[SCHEDULER_STATUS_PLACEHOLDER]` | PRODUCTION BLOCKER |
| **Restore Rehearsal Target** | Clean, isolated disposable target database available | `[REHEARSAL_DB_PLACEHOLDER]` | PRODUCTION BLOCKER |
| **Monitoring Dependency** | Ingestion agent active on execution host | `[MONITORING_AGENT_PLACEHOLDER]` | PRODUCTION BLOCKER |
| **Maintenance Window** | Scheduled execution mapped to off-peak business hours | `[MAINTENANCE_WINDOW_PLACEHOLDER]` | PRODUCTION BLOCKER |
| **Rollback / Disabling** | Script or task disabling procedure verified | `[DISABLING_METHOD_PLACEHOLDER]` | PRODUCTION BLOCKER |
