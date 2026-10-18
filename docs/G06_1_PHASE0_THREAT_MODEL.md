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
| Device binding (which phone belongs to which guard) | **Detects** a second device and flags it for review — it does not by itself block the event | `attendance-simple.service.js` (`ACCOUNT_DEVICE_GPS_GEOFENCE_V1`, `PRIMARY`/`FOREIGN`, `DEVICE_MISMATCH`) |
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
| G061-01 | Buddy punching: guard A clocks in on guard B's phone | A second key is registered as `PENDING_APPROVAL` / `observationOnly` and the event is created with `reviewRequired` + `DEVICE_MISMATCH` (`ACCEPTED_REVIEW_FLAGGED`). **The event is recorded and may still be counted** — binding is a detection control, not a gate. | Payroll still contains the flagged event until someone acts on it | Integration test with two keys on one account: record event status, `counted`, payroll inclusion, and the ADMIN review step |
| G061-02 | GPS spoofing (mock location apps) | Geofence radius per site + verification context captured with the event | Mock providers on rooted Android are undetectable from the browser alone | Test with a mock-location app on one device; record what the server sees |
| G061-03 | Offline queue tampering (edit queued timestamps before sync) | The server stores the client-captured time in `deviceCapturedAt`, uses it as `effectiveEventAt` for offline events, records `timeBasis: SERVER_RECEIVED`, and marks the event for review when risk flags exist. The adjustment window guard (≤16h, −4/+8h, ±8h) applies to manual adjustments, **not** to the first offline event. | An offline event can carry a client-chosen effective time and is only flagged, not rejected | Airplane-mode test: create a queued event, change the phone clock, sync → record `effectiveEventAt`, `deviceCapturedAt`, review flags and whether the event is counted |
| G061-04 | Replay of an old offline submission | `captureId` is carried per event and adjustment requests carry before/after digests with revision numbers. Whether a repeated `captureId` is rejected must be confirmed. | Unknown until tested | Capture one sync payload twice; confirm the second is rejected at the event and at the adjustment layer |
| G061-05 | Device transfer without approval | Transfer is an ADMIN-approved flow | Approval can be granted casually | Review the transfer audit trail with a real request |
| G061-06 | Token theft on a shared phone | Refresh tokens are bound to a session; 401 triggers a single refresh | A phone left unlocked can be used in the session window | Test "leave phone unlocked" scenario and record the blast radius |
| G061-07 | PWA cache leaking another guard's data | Cache is per-origin; app is single-user per install | Shared install shows the previous guard's last screen | Test two sequential users on one install |
| G061-08 | Time-zone / clock manipulation | Server stores absolute timestamps in Bangkok time rules | Client clock only affects the printed value | Change the phone clock ±3h and confirm server truth wins |
| G061-09 | MITM on an untrusted Wi-Fi | HTTPS + HSTS + strict transport headers | None observed | Record headers on a hostile network |
| G061-10 | Approval escalation | Final approval is ADMIN-only; stages enforced server-side | None observed | Already covered by the RBAC route tests |
| G061-11 | Credential sharing: two guards share one account password | Out of scope of device binding (same account, same key) | Full impersonation until a device or geofence flag fires | Policy decision required; test what the audit trail shows |
| G061-12 | Foreign-device self-enrolment | A second device is auto-registered as `observationOnly` on first use, so no ADMIN action is needed to *create* it (approval is only needed to make it primary) | A guard can generate a foreign binding at will and simply be flagged | Confirm the ADMIN review queue surfaces every such binding; test the flow end-to-end |
| G061-13 | Collusion at the checkpoint: guard B physically present, guard A's phone used | No control distinguishes who holds the phone | Unmitigated by software | Record as accepted risk or add a second factor; Owner decision |

## 2b. The policy decision this model cannot make for you

Device binding, geofence and the adjustment window **detect and flag**; they do not by themselves
prevent a flagged event from being counted. Before Phase 0 can close, the owner must choose one of:

1. **Block** — a flagged event is not counted until an ADMIN confirms it.
2. **Provisional** — the event counts provisionally and is excluded downstream until confirmed.
3. **Accept** — flagged events count as-is, with review only for audit.

This is a payroll and legal-evidence decision, not an engineering one, and it changes behaviour for
every guard, so it is not taken here.

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
   final approval) — they are not aspirational, but they **detect rather than block**; see section 2b
   for the decision the owner still has to make.
2. The **remote latency path is measured**: public p95 346 ms, auth-gate p95 238 ms from a
   datacenter vantage point (`docs/T18_T24_ROUTE_TELEMETRY.md`).
3. **No biometric or QR control is required** to close the remaining threats; the remaining work is
   physical-device evidence, not new cryptography.

## 5. Exit criteria for Phase 0

- [ ] G061-01, G061-02, G061-03, G061-04, G061-11, G061-12, G061-13 exercised on **physical devices** with recorded results
- [ ] Owner records the block / provisional / accept decision from section 2b
- [ ] Compatibility matrix completed on the two target platforms
- [ ] Written decision on acceptable residual risk for GPS spoofing (accept / detect / require second factor)
- [ ] Owner sign-off that the threat list is complete for the guard workflow

## 6. Explicit non-goals

- Face recognition, QR scanning, and biometric templates stay removed.
- No new schema, no Production configuration change, and no change to the approval authority as part
  of Phase 0.
