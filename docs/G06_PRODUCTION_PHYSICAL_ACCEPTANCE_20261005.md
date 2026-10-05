# G06 Production Physical Acceptance Closure — 2026-10-05

## Status

**CLOSED / ACCEPTED / PRODUCTION LIVE**

This record supplements the already-closed G06 release manifest with owner-supplied physical Production evidence from the employee iPhone/PWA flow.

## Accepted active scope

G06 Attendance is accepted with the simplified authority that is currently live:

- personal-device binding;
- secure offline queue/sync behavior;
- GPS/geofence validation;
- Schedule/Shift authority and audit/risk handling.

Face/QR is intentionally outside the active Attendance flow. Historical G06 Face/QR architecture documents remain reference material only and are not authority for the current Production Attendance experience.

## Physical Production evidence

Owner supplied an iPhone screenshot from the Production canonical host `sms-v3-staging-ten.vercel.app` during the 2026-10-05 acceptance conversation. The screen visibly shows:

- Shift `D 07:00–19:00`;
- network state `Online`;
- successful `ลงเวลาออก` / CHECK_OUT state with `บันทึกกับ Server`;
- expected schedule location displayed separately from the actual attendance location;
- actual attendance location `Site BV#AN2`;
- support-site rule flag `ASSIST_OTHER_SITE`;
- device state shown as `เครื่องหลัก`;
- GPS/GEOFENCE presented as a required pre-record validation;
- secure-offline capability surfaced as an encrypted queue;
- a direct link to the day's attendance history.

This is consistent with the implemented policy that Attendance records actual evidence while Schedule remains expected authority, and that a different valid Site can be preserved and flagged as `ASSIST_OTHER_SITE` instead of silently rewriting the scheduled Site.

## Acceptance interpretation

The physical evidence closes the remaining user-facing Production acceptance gap for the normal online PWA flow:

1. the employee can reach the canonical Production Attendance surface on the physical iPhone;
2. the device is recognized as the primary device;
3. the location/site path does not silently overwrite schedule authority;
4. a cross-site event remains visible and receives the expected review/risk classification;
5. the checkout result is committed to the Server and presented as successful to the employee.

The screenshot is owner-supplied physical evidence. It is not an independent attestation of the employee's physical location and does not expose GPS coordinates, cryptographic material, credentials, or personal identifiers.

## Non-blocking limitation

This screenshot is an **online** CHECK_OUT acceptance. It is not a physical offline-mode acceptance. Offline behavior remains covered by the shipped encrypted-queue/sync contracts and tests, but a separate field exercise may still be run later as resilience validation. It is not a blocker for the G06 CLOSED status.

The existing bounded Production diagnostic tool currently pins an older immutable Production deployment guard. It was therefore **not** re-run against this event; fail-closed guard behavior was preserved rather than weakened for closure documentation.

## Final decision

**G06 is CLOSED.**

No Production schedule, monthly approval, security policy, Environment variable, database record, or device assignment was changed to obtain this evidence.
