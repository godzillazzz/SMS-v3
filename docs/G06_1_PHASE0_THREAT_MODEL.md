# G06.1 — Phase 0 threat model and compatibility audit

**Status:** Phase 0 (analysis only — no implementation, no schema, no Production change)
**Scope owner:** security guard attendance (61 staff · 19 sites · 95 checkpoints)
**Date:** 18 Oct 2026
**Non-goals (by design):** face recognition and QR scanning are removed from the product; this model
does not reintroduce them and does not treat their absence as a gap.

---

## 1. What we are protecting

| Asset | Why it matters | Where it lives |
|---|---|---|
| Attendance record (check-in/out, shift, site) | Payroll and legal evidence | `attendance_events`, `attendance_adjustment_requests` |
| Device binding (which phone belongs to which guard) | Stops one person clocking in for another | `attendance-simple.service.js` (`ACCOUNT_DEVICE_GPS_GEOFENCE_V1`, `PRIMARY`/`FOREIGN` bindings) |
| Location proof (geofence radius per site) | Stops remote "attendance" | `attendance-event.service.js` (`geofenceRadiusMeters`), `attendance-verification-context.service.js` |
| Offline queue on the phone | Must not become an unverified back door | `attendance-simple-offline-sync` |
| Session/token | Grants role authority | auth middleware, refresh sessions |
| Approval chain | Final authority must stay with ADMIN | `attendance-adjustment.service.js` |

**Trust boundaries:** phone (untrusted, often shared in a guard house) → mobile network (untrusted)
→ Vercel edge/function (trusted) → Postgres (trusted, single production database).

## 2. Threat catalogue

Each row states the attack, the control that exists today (**verified in code**), the residual risk,
and the evidence Phase 0 must produce before implementation continues.

| ID | Attack | Control in code today | Residual risk | Phase 0 evidence required |
|---|---|---|---|---|
| G061-01 | Buddy punching: guard A clocks in on guard B's phone | Device binding marks the second device `FOREIGN` with `DEVICE_MISMATCH`; transfer requires ADMIN approval | A shared family phone legitimately bound to one guard | Physical test: two phones, one account → confirm `FOREIGN` flag and ADMIN-only transfer |
| G061-02 | GPS spoofing (mock location apps) | Geofence radius per site + verification context captured with the event | Mock providers on rooted Android are undetectable from the browser alone | Test with a mock-location app on one device; record what the server sees |
| G061-03 | Offline queue tampering (edit queued timestamps before sync) | Server-side window guard: ≤16h shift, check-in −4/+8h, check-out ±8h; employee enters times manually | Queue contents are client-controlled until sync; replay ordering must be checked | Airplane-mode test: create queue, edit clock, sync → confirm server rejects out-of-window items |
| G061-04 | Replay of an old offline submission | Adjustment requests carry before/after digests and revision numbers | Duplicate prevention depends on client idempotency keys | Capture one sync payload twice; confirm the second is rejected |
| G061-05 | Device transfer without approval | Transfer is an ADMIN-approved flow | Approval can be granted casually | Review the transfer audit trail with a real request |
| G061-06 | Token theft on a shared phone | Refresh tokens are bound to a session; 401 triggers a single refresh | A phone left unlocked can be used in the session window | Test "leave phone unlocked" scenario and record the blast radius |
| G061-07 | PWA cache leaking another guard's data | Cache is per-origin; app is single-user per install | Shared install shows the previous guard's last screen | Test two sequential users on one install |
| G061-08 | Time-zone / clock manipulation | Server stores absolute timestamps in Bangkok time rules | Client clock only affects the printed value | Change the phone clock ±3h and confirm server truth wins |
| G061-09 | MITM on an untrusted Wi-Fi | HTTPS + HSTS + strict transport headers | None observed | Record headers on a hostile network |
| G061-10 | Approval escalation | Final approval is ADMIN-only; stages enforced server-side | None observed | Already covered by the RBAC route tests |

## 3. Device compatibility matrix (to be filled by physical testing)

| Dimension | Target | Status |
|---|---|---|
| Android Chrome (2 latest majors) | PWA install, background sync, geolocation | NOT VERIFIED |
| iOS Safari (2 latest majors) | PWA install, geolocation, storage quota | NOT VERIFIED |
| Low-end Android (2 GB RAM) | first paint < 5 s on 4G | NOT VERIFIED |
| Battery saver mode | geolocation still sampled | NOT VERIFIED |
| Airplane-mode round trip | queue → reconnect → sync | NOT VERIFIED |

## 4. What Phase 0 already established

1. The **controls exist in code** (device binding, geofence, server-side window guard, ADMIN-only
   final approval) — they are not aspirational.
2. The **remote latency path is measured**: public p95 346 ms, auth-gate p95 238 ms from a
   datacenter vantage point (`docs/T18_T24_ROUTE_TELEMETRY.md`).
3. **No biometric or QR control is required** to close the remaining threats; the remaining work is
   physical-device evidence, not new cryptography.

## 5. Exit criteria for Phase 0

- [ ] G061-01, G061-02, G061-03, G061-04 exercised on **physical devices** with recorded results
- [ ] Compatibility matrix completed on the two target platforms
- [ ] Written decision on acceptable residual risk for GPS spoofing (accept / detect / require second factor)
- [ ] Owner sign-off that the threat list is complete for the guard workflow

## 6. Explicit non-goals

- Face recognition, QR scanning, and biometric templates stay removed.
- No new schema, no Production configuration change, and no change to the approval authority as part
  of Phase 0.
