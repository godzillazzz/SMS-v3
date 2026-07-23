# Real-Data Import Field Mapping Package

This document defines the field mapping specifications, validation standards, deduplication logic, and rejection handling rules required for any future real-data import into SMS v3.

---

## 1. Entity Field Mapping Matrix

| Source Field Placeholder | Target Entity & Field | Field Type | Data Category | Requirement Level | Mapping Rule & Validation Standard |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `SRC_EMP_ID` | `Employee.employeeId` | String | Identifier | Required | Unique Employee ID constraint (`IMPORT-MAPPING-PLACEHOLDER`) |
| `SRC_FULL_NAME` | `Employee.fullName` | String | PII | Required | Non-null, max 100 chars, sanitized whitespace |
| `SRC_WORK_EMAIL` | `Employee.email` | String | PII | Required | RFC 5322 syntax validation & unique index |
| `SRC_ROLE` | `Employee.role` | Enum | RBAC | Required | Map to RBAC enum (`DRIVER`, `DISPATCHER`, `MANAGER`, `ADMIN`) |
| `SRC_DEPT` | `Employee.department` | String | Organizational | Required | Map to approved department master list |
| `SRC_PHONE` | `Employee.phone` | String | PII | Optional | E.164 phone format validation |
| `SRC_HIRE_DATE` | `Employee.hireDate` | Date | HR Attribute | Optional | ISO-8601 date string validation |
| `SRC_STATUS` | `Employee.isActive` | Boolean | HR Attribute | Required | Active status boolean (`true`/`false`) |
| `SRC_SECRET` | *PROHIBITED* | N/A | Sensitive | Prohibited | Passwords/bank details rejected & unmapped |

---

## 2. Special Handling & Rejection Rules
- **Source System Reference**: `REAL-DATA-SOURCE-PLACEHOLDER`.
- **Duplicate Detection**: Deduplication matched against normalized `email` and `employeeId` indexes (`IMPORT-MAPPING-PLACEHOLDER`).
- **Inactive / Terminated Employees**: Terminated employees imported as `isActive=false` with zero active credentials or session tokens.
- **Audit Logging**: All imported rows tagged with `createdAt`, `createdBy`, `updatedAt`, and `importBatchId`.
- **Rejection Handling**: Malformed or duplicate rows quarantined to `import_rejection_audit.log` while valid records proceed atomically.

---

## 3. Package Recommendation & Safety Status
- **Mapping Package Status**: **READY FOR OWNER DRY-RUN ACCEPTANCE**.
- **Real Employee Data Import Status**: **NOT IMPORTED / NOT APPROVED**.
- **Production Readiness**: **NOT APPROVED**.
