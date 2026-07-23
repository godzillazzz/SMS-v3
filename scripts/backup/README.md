# Backup Script Skeletons

## Overview
This folder contains PowerShell script templates for manual or scheduled backups and restore rehearsals.

> [!WARNING]
> These templates use placeholders only. They are not executable production schedules and must never contain real credentials or production parameters.

## Files
- `backup.example.ps1`: Script template for running pg_dump, generating checksums, encrypting backups, and purging expired files.
- `restore-rehearsal.example.ps1`: Script template for decrypting dumps, verifying checksum integrity, and simulating a restore on a clean target schema.
