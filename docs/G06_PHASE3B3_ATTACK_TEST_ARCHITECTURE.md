# G06 Phase 3B-3 — Attack-Test Architecture / Provider-Neutral Harness

Status: **ARCHITECTURE READY / PROVIDER EXECUTION NOT STARTED**
Owner decision: AWS/provider integration is paused for the current work cycle.
Biometric runtime: **CLOSED**.
Production biometric activation: **NOT AUTHORIZED**.

## 1. Purpose

This gate prepares a repeatable attack-test architecture for Trusted 1:1 Face Verification + Liveness/PAD without pretending that provider-dependent attacks have already been tested.

The harness has two evidence layers:

1. **Backend contract evidence — executable now.**
   It verifies fail-closed behavior for trusted provider result signals, device authority, replay protection, stale authority, expiry, Site/QR/GPS context and provider failure handling.
2. **Empirical provider/PAD evidence — deferred.**
   It requires a genuine provider session and controlled physical/digital attack attempts. While provider runtime is paused these rows remain `NOT_EXECUTED_PROVIDER_PAUSED` and MUST NOT be reported as PASS.

Backend contract evidence is not PAD certification and is not proof that a selected provider detects a printed photo, screen replay, prerecorded video, deepfake or capture injection.

## 2. Non-negotiable trust rules

- Client/browser biometric booleans, scores or labels are never authoritative.
- Only a backend-trusted provider result may satisfy PAD/liveness and 1:1 face-match requirements.
- Receipt issuance requires PAD PASS + 1:1 face-match PASS + no capture/injection-risk signal.
- Opaque verification receipts are short-lived and single-use.
- Device, Reference Photo, Employee, Shift, Site, QR and GPS authority are revalidated before Attendance acceptance.
- AttendanceEvent creation and receipt consumption remain atomic.
- Provider unavailable/timeout never falls back to local/browser PASS.
- No 1:N roster face search, persistent embeddings/templates or face collections are introduced by this gate.
- The Phase 3B-3 harness must not persist physical attack images/video in SMS V3.
- An unexecuted empirical case cannot be recorded as PASS.

## 3. Canonical attack matrix

The matrix is inherited from `G06_FACE_VERIFICATION_LIVENESS_V1_PHASE3B_ARCHITECTURE.md` and is machine-readable in `scripts/g06/phase3b3-attack-matrix.js`.

| ID | Attack / control case | Required result | Current empirical status |
| --- | --- | --- | --- |
| ATK-01 | Genuine Employee + ACTIVE device + valid context | PASS | NOT_EXECUTED_PROVIDER_PAUSED |
| ATK-02 | Color printed Reference Photo | PAD FAIL | NOT_EXECUTED_PROVIDER_PAUSED |
| ATK-03 | High-quality/glossy printed photo | PAD FAIL | NOT_EXECUTED_PROVIDER_PAUSED |
| ATK-04 | Photo displayed on another phone | PAD FAIL | NOT_EXECUTED_PROVIDER_PAUSED |
| ATK-05 | Photo displayed on tablet/monitor | PAD FAIL | NOT_EXECUTED_PROVIDER_PAUSED |
| ATK-06 | Prerecorded face video | PAD/INJECTION FAIL | NOT_EXECUTED_PROVIDER_PAUSED |
| ATK-07 | Video with blink/head movement | PAD/INJECTION FAIL | NOT_EXECUTED_PROVIDER_PAUSED |
| ATK-08 | Wrong live person | FACE MATCH FAIL | NOT_EXECUTED_PROVIDER_PAUSED |
| ATK-09 | Correct face on revoked/wrong device | DEVICE AUTHORITY FAIL | backend contract executable now |
| ATK-10 | Replayed device challenge | REPLAY FAIL | backend contract executable now |
| ATK-11 | Replayed biometric receipt | REPLAY FAIL | backend contract executable now |
| ATK-12 | Reference Photo replaced mid-session | STALE FAIL | backend contract executable now |
| ATK-13 | Device replaced/revoked mid-session | STALE FAIL | backend contract executable now |
| ATK-14 | Expired verification session | EXPIRED FAIL | backend contract executable now |
| ATK-15 | Correct face/device outside geofence | LOCATION FAIL | backend contract executable now |
| ATK-16 | Correct face/device with wrong site QR/context | SITE CONTEXT FAIL | backend contract executable now |
| ATK-17 | Provider unavailable/timeout | FAIL CLOSED / controlled retry | backend contract executable now |

ATK-01 through ATK-08 also have backend decision contracts that can be simulated with trusted-provider signals, but their real-world PAD/matching behavior remains empirical and deferred.

## 4. Backend contract mapping

- PAD false → `LIVENESS_FAILED` → no receipt.
- injection risk true → `CAPTURE_INJECTION_RISK` → no receipt.
- face match false → `FACE_MATCH_FAILED` → no receipt.
- wrong/revoked device → active-device/device-key authority failure or `VERIFICATION_STALE` depending lifecycle point.
- replayed device challenge → `ATTENDANCE_DEVICE_CHALLENGE_INVALID` or already-actioned session state.
- replayed receipt → `VERIFICATION_REPLAYED`.
- Reference Photo/device authority drift → `VERIFICATION_STALE`.
- expired session/receipt → `VERIFICATION_EXPIRED`.
- outside geofence → `ATTENDANCE_OUTSIDE_SITE_GEOFENCE`.
- wrong/revoked Site QR/context → Site/QR/context mismatch failure; no receipt consumption or AttendanceEvent.
- provider unavailable → sanitized `VERIFICATION_PROVIDER_UNAVAILABLE`; no fallback PASS.

## 5. Harness behavior while provider is paused

Run:

`node scripts/g06/phase3b3-attack-harness.js --mode=plan`

The harness is deliberately plan-only. It:

- validates the 17-row matrix;
- emits a sanitized machine-readable evidence plan;
- reports provider runtime as `PAUSED`;
- reports `empiricalExecuted=0` and `empiricalPassed=0`;
- does not load AWS SDK clients, call a network provider, access camera/media or change environments;
- rejects any mode other than `plan` with `PHASE3B3_PROVIDER_EXECUTION_NOT_AUTHORIZED`.

## 6. Evidence record required when provider work resumes

Each empirical run must record only safe metadata:

- scenario ID;
- selected provider + region;
- provider policy profile ID and engine/version where available;
- device path/browser/native build identifier;
- test timestamp and controlled tester identifier/reference;
- expected outcome;
- provider completion state/result code;
- backend failure/result code;
- whether a receipt was issued;
- whether an AttendanceEvent was created;
- pass/fail/review outcome;
- reviewer and evidence note.

Do not store raw provider session secrets, QR tokens, receipt secrets, reference image bytes, attack image/video, embeddings/templates, confidence streams or face collections in the SMS database/audit log.

## 7. Empirical execution rules after a future Owner/provider gate

1. Genuine-user control must succeed first.
2. Run each physical/digital attack as a separate session; never reuse a prior successful receipt.
3. Use only controlled Preview identities/devices and non-production Attendance records.
4. Do not promote or mutate Production.
5. Keep provider audit-image retention disabled where supported.
6. If an attack unexpectedly produces a valid receipt or AttendanceEvent, stop the run and classify as a security blocker.
7. Web/PWA remains PILOT until injection/device-integrity assurance is demonstrated; use a separate native/Android hardening gate if browser assurance is insufficient.

## 8. Gate completion definition

This architecture checkpoint is complete when:

- machine-readable matrix contains all 17 canonical cases;
- plan-only harness rejects provider execution while paused;
- source tests prove backend failure-code/replay/stale/context/provider-unavailable contracts remain present;
- no public biometric/Attendance event-write route is opened by this gate;
- no AWS credential/env/provider call is made;
- no empirical provider case is claimed as PASS.

Actual **Phase 3B-3 controlled Preview attack execution remains NOT STARTED** until the Owner resumes provider integration and authorizes genuine-user + attack testing.
