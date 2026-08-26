# G06 Reference Photo + Face Verification + Liveness V1 — Phase 0 Architecture

## Scope and lineage

- Branch: `feature/g06-reference-photo-face-liveness-v1`
- Exact parent: Phase 2 commit `1171608fe8517084ce1c69f297607e6e6a86536e`
- Parent tree: `b75820fb497b211638f464105d211d2908bcbabc`
- This phase is architecture/read-only fit analysis only. No Prisma/schema, migration, Preview, Production, storage, env, DB, auth, or data mutation is authorized by this document.

## Owner locks

- Employee Reference Photo is an authoritative governed identity reference surfaced inside Employee Master.
- ADMIN may replace/activate directly with immutable audit.
- MANAGER may propose a replacement; the currently ACTIVE photo remains authoritative until ADMIN final approval.
- Employee/Viewer cannot self-change the authoritative reference photo.
- Face verification is 1:1 only against the authoritative Employee Reference Photo; no 1:N roster search.
- Liveness / Presentation Attack Detection is required for authoritative attendance face verification.
- Attendance check-in/check-out event photos are not retained in V1.
- Patrol event photos are not retained in V1.
- Live face/liveness frames are temporary and discarded after verification.
- Persistent biometric templates/embeddings are NOT authorized by this phase and require a separate architecture/security/privacy gate.
- **Retention Option A locked 2026-08-24:** once a newly approved Reference Photo becomes ACTIVE, the superseded image file must be deleted immediately; do not retain old biometric/reference image files.
- Audit/metadata proving the replacement event may remain, but must not contain image bytes or a usable permanent image URL.

## Existing-system fit

- Employee Master already has governed ADMIN-direct / MANAGER-request edit semantics. Reference Photo belongs in this UI/domain but should not be flattened into `Employee.referencePhotoUrl`.
- A photo replacement must allow an ACTIVE photo and a pending candidate to coexist. Therefore use a dedicated governed Employee sub-resource rather than one mutable URL field.
- Existing License Documents already provide useful private Supabase Storage patterns: server-side service-role access, object keys in DB, signed viewing, checksum, MIME validation, and audit. Reuse the storage adapter style, not the License document workflow model itself.
- Do not put binary image data inside PostgreSQL or EmployeeChangeRequest JSON snapshots.

## Proposed Phase 3A persistence boundary (requires separate Owner authorization)

Candidate additive concepts:

- `EmployeeReferencePhoto` — one row per submitted image/version with Employee binding, storage metadata, checksum, MIME/size, governance status, uploader/reviewer timestamps, and activation/supersession metadata.
- Statuses: `PENDING_APPROVAL`, `ACTIVE`, `REJECTED`, `CANCELLED`, `SUPERSEDED` (SUPERSEDED metadata may remain after its file is deleted).
- DB guard: at most one ACTIVE Reference Photo per Employee.
- DB guard: at most one actionable pending replacement per Employee.
- No permanent public URL column. Store provider/bucket/objectKey metadata only.
- Suggested accepted upload types: JPEG/PNG only; reject PDF for reference photos.
- Exact size/dimension/image-quality limits remain implementation-level validation to lock during Phase 3A.

## Option A activation/deletion safety

“Delete old image immediately” must not mean deleting storage before the authoritative DB transition commits.

Recommended sequence:

1. Validate candidate file and governance state.
2. In one DB transaction, lock Employee/reference-photo rows, mark candidate ACTIVE, mark old ACTIVE SUPERSEDED, write immutable audit/outbox deletion intent, and commit.
3. After commit, delete the superseded storage object immediately using the deletion intent.
4. Mark storage deletion completion metadata. If object deletion fails, keep the object inaccessible/private and retry from a fail-closed cleanup worker; do not roll the authoritative ACTIVE photo back merely because cleanup transport failed.
5. Signed-view endpoints must refuse SUPERSEDED/REJECTED/CANCELLED rows regardless of whether physical deletion retry is still pending.

This preserves data minimization while preventing “old photo deleted but new activation rolled back” split-brain failure.

## Proposed UI placement

- Employee Master → `แก้ไขข้อมูล` → section `รูปอ้างอิงพนักงาน`.
- Show current ACTIVE thumbnail, last activated date, updater/approver, and governance state.
- ADMIN: `เปลี่ยนรูปอ้างอิง` → validate → activate with audit.
- MANAGER: `เสนอรูปใหม่` → candidate remains PENDING_APPROVAL; current ACTIVE photo remains in force until ADMIN approval.
- ADMIN review should show old ACTIVE vs candidate side-by-side plus uploader, timestamp, Employee identity context, and explicit approve/return/reject actions.

## Phase 3B trusted face/liveness boundary

- Browser camera capture requires secure context/HTTPS and user permission.
- Client JavaScript must not be trusted as the sole authority for `faceVerified=true` or liveness result.
- Authoritative Attendance acceptance should consume a server-validated verification receipt or trusted engine result bound to Employee.id, active device, capture nonce/session, timestamp, and expected attendance context.
- Face match must be 1:1 against the current ACTIVE Reference Photo.
- Liveness/PAD must pass before the face match can become authoritative.
- Raw live frames are discarded after processing under V1 media policy.
- Model/runtime/vendor choice is not locked in Phase 0. If Web/PWA cannot provide adequate trusted PAD/face processing, raise a separate Android/native or trusted-server hardening gate instead of weakening identity assurance.

## Hard stop before Phase 3A implementation

Phase 3A requires explicit Owner authorization covering additive Prisma schema/migration and local/source implementation. Any actual Supabase bucket/env/Preview/Production storage mutation requires separate exact authorization. Production migration/deploy/data mutation remains separately gated.

Architecture status: `G06_REFERENCE_PHOTO_FACE_LIVENESS_V1_PHASE0_ARCHITECTURE_COMPLETE_RETENTION_A_LOCKED`

## Phase 3A Employee Reference Photo foundation implementation note

Implemented locally/source-only under explicit Owner authorization for additive schema/migration + local/source implementation.

- Added `EmployeeReferencePhoto` governed sub-resource and additive migration `202608240001_g06_employee_reference_photo_v1`.
- Database partial unique guards enforce at most one ACTIVE and one PENDING_APPROVAL Reference Photo per Employee.
- No mutable permanent photo URL or image binary is stored in Employee. Storage metadata is private server-side only.
- Private storage adapter uses a dedicated future configuration key `EMPLOYEE_REFERENCE_PHOTOS_BUCKET`; this phase did not create a bucket or change any environment.
- Upload accepts JPEG/PNG only, <= 4 MB, validates file signature, dimensions (256..4096), aspect ratio, and SHA-256 checksum.
- ADMIN may direct-activate a photo; MANAGER submission remains PENDING_APPROVAL until ADMIN final approval.
- Retention A is implemented as post-commit supersession/deletion: new ACTIVE is committed first, superseded old photo immediately loses signed-view access, then physical object deletion occurs.
- Failed physical deletion records retry metadata without rolling back the new ACTIVE photo. Storage DELETE treats an already-absent object as idempotent success.
- Known Employee/pending conflicts are preflighted before object upload, while the transaction re-checks state under row locks to preserve race safety.
- Signed Reference Photo view URLs are short-lived (60 seconds) and are never issued for SUPERSEDED, REJECTED, CANCELLED, or deletion-requested rows.
- Employee Master `แก้ไขข้อมูล` contains the Reference Photo section; no separate navigation is introduced.
- Viewer/Employee self-change remains blocked.
- Attendance/Patrol event photos and live face/liveness frames remain non-retained under V1.
- No face model, liveness/PAD engine, biometric embedding/template persistence, Service Worker, controlled offline, Preview/Production deploy, or actual Supabase storage mutation is introduced in Phase 3A.

Phase 3A local validation evidence: focused 8/8 PASS; real PostgreSQL workflow 1/1 PASS; backend 591/591 PASS; frontend 393/393 PASS; full integration 164/164 PASS with 0 skipped; fresh PostgreSQL migration chain 23/23 PASS; Prisma validate/generate PASS; frontend production build PASS.


## Phase 3B architecture / engine-selection note (2026-08-24)

Phase 3B architecture was completed source-only on top of the Phase 3A Preview-accepted candidate. See `docs/G06_FACE_VERIFICATION_LIVENESS_V1_PHASE3B_ARCHITECTURE.md`.

Locked direction:

- server-authoritative short-lived verification session and single-use receipt;
- current ACTIVE Reference Photo 1:1 only;
- ACTIVE Attendance device P-256 proof required;
- PAD/liveness required before authoritative face acceptance;
- no client-authoritative `faceVerified` / `livenessPassed`;
- no 1:N roster search;
- no persistent biometric template/embedding;
- live frames and Attendance/Patrol event photos remain non-retained;
- pluggable provider adapter; prefer independently certified face-verification/PAD providers for Production assurance;
- Amazon Rekognition Face Liveness + stateless CompareFaces selected only as a practical engineering PoC candidate, not automatic Production provider approval;
- Web/PWA is a Pilot path until injection/device-integrity tests pass; Android/native hardening is required if browser assurance is insufficient.

No schema, migration, provider credential, runtime integration, Preview/Production mutation or deployment was performed by this Phase 3B architecture step.
