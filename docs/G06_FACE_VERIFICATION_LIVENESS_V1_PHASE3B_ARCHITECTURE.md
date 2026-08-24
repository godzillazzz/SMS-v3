# G06 Trusted 1:1 Face Verification + Liveness/PAD V1 — Phase 3B Architecture / Engine Selection

Date: 2026-08-24

## 1. Scope and exact lineage

- Product branch: `feature/g06-reference-photo-face-liveness-v1`
- Exact parent candidate: `7bb2f8833a3503e27bcd9e59df09935bc37208ea`
- Parent tree: `915a2c9554f4ba69d823a19e4df77cc781d4cc91`
- Phase 3A Employee Reference Photo Preview technical + authenticated/browser UAT: COMPLETE.
- This Phase 3B step is architecture / engine selection only.
- No Prisma/schema/migration, provider account, provider secret, biometric runtime, Preview/Production env, DB/data/auth/storage mutation, deployment or promotion is authorized by this document.

## 2. Security problem to solve

The target threat is not only an impostor with a different face. A known real-world attendance attack is a legitimate employee printing their own face or leaving a face image/video on another screen so a colleague can perform attendance on their behalf.

A 1:1 face match alone is therefore insufficient. A printed photo can match the authoritative Reference Photo with a very high similarity while the real employee is absent.

The authoritative attendance decision must establish all of the following together:

1. the authenticated account is linked to the authoritative Employee.id;
2. the request comes from the currently ACTIVE attendance device and proves possession of its device private key;
3. the capture is from a live human physically present now, not a printed photo, screen replay, video, mask, deepfake or injected media;
4. the live face is a 1:1 match to the current ACTIVE Employee Reference Photo;
5. the verification is fresh, bound to this server challenge/session and cannot be replayed;
6. attendance context (purpose/site/QR/geofence/server time) is the context originally authorized by the server;
7. the authoritative server, not browser JavaScript, decides PASS/FAIL.

## 3. Standards baseline / acceptance floor

Phase 3B adopts the following security floor for engine evaluation:

- NIST SP 800-63B current guidance: facial recognition requires Presentation Attack Detection (PAD); target false-match rate is 1 in 10,000 or better; additional trust in the sensor/endpoint is required for injection-attack resistance.
- PAD evaluation evidence should conform to ISO/IEC 30107-3:2023.
- Prefer engines with independent Face Verification certification that evaluates matching, liveness/PAD, demographic performance, deepfake and injection-attack resistance (for example FIDO Face Verification certification).
- Scores are server-side security inputs. The client receives only workflow state and PASS / FAIL / RETRY / REVIEW_REQUIRED, never the raw liveness threshold or decision score.
- Vendor default thresholds are not authoritative. SMS V3 must set thresholds from its own attack/usability validation and the provider's independent test evidence.

## 4. Threat model — must be explicitly tested

### Presentation attacks

- color A4 printed face;
- high-resolution / glossy printed face;
- printed face with eye/mouth cut-outs;
- face photo shown on another phone;
- face photo shown on tablet/monitor;
- prerecorded face video;
- prerecorded video containing blink/head movement;
- 3D mask / partial mask as relevant to selected provider threat coverage.

### Digital / injection attacks

- virtual camera;
- browser media substitution / prerecorded MediaStream where feasible;
- emulator;
- rooted/jailbroken or compromised endpoint where detectable;
- deepfake/realtime face-swap feed;
- replay of a previously accepted provider response;
- replay of SMS verification receipt;
- reuse of a capture against a different Employee/device/site/purpose.

### Authority/context attacks

- correct live employee on wrong/revoked device;
- wrong employee on correct device;
- Reference Photo changes from ACTIVE to SUPERSEDED during an in-flight session;
- device replacement/revocation during an in-flight session;
- expired server challenge/session;
- GPS/geofence or site/QR context mismatch;
- duplicate/replayed Attendance submission;
- provider timeout/partial failure.

## 5. Do not trust client biometric booleans

Prohibited authoritative payloads include:

- `faceVerified: true` from JavaScript;
- `livenessPassed: true` from JavaScript;
- client-supplied face/liveness score;
- client-selected Reference Photo id;
- client-selected device authority id;
- client assertion that a provider callback succeeded.

The browser/native client may render UX and transport provider session material, but it is not the authority.

## 6. Verification-session trust boundary

Recommended server flow:

1. Authenticated user requests an Attendance verification session.
2. Server resolves linked Employee.id and verifies Employee operational eligibility.
3. Server resolves exactly one ACTIVE AttendanceDeviceEnrollment for Employee.id.
4. Server resolves the current ACTIVE EmployeeReferencePhoto.
5. Server resolves/creates the expected Attendance context: purpose, site/QR context, geofence policy and server timestamp window.
6. Server creates a short-lived random challenge and a verification session bound to:
   - Employee.id;
   - User.id;
   - ACTIVE AttendanceDeviceEnrollment.id + credential fingerprint;
   - ACTIVE EmployeeReferencePhoto.id + checksum/version identity;
   - purpose (ATTENDANCE_EVENT or PATROL_EVENT);
   - server nonce/challenge;
   - attendance-context digest;
   - creation/expiry time.
7. Device signs the server challenge/session binding with its enrolled P-256 private key.
8. Server creates a provider liveness session server-to-server and returns only ephemeral client session material needed by the provider SDK.
9. Live capture is sent through the trusted PAD/liveness provider path. Raw live frames are not persisted by SMS V3.
10. SMS backend retrieves the provider result server-to-server. It never trusts a client-reported result.
11. A high-quality transient live frame/result is used for 1:1 comparison against the current ACTIVE Reference Photo only.
12. Server re-resolves Employee, ACTIVE device and ACTIVE Reference Photo after provider completion. If any authoritative binding changed, the session fails stale/closed.
13. If device proof + PAD/liveness + 1:1 match + context/risk checks all pass, the server issues a short-lived single-use verification receipt.
14. Attendance Event creation atomically consumes the receipt. A consumed/expired/stale receipt cannot be reused.

## 7. Receipt design — prefer opaque single-use server receipt

V1 should prefer an opaque random receipt token instead of a client-readable self-contained JWT containing biometric claims.

Recommended persistence concept for a later implementation gate:

- `FaceVerificationSession.id` UUID;
- `employeeId`;
- `userId`;
- `deviceEnrollmentId`;
- `referencePhotoId`;
- `purpose`;
- `challengeHash`;
- `contextDigest`;
- `provider` + non-sensitive provider/session correlation metadata;
- `status`: CREATED / CAPTURE_IN_PROGRESS / VERIFIED / FAILED / EXPIRED / CONSUMED;
- `padPassed`, `faceMatchPassed` and policy/result code only as required for audit/risk;
- fixed policy/engine version and threshold profile id;
- `issuedAt`, `expiresAt`, `consumedAt`;
- random receipt secret is returned once to client; only its cryptographic hash is stored server-side.

Do NOT persist:

- live face image/video;
- provider video/audit frames;
- persistent face embedding/template;
- a permanent public image URL;
- raw provider secret material;
- full biometric score exposed to frontend/audit.

## 8. Reference Photo handling during verification

- 1:1 only. No face collection and no 1:N Employee roster search.
- Server loads the current ACTIVE EmployeeReferencePhoto from private storage only for the verification operation.
- Reference image bytes are transient processing input.
- A session is bound to the exact active referencePhotoId/checksum.
- If that reference photo is replaced before receipt issuance/consumption, fail the old session as stale and require a new verification.
- Retention A remains unchanged: only the current authoritative Reference Photo image is retained.

## 9. Media retention policy

V1 remains locked:

- Employee Reference Photo: retained only while authoritative ACTIVE; superseded image bytes deleted under Retention A.
- Live face/liveness video/frames: temporary only; discard after provider/verification processing.
- Attendance Event photo: NOT RETAINED.
- Patrol Event photo: NOT RETAINED.
- Provider audit image retention: configure to zero/disabled wherever the selected provider permits; any unavoidable provider-side retention requires a separate privacy/security/contractual Owner gate.
- Persistent biometric templates/embeddings: NOT AUTHORIZED.

## 10. Engine strategy — pluggable provider, not home-grown browser PAD

Create a future adapter boundary equivalent to:

`createFaceVerificationProvider()`

with operations conceptually equivalent to:

- `createLivenessSession()`;
- `getAuthoritativeLivenessResult()`;
- `compareLiveFrameToReference1to1()` or an atomic provider verification operation;
- `normalizeProviderResult()`;
- `delete/expireProviderArtifacts()` if applicable.

Business/service code must consume a normalized trusted result rather than vendor-specific fields.

No custom JavaScript ML model running entirely in the browser is accepted as the authoritative PAD engine for V1.

## 11. Engine shortlist / decision

### Preferred production-assurance class

Use a remote face-verification provider with current independent certification covering face matching + PAD/liveness + deepfake/injection threats, preferably FIDO Face Verification certification plus ISO/IEC 30107-3 evidence.

Current example class: iProov Dynamic Liveness / other current FIDO-certified Face Verification products.

Why preferred:

- independent security/performance evaluation;
- explicit liveness and attack testing;
- stronger procurement/audit evidence than an internally invented PAD model;
- better alignment with a high-assurance workforce attendance threat model.

### Recommended engineering PoC candidate

Amazon Rekognition Face Liveness + stateless 1:1 CompareFaces is a practical PoC candidate because:

- Face Liveness is documented to target printed photos, displayed images/videos, 3D masks and camera-bypass/injected prerecorded/deepfake video;
- a high-quality transient selfie frame can be used for subsequent 1:1 comparison;
- CompareFaces can remain image-to-image without creating a persistent face collection/template in SMS V3;
- browser support exists for current major browsers, enabling controlled Preview testing before native Android hardening.

PoC status is NOT equivalent to final production provider approval. AWS documents CompareFaces as a stateless API operation, so the PoC can avoid creating a persistent face collection; however, procurement, data-region/privacy, contractual retention, independent PAD evidence, operational thresholds and attack testing remain gates.

## 12. Web/PWA versus Android/native assurance gate

Existing Phase 2 Web/PWA device enrollment generates a non-exportable P-256 CryptoKey in IndexedDB. This proves possession of the locally generated device credential but does not by itself prove hardware-backed key storage, device integrity or genuine camera-pipeline integrity.

Therefore:

- Web/PWA may be used for Preview/Pilot PAD evaluation.
- Production authoritative Attendance must not weaken PAD/injection requirements merely because a browser cannot attest them.
- If Web/PWA cannot reliably meet the injection/virtual-camera/device-integrity acceptance tests, high-assurance Attendance requires a separate Android/native gate.
- Native target should evaluate hardware-backed device keys, Android Play Integrity/device attestation and trusted camera/provider SDK integration.
- Passkey remains account authentication; AttendanceDeviceEnrollment remains Attendance device authority. They are not interchangeable.

## 13. Suggested fail-closed states

- `FACE_REFERENCE_REQUIRED`
- `ATTENDANCE_DEVICE_REQUIRED`
- `DEVICE_PROOF_FAILED`
- `LIVENESS_FAILED`
- `FACE_MATCH_FAILED`
- `CAPTURE_INJECTION_RISK`
- `VERIFICATION_STALE`
- `VERIFICATION_EXPIRED`
- `VERIFICATION_REPLAYED`
- `LOCATION_POLICY_FAILED`
- `SITE_CONTEXT_FAILED`
- `RISK_REVIEW_REQUIRED`
- `VERIFICATION_PROVIDER_UNAVAILABLE`

Provider-specific errors must be sanitized before reaching the client.

## 14. Rate limit / buddy-punch risk controls

Architecture target:

- no more than 5 failed biometric/liveness attempts in a short window per Employee + active device;
- escalating cooldown after repeated failures;
- repeated PAD/injection failures raise device risk and may require Admin review;
- one active verification session per Employee/device/purpose;
- correlate repeated use of one device/network/site context across multiple Employees;
- device replacement shortly before Attendance is a risk signal;
- impossible travel/geofence inconsistencies are risk signals;
- do not permanently lock a legitimate Employee without a governed recovery path.

Exact windows/thresholds remain implementation/Pilot tuning, but bypass on failure is prohibited.

## 15. Acceptance tests before authoritative Production use

Minimum attack matrix must include:

| Test | Required result |
| --- | --- |
| Genuine Employee + ACTIVE device + valid context | PASS |
| Color printed Reference Photo | PAD FAIL |
| High-quality/glossy printed photo | PAD FAIL |
| Photo displayed on another phone | PAD FAIL |
| Photo displayed on tablet/monitor | PAD FAIL |
| Prerecorded face video | PAD/INJECTION FAIL |
| Video with blink/head movement | PAD/INJECTION FAIL |
| Wrong live person | FACE MATCH FAIL |
| Correct face on revoked/wrong device | DEVICE AUTHORITY FAIL |
| Replayed device challenge | REPLAY FAIL |
| Replayed biometric receipt | REPLAY FAIL |
| Reference Photo replaced mid-session | STALE FAIL |
| Device replaced/revoked mid-session | STALE FAIL |
| Expired verification session | EXPIRED FAIL |
| Correct face/device outside geofence | LOCATION FAIL |
| Correct face/device with wrong site QR/context | SITE CONTEXT FAIL |
| Provider unavailable/timeout | FAIL CLOSED / controlled retry |

Production approval requires documented test evidence against the selected engine/device path.

## 16. Phase 3B implementation gates after this architecture step

Separate explicit Owner approval is required before each consequential layer:

1. Phase 3B-1 additive verification-session/receipt schema + local/source service contracts/tests.
2. Phase 3B-2 provider SDK/API PoC and provider credentials in isolated Preview only.
3. Phase 3B-3 controlled Preview attack testing with printed-photo/screen/video/injection matrix.
4. Android/native hardening gate if Web assurance is insufficient.
5. Production provider/env/migration/deployment/biometric runtime activation gate.

No persistent biometric embedding/template is implicitly authorized by any of these gates.

## 17. Phase 3B architecture decision

- SINGLE trusted biometric boolean from browser: REJECTED.
- 1:N face search: REJECTED.
- Persistent face collection/template for V1: REJECTED unless separately Owner-approved.
- Client-supplied provider result: REJECTED.
- Server-created short-lived verification session: REQUIRED.
- Active device cryptographic proof: REQUIRED.
- PAD/liveness: REQUIRED.
- Current ACTIVE Reference Photo 1:1 match: REQUIRED.
- Single-use server receipt consumed by Attendance: REQUIRED.
- Private/temporary biometric media handling: REQUIRED.
- Pluggable provider adapter: REQUIRED.
- Web/PWA: PILOT until injection/device-integrity acceptance is demonstrated.
- Native Android hardening: REQUIRED if Web/PWA cannot satisfy the acceptance matrix.

Architecture status: `G06_PHASE3B_TRUSTED_FACE_LIVENESS_ARCHITECTURE_ENGINE_SELECTION_COMPLETE_SOURCE_ONLY`


## 18. External evidence reviewed for this decision

Current public evidence reviewed on 2026-08-24 included:

- NIST SP 800-63B (Digital Identity Guidelines — Authentication and Lifecycle Management): facial recognition SHALL implement PAD; FMR target 1 in 10,000 or better; endpoint/sensor integrity is relevant to injection-attack resistance.
- NIST SP 800-63A current guidance: remote biometric capture requires PAD and explicitly calls out virtual camera, emulator, jailbroken device, forged media and injection-attack controls.
- ISO/IEC 30107-1:2023 and ISO/IEC 30107-3:2023: current PAD framework and PAD testing/reporting baseline.
- FIDO Alliance Face Verification Certification: evaluates remote face verification including liveness, matching, bias/equity and injection/deepfake threats; current certified products should be rechecked at procurement time.
- Amazon Rekognition Face Liveness current documentation: short video-selfie flow; targets printed/displayed images/videos, masks and camera-bypass/injected prerecorded/deepfake video; returns authoritative server-side confidence/result plus a transient high-quality frame.
- Amazon Rekognition CompareFaces current API documentation: image-to-image comparison is stateless; returned comparison data does not persist.

Architecture decisions remain vendor-neutral. Any provider certification/version used for Production must be re-verified at the Production provider-selection gate.

## 19. Phase 3B-1 verification session / receipt foundation implementation note (2026-08-24)

Implemented source/local-only under explicit Owner authorization for the Phase 3B-1 additive schema + service-contract/test layer.

- Added additive migration `202608240002_g06_face_verification_session_v1` with `FaceVerificationSession` and `FaceVerificationReceipt`.
- A verification session is bound to authoritative `Employee.id`, authenticated `User.id`, ACTIVE Attendance device, the device credential fingerprint snapshot, current ACTIVE Reference Photo, the Reference Photo SHA-256 checksum snapshot, an `AttendanceDeviceChallenge`, verification purpose, and caller-supplied canonical context digest.
- One active verification session per Employee + device + purpose is enforced in PostgreSQL.
- Session lifetime is 5 minutes. Verification receipts are bounded to 2 minutes and never outlive the parent session.
- Attendance device proof uses the existing P-256 public credential and single-use hashed challenge. A failed signature consumes the challenge and fails closed.
- Provider correlation is persisted only as SHA-256 hash. The raw provider session reference is not persisted.
- Authoritative provider-result acceptance requires PAD/liveness PASS, 1:1 face match PASS, and no capture/injection-risk signal before a receipt can be issued.
- Receipt secret is random/opaque and returned once; PostgreSQL stores only its SHA-256 hash. Consumption is atomic, single-use, context-bound, and replay-safe.
- Receipt consumption re-checks current Employee/account authority, ACTIVE Attendance device + credential fingerprint, and current ACTIVE Reference Photo + checksum. Authority changes fail as `VERIFICATION_STALE`; expired sessions persist `EXPIRED` fail-closed.
- Stable device fingerprint and Reference Photo checksum remain internal DB binding metadata and are excluded from the safe service response projection.
- No public Phase 3B route was mounted. No provider SDK, provider credential, Preview/Production env change, face model runtime, or provider network call was added.
- No raw image/video/live frame, Attendance/Patrol event photo, biometric embedding/template, face collection, or permanent biometric media URL is persisted.
- No `employeeCode` identity coupling is introduced.

Final local validation evidence for this source candidate: Prisma format/validate/generate PASS; focused Phase 3B-1 contracts 9/9 PASS; focused real PostgreSQL 3/3 PASS; fresh PostgreSQL migration chain 24/24 PASS; official serialized integration suite 167/167 PASS with 0 skipped; backend 600/600 PASS; frontend 45 files / 393 tests PASS; frontend production build PASS; scope/security audit found no route/env/package/workflow/provider-credential/Production coupling or biometric-media/template persistence.

Phase 3B-1 status: `G06_PHASE3B1_VERIFICATION_SESSION_RECEIPT_FOUNDATION_SOURCE_COMPLETE_PRODUCTION_UNCHANGED`


## 20. Phase 3B-2 isolated Preview migration + AWS Rekognition PoC source note (2026-08-24)

Implemented under the explicit isolated-Preview Phase 3B-2 gate. This step applies the Phase 3B-1 schema to the existing isolated Preview database and prepares a guarded AWS Rekognition engineering PoC. It does not authorize Production biometric runtime.

- Existing isolated Preview database identity was guard-verified as Supabase ref `ezxanpfagitckpfsnflp`; the Production ref was explicitly rejected by the one-shot migration guard.
- Before mutation, the only pending Preview migration was `202608240002_g06_face_verification_session_v1`. It was applied exactly once and post-migration status was `UP_TO_DATE`.
- The temporary migration deployment/remote branch was removed after evidence collection.
- Added exact backend dependency `@aws-sdk/client-rekognition@3.1116.0` behind an isolated provider adapter. The provider-neutral Face Verification session/receipt service remains separate from AWS-specific commands.
- AWS PoC region is fail-closed to `ap-southeast-7` (Thailand). PoC challenge type defaults to `FaceMovementAndLightChallenge`. Liveness session creation sets `AuditImagesLimit=0` and does not configure S3 OutputConfig.
- The provider adapter uses server-side `CreateFaceLivenessSession` and `GetFaceLivenessSessionResults`. A successful liveness result supplies only a transient reference frame in memory, which is compared 1:1 against the current ACTIVE private Employee Reference Photo with stateless `CompareFaces`.
- ACTIVE Reference Photo bytes are read directly from the private Supabase Storage object endpoint. No public URL is created for provider comparison. Size/type guards are enforced and the SHA-256 checksum is rechecked against the verification-session snapshot.
- Provider and Reference Photo byte buffers are wiped after use where the runtime representation allows it. SMS V3 does not persist provider reference frames, liveness video, audit images, confidence score, face similarity score, biometric embedding/template, or face collection.
- PoC thresholds are environment-controlled and mandatory; no threshold defaults are silently assumed. Provider configuration remains fail-closed when required values are absent or invalid.
- The authenticated PoC API is mounted in source but hidden by a guard that returns unavailable unless `VERCEL_ENV=preview` and `FACE_VERIFICATION_POC_API_ENABLED=true`. `VERCEL_ENV=production` always wins and disables the PoC route even if another flag or test-mode variable is misconfigured.
- Provider errors are sanitized. Long-lived AWS access-key literals are not present in source. No AWS credential is sent to browser code.
- Preview currently has no AWS credential/profile configured, so no live AWS provider call, browser liveness capture, or controlled print/screen/video/injection attack test was performed in this step. The PoC API remains disabled in Preview.
- No Phase 3B-2 Production deploy/promotion/migration/env/DB/data/auth/storage/provider mutation was performed.

Validation on the current source candidate: focused Reference Photo + core Face Verification + AWS PoC contracts 26/26 PASS; fresh local PostgreSQL migration chain 24/24 PASS; real PostgreSQL core/PoC orchestration 4/4 PASS; official serialized integration suite 168/168 PASS with 0 skipped; backend 609/609 PASS; frontend 45 files / 393 tests PASS; frontend production build PASS. Final hardening focused rerun after Production-route precedence and transient-byte wiping: 26/26 PASS.

Phase 3B-2 source status before live provider credentials: `G06_PHASE3B2_PREVIEW_MIGRATION_COMPLETE_AWS_POC_SOURCE_READY_LIVE_PROVIDER_CREDENTIALS_PENDING`.
