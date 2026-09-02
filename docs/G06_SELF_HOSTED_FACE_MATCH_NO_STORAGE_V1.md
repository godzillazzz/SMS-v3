# G06 Self-hosted Face Match + No-storage Evidence V1

Status: additive design/implementation checkpoint. Production runtime remains disabled.

## Owner decision

- Do not depend on paid AWS Face/Liveness for the current Attendance V1 direction.
- Current target is trusted server-side **1:1 face match** against the employee's active Reference Photo, preceded by a Server-issued **Simple Active Face Challenge** anti-spoof risk gate.
- Do **not** claim PAD/Liveness when only face matching is performed.
- The routine live Attendance photo is transient: process in memory, verify, then discard.
- Routine Attendance/Patrol live-event images must not be retained. Any future persistence proposal requires separate Owner authorization.

## Verification modes

`FACE_MATCH_WITH_LIVENESS`
- Existing AWS PoC semantics.
- Verified state requires PAD=true, face match=true, injection risk=false.

`FACE_MATCH_ONLY`
- New self-hosted semantics.
- Verified state requires face match=true.
- `padPassed` and `injectionRiskDetected` stay NULL; the system must not manufacture a liveness PASS.

## Current no-storage path

Server challenge -> front-camera transient frame sequence -> final live still -> SMS backend memory -> trusted self-hosted verifier -> ACTIVE_CHALLENGE_PASS + MATCH -> zero buffers

Routine verification does not instantiate or call AttendanceFaceEvidenceStorage. A trusted ACTIVE_CHALLENGE_PASS + MATCH may mint the short-lived opaque verification receipt while the live photo and challenge frames remain transient.

The existing AttendanceEvidence schema/storage adapter and Admin view/purge surface are retained only for compatibility and controlled cleanup of any historical records. They are not a write path for new routine Attendance verification.

Any future proposal to retain routine Attendance/Patrol live images is a separate Owner decision and must not be enabled through configuration alone.

## Simple Active Face Challenge (not certified Liveness/PAD)

- The Server derives a fresh challenge from the random `FaceVerificationSession.id`; the browser cannot choose the challenge.
- V1 challenge set is bounded to `TURN_LEFT`, `TURN_RIGHT`, `LOOK_UP`, `LOOK_DOWN`.
- The PWA captures exactly four transient JPEG challenge frames plus one final still using canvas snapshots; no Gallery/file picker and no `MediaRecorder` requirement.
- The browser sends only the images to the provider-neutral `/attendance/...` facade. It does not send `activeChallengePassed`, `faceMatchPassed`, `padPassed`, provider name, score, embedding, or template.
- The SMS backend recomputes the challenge from the session ID and forwards challenge metadata and frames server-to-server to the trusted verifier.
- The trusted verifier must return both boolean `activeChallengePassed` and boolean `match`. Missing either value fails closed.
- `ACTIVE_CHALLENGE_FAILED` and `FACE_MATCH_FAILED` remain distinct. Only challenge=true AND match=true may mint an opaque receipt.
- `padPassed` remains `NULL` for `FACE_MATCH_ONLY`; this control is a lightweight anti-spoof/risk gate and must never be represented as certified Liveness/PAD.
- Challenge frames, final live photo, and the process copy of the Reference Photo are released/overwritten after verification; routine attempts do not invoke AttendanceEvidence storage.

## Self-hosted verifier contract

Server-to-server only. Browser/client result booleans are not trusted.

Environment contract (not enabled by this checkpoint):

- `FACE_VERIFICATION_SELF_HOSTED_API_ENABLED=true`
- `FACE_VERIFIER_URL=https://...`
- `FACE_VERIFIER_SHARED_TOKEN=<server secret>`

The SMS backend sends multipart fields:

- `requestRef`
- `mode=FACE_MATCH_ONLY`
- `livePhoto`
- `referencePhoto`

Expected verifier response is intentionally narrow:

```json
{
  "activeChallengePassed": true,
  "match": true,
  "resultCode": "MATCH",
  "policyProfileId": "private-v1",
  "engineVersion": "engine-version"
}
```

Scores/embeddings/templates are not returned to the browser and are not persisted by this V1 adapter.

## Provider-neutral browser facade

The employee PWA does not call the self-hosted verifier route directly. Browser orchestration uses only the gated Attendance contract under `/attendance/...` for verification start, device proof, one transient live-photo match request, and opaque-receipt Attendance event acceptance. Provider selection and trusted face-match interpretation remain server-side.

The browser never submits `padPassed` or `faceMatchPassed`, never receives provider scores/templates, and may show Attendance success only after the server returns a committed `attendanceAccepted: true` event result.

## Runtime gates

- Production remains hard-disabled regardless of flags.
- Self-hosted face routes are Preview/test gated.
- Attendance runtime becomes eligible for the self-hosted path only when the Preview Attendance flag, self-hosted flag, HTTPS verifier URL and server token are all configured.
- This checkpoint does not change any Vercel environment values and does not run any Production migration.

## Storage/lifecycle invariant

On every success or failure path, the live request image buffer and the fetched Reference Photo buffer copy are overwritten in process memory after verification completes. The authoritative Reference Photo record itself remains governed by the existing private Reference Photo storage workflow.
