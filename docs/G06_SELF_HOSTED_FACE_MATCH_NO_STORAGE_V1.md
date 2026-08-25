# G06 Self-hosted Face Match + No-storage Evidence V1

Status: additive design/implementation checkpoint. Production runtime remains disabled.

## Owner decision

- Do not depend on paid AWS Face/Liveness for the current Attendance V1 direction.
- Current target is trusted server-side **1:1 face match** against the employee's active Reference Photo.
- Do **not** claim PAD/Liveness when only face matching is performed.
- The live Attendance photo is transient for now: process in memory, verify, then discard.
- A future private-server photo archive must be pluggable without redesigning Attendance.

## Verification modes

`FACE_MATCH_WITH_LIVENESS`
- Existing AWS PoC semantics.
- Verified state requires PAD=true, face match=true, injection risk=false.

`FACE_MATCH_ONLY`
- New self-hosted semantics.
- Verified state requires face match=true.
- `padPassed` and `injectionRiskDetected` stay NULL; the system must not manufacture a liveness PASS.

## Current no-storage path

`Camera -> SMS backend memory -> trusted self-hosted verifier -> MATCH/NO_MATCH -> zero buffers`

Default `AttendanceFaceEvidenceStorage` implementation is `NoopAttendanceFaceEvidenceStorage`.
It returns `NOT_STORED`, has no object reference, and writes no file to Supabase, Vercel disk, localStorage or sessionStorage.

## Future private storage hook

The verification orchestrator already depends on an `AttendanceFaceEvidenceStorage` adapter with:

- `store(input)`
- `remove(input)`

When the private server is ready, add a new adapter implementation. The current orchestration invokes evidence storage only after the trusted 1:1 match has produced an actionable receipt; failed/non-matching attempts remain `NOT_STORED`. Attendance/QR/GPS/session authority does not need to change. A later additive schema can persist opaque `objectRef`, provider, checksum, retention and purge metadata without storing a public URL.

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
