# Employee Lifecycle Management V1

## Identity and state

- `Employee.id` remains the immutable employee identity for name, department, position, termination, and rehire changes.
- `Employee` stores the current master state. `EmployeeLifecycleEvent` stores immutable effective-dated old/new snapshots and the actor, reason, recorded time, idempotency key, and application status.
- Existing employees are treated as a current-state baseline. The migration does not fabricate historical events that cannot be proven.
- Future events remain `PENDING` and are applied sequentially on authenticated application traffic when their Bangkok effective date arrives. Authentication performs an additional employee-targeted synchronization so an effective termination cannot issue or retain a valid session.

## Historical report classification

| Area | Classification | Department/name source |
| --- | --- | --- |
| Employee directory, Dashboard workforce, user administration | Current state | Current `Employee`/`User` master |
| Schedule and approved schedule export/PDF | Historical snapshot | `ShiftAssignment.employeeNameSnapshot` and `departmentSnapshot` |
| Leave history and leave notifications | Historical snapshot | `LeaveRequest.employeeNameSnapshot` and `departmentSnapshot` |
| Executive Report workforce | As-of report | Lifecycle state at period end, capped at today; excludes employees hired after the as-of date |
| Executive Report schedule and leave | Historical snapshot | Schedule/leave department snapshot |
| Executive Report license and Data Quality | Current state | Current Employee relation and current document status; V1 does not claim historical license/Data Quality state |
| License and license documents | Current ownership | Immutable `employeeId`; expiry and document history are not rewritten |
| Leave quota | Current ownership with legacy snapshot | Linked rows remain on `employeeId`; unmatched legacy rows keep their existing snapshot and matching status |

## Transaction and dependency policy

- Lifecycle creation, current Employee update, linked User synchronization, session revocation, lifecycle event, and AuditLog entries use one serializable Prisma transaction and transaction client.
- Preflight performs a fixed sequence of dependency counts for future shifts, pending/approved leave, quotas, active licenses, license documents, and linked User state.
- Future schedules, leave, quotas, licenses, and documents are never deleted or reassigned automatically. ADMIN receives warnings and performs operational follow-up explicitly.
- Ordinary Employee update/delete endpoints reject lifecycle-controlled fields and termination attempts.

## Remaining legacy risks

- Legacy unmatched leave quota rows can still depend on `employeeNameSnapshot` until explicitly linked; lifecycle actions do not guess or relink them by name.
- Existing records created before snapshot fields were populated cannot gain historical truth retroactively.
- User registration still starts from email verification and current Employee data, but ownership is persisted with `employeeId`; lifecycle synchronization never matches User by name.
- Current-state license and Data Quality reports are intentionally not historical as-of reports in V1.
- Effective events require application traffic to be applied; no cron or new scheduler is introduced. Targeted authentication synchronization enforces access termination at first attempted use on or after the effective date.
