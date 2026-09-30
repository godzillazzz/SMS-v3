# G06 Controlled Geofence-only UAT

## Scope

This temporary mode is restricted in server code to the authenticated account whose database-linked employee code is exactly `UAT-ST-20260902`. The browser cannot select an employee or request the mode for another account.

The Production-only environment flag `G06_GEOFENCE_ONLY_UAT_ENABLED` is disabled unless its value is exactly `true`. It is also subordinate to `ATTENDANCE_API_PRODUCTION_ENABLED=true`. The flag is not read as enabled in Preview or other environments. This is a non-secret runtime switch; it introduces no new secret or database migration.

## Preserved checks

The server continues to require an active linked account, exactly one active registered Attendance device, a valid device-key signature over a short-lived challenge, the existing active Reference Photo authority binding, a current actionable assignment, an approved monthly schedule, effective site authority, and the existing QR/GPS policy. Location coordinates come from the browser's current location sample and are validated by the normal server geofence validator. Evidence and schedule/site authority are revalidated again when the event is accepted.

Only the live Face comparison and Face Active Challenge are skipped for this employee while the flag is enabled. The server does not trust a client-supplied employee code, success flag, verification mode, GPS result, or Face result. The mode receipt is HMAC-signed with the existing `JWT_SECRET`, expires within two minutes, and is bound to the user, employee, device, Reference Photo authority, event intent, capture ID, shift, and server-built context digest. The verified device proof is still required. Receipt consumption and event creation happen in the existing Attendance transaction; a Face Verification Session can be consumed only once.

## Event evidence

Accepted controlled events retain the current `AttendanceEvent` and required `FaceVerificationSession` relationship, but their `verificationSnapshot` and AuditLog explicitly record:

- `verificationMode: GEOFENCE_ONLY_UAT`
- `employeeCode: UAT-ST-20260902`
- `faceVerificationPerformed: false`
- `activeChallengePerformed: false`
- the registered device, site, server context, and device-proof time

The session status records device proof and receipt consumption; it does not claim that Face was verified. Event time remains server-received time. No synthetic or replayed Attendance event is created by the UAT path.

## Disable

Set `G06_GEOFENCE_ONLY_UAT_ENABLED` to `false` or remove it from the Production environment, then deploy/promote through the normal governed Production workflow. The flag must remain disabled for Preview. With the flag off, this route returns to the normal Face and Active Challenge requirements. Do not change global biometric settings to target this one employee.

G06 remains open until the Owner makes a real physical attempt inside the authorized site and the resulting session, event, and provenance are read-only verified.
