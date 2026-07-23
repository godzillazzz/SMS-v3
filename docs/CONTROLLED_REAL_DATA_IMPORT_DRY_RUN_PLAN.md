# Controlled Real-Data Import Dry-Run Plan

This document details the rehearsal workflow, synthetic data scope, validation logic, and aggregate results for the controlled real-data import dry-run rehearsal.

---

## 1. Dry-Run Rehearsal Workflow & Scope (SYNTHETIC / SAMPLE ONLY)

> [!IMPORTANT]
> This dry-run rehearsal uses **100% SYNTHETIC / SAMPLE DATA ONLY**. No real employee data or live files were used or processed.

| Step | Rehearsal Stage | Operational Procedure | Evidence Reference | Rehearsal Result |
| :--- | :--- | :--- | :--- | :--- |
| **01** | **Input Source Ingestion** | Ingest 100 synthetic employee sample rows (`REAL-DATA-SOURCE-PLACEHOLDER`) | `IMPORT-DRY-RUN-EVIDENCE-REF-PLACEHOLDER` | **PASSED (SYNTHETIC)** |
| **02** | **Schema & Field Parsing**| Parse attributes against `Employee` model mapping (`IMPORT-MAPPING-PLACEHOLDER`) | `IMPORT-DRY-RUN-EVIDENCE-REF-PLACEHOLDER` | **PASSED (SYNTHETIC)** |
| **03** | **Constraint Validation** | Verify unique index constraints on `email` and `employeeId` | `IMPORT-DRY-RUN-EVIDENCE-REF-PLACEHOLDER` | **PASSED (SYNTHETIC)** |
| **04** | **Rejection Quarantine** | Quarantine 5 intentional malformed/duplicate synthetic test rows | `IMPORT-DRY-RUN-EVIDENCE-REF-PLACEHOLDER` | **PASSED (SYNTHETIC)** |
| **05** | **Audit Trail Logging** | Record transactions tagged with `importBatchId` into NDJSON stream | `IMPORT-DRY-RUN-EVIDENCE-REF-PLACEHOLDER` | **PASSED (SYNTHETIC)** |
| **06** | **Rollback Simulation** | Simulate transaction abort & database snapshot restore | `IMPORT-ROLLBACK-OWNER-PLACEHOLDER` | **PASSED (SYNTHETIC)** |

---

## 2. Aggregate Dry-Run Results Classification
- **Synthetic Records Processed**: 100 sample rows.
- **Synthetic Accepted Count**: 95 valid synthetic records (95%).
- **Synthetic Rejected Count**: 5 malformed/duplicate synthetic test records quarantined (5%).
- **Validation Execution**: **PASSED**.
- **Rollback Simulation**: **PASSED**.
- **Audit Trail Logging**: **SIMULATED / PASSED**.

---

## 3. Mandatory Safety Statement
- **Real Employee Data Status**: **NOT IMPORTED / NOT APPROVED**.
- **Production Activation Status**: **NOT ACTIVATED**.
- **Production Readiness**: **NOT APPROVED**.
