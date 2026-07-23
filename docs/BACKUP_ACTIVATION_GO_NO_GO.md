# Backup Activation Go/No-Go Decision Package

## Overview
This document outlines the required sign-offs and go/no-go criteria necessary before activating automated database backups on the production-equivalent host.

> [!IMPORTANT]
> Activation status: **NOT APPROVED**
> This package must be formally reviewed and signed by all designated owners.

## 1. Required Approval Gates

| Approver Role | Responsibility | Approval Status | Sign-off Date |
| :--- | :--- | :--- | :--- |
| **Application Owner** | Business release authorization | PENDING - NOT APPROVED | `[DATE]` |
| **Database Owner** | DB performance & access approval | PENDING - NOT APPROVED | `[DATE]` |
| **Infrastructure Owner** | Windows Server / NAS hosting sign-off | PENDING - NOT APPROVED | `[DATE]` |
| **Security Owner** | Encryption key custody and compliance | PENDING - NOT APPROVED | `[DATE]` |
| **Privacy/PDPA Owner** | Data compliance & retention sign-off | PENDING - NOT APPROVED | `[DATE]` |
| **Backup Owner** | Script maintenance & task management | PENDING - NOT APPROVED | `[DATE]` |
| **Restore-Test Owner** | Weekly dry-run rehearsal verification | PENDING - NOT APPROVED | `[DATE]` |
| **Notification-Channel Owner**| Alert routing destination configuration | PENDING - NOT APPROVED | `[DATE]` |

## 2. Go/No-Go Verification Criteria

| Go/No-Go Test Case | Description / Verification Target | Expected Result | Pass / Fail |
| :--- | :--- | :--- | :--- |
| **Dry-Run Success** | Execute backup script with `--dry-run` parameter | Creates dry-run log entry; no backup file generated | PENDING |
| **Encrypted Backup Success** | Execute manual backup and encrypt with symmetric key | Output `.enc` file created; raw dump removed | PENDING |
| **Checksum Verification** | Generate and verify SHA-256 hash against encrypted file | Checksums match exactly | PENDING |
| **Isolated Restore Success** | Restore test dump on clean, disposable target schema | Restore completes without schema or dependency errors | PENDING |
| **Retention Cleanup Test** | Simulate expired file presence in target directory | Expired test files purged; unexpired files retained | PENDING |
| **Failure-Notification Test** | Trigger backup failure (e.g. invalid host environment) | Sanitized error log created; alert notification sent | PENDING |
| **Evidence Capture** | Verify audit log records contain correct parameters | Success/failure states appended to central audit NDJSON | PENDING |
| **Rollback Readiness** | Verify disabling procedure for task scheduler | Task successfully disabled; no scheduled executions run | PENDING |
