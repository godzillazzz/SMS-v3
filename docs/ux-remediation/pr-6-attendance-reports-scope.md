# PR-6 — Attendance-control UX and reports

## Owner requirements
- Keyboard-shortcut state matrix and feedback.
- Today, Print All, and per-employee attendance reports.
- One employee per print sheet; authorization-scoped, read-only output.
- Responsive attendance table/type scale remediation.

## Safety boundaries
Print must never clock attendance, approve, save or mutate data. Preserve GPS/geofence/offline enforcement and RBAC.
