# G06 In-Process Reference Photo Face Match V1

## Purpose

This gate removes the operational dependency on a separate Face Verifier host for G06 Attendance while preserving the existing provider-neutral Attendance authority model.

Runtime path:

`Attendance PWA -> SMS V3 backend on Vercel -> in-process face models -> trusted server result -> opaque verification receipt -> AttendanceEvent`

The Employee Reference Photo remains the only authoritative comparison image. Verification is strictly 1:1; no roster search or 1:N identification is performed.

## Runtime implementation

- `@vladmandic/human@3.3.6` — server-side face detection, face mesh/rotation and face description orchestration.
- `@tensorflow/tfjs-core@4.22.0`, `@tensorflow/tfjs-converter@4.22.0`, `@tensorflow/tfjs-backend-wasm@4.22.0` — WASM inference runtime. `@tensorflow/tfjs-node` is intentionally not used.
- `sharp@0.35.4` — bounded image decode/orientation/resize before inference.
- Human default face models used by this gate are limited to BlazeFace, FaceMesh and FaceRes. Vercel `includeFiles` is narrowed to those model files plus the Node-WASM entry and TFJS WASM binaries.

Model/code provenance recorded for this gate:

- Human library: MIT.
- TensorFlow.js / BlazeFace family: Apache-2.0.
- Human FaceRes credits HSE FaceRes; upstream `av-savchenko/HSE_FaceRec_tf` is Apache-2.0 and documents the MobileNet face-recognition model lineage.

Organizational legal/compliance review may impose stricter requirements than repository licenses; this source record is technical provenance, not legal advice.

## Security and privacy invariants

- Server issues the Active Challenge; browser cannot choose it.
- Exactly four transient challenge frames plus one final live still are accepted.
- Final still must return near neutral pose before 1:1 comparison.
- Active Challenge and face similarity are evaluated inside the backend process.
- Browser-supplied `match`, `activeChallengePassed`, similarity scores or embeddings are never authoritative.
- Similarity threshold is server-side only and bounded by configuration validation.
- Similarity values, embeddings and pose values are not returned to the browser and are not persisted in PostgreSQL.
- Routine Attendance live/challenge images are not stored by this gate.
- Routine verification does not instantiate or call AttendanceFaceEvidenceStorage; a successful 1:1 match may mint the short-lived opaque receipt without persisting the live photo.
- Existing AttendanceEvidence schema/administrative view-purge support remains only for compatibility and controlled cleanup of any historical records. It is not a write path for new routine Attendance verification.
- Any future proposal to persist routine Attendance/Patrol live images requires separate Owner authorization and must not be inferred from the dormant storage abstraction.
- Reference Photo checksum and active authority are revalidated before inference.
- Live photo, challenge frames and fetched Reference Photo buffers are zeroed after the attempt.
- Existing device proof, Site/GPS/QR, Schedule, anti-replay, receipt and AttendanceEvent authority remain unchanged.
- This Active Challenge is a lightweight anti-spoof/risk control and is not represented as certified PAD/liveness.

## Runtime gates

Required Attendance route gate remains environment-specific:

- Production: `ATTENDANCE_API_PRODUCTION_ENABLED=true`
- Preview: `ATTENDANCE_API_PREVIEW_ENABLED=true`

In-process face runtime additionally requires:

- `FACE_VERIFICATION_IN_PROCESS_ENABLED=true`

Optional bounded tuning variables:

- `FACE_MATCH_SIMILARITY_THRESHOLD` — allowed 0.55 to 0.90; default 0.62.
- `FACE_CHALLENGE_MOVEMENT_RADIANS` — allowed 0.10 to 0.50; default 0.17.
- `FACE_CHALLENGE_NEUTRAL_MAX_RADIANS` — allowed 0.10 to 0.50; default 0.30.

If the in-process flag/config is unavailable or invalid, biometric runtime remains fail-closed. The existing self-hosted provider path is retained as a fallback architecture and is not deleted.

## Source validation checkpoint

Local real-engine proof used a public non-employee sample image. No Employee Reference Photo was used for development benchmarking.

Observed on the development workstation:

- Four challenge frames + final still, cold model load: approximately 3.1–3.5 seconds.
- Same five-image path after model warm-up: approximately 2.0 seconds.
- Static-image challenge correctly returned `ACTIVE_CHALLENGE_FAILED` rather than a runtime/provider error.

A successful challenge adds one Reference Photo inference before similarity comparison, so final Production sizing must use Vercel runtime measurements and physical UAT rather than treating the local timing as a guaranteed Production number.

## Dependency audit note

At this gate, `npm audit` reports three existing high findings in the Prisma development toolchain (`prisma -> @prisma/config -> deepmerge-ts`). No reported high finding is introduced by Human, TFJS WASM or sharp. Dependency remediation for the Prisma baseline is a separate compatibility gate.

## Rollback

Disable `FACE_VERIFICATION_IN_PROCESS_ENABLED` and redeploy/promote an artifact built with the disabled value. Attendance then returns to the existing fail-closed biometric-runtime state unless a separately configured trusted self-hosted provider is enabled.

No schema migration is introduced by this gate.
