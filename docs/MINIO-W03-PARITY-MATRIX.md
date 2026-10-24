# W-03 transport parity matrix (design-only)

Status: DESIGN / NOT IMPLEMENTED. This document is the review gate before code changes.

## Invariants

All rows must remain identical between the existing Supabase backend and a future S3 backend. The service layer remains authoritative for authorization, scope, retention, purge, audit, Prisma metadata, checksum, and object-key generation. Backend adapters may only translate object transport.

| Contract | Existing seam | Inputs | Success output/state | Error/output invariants | DB/audit/retention invariants | Key rules |
|---|---|---|---|---|---|---|
| License document | injected `storage.put/remove/createSignedUrl` | object key, bytes, MIME, expiry | provider/bucket metadata; signed URL only after service authorization | upload/delete/sign provider errors map identically; no raw secret | Prisma document/revision writes and existing audit/retention unchanged | service-generated `licenses/...`; no backend rewrite |
| Reference photo | injected `storage.put/remove/getBytes/createSignedUrl` | employee photo key, validated bytes, MIME, expiry | provider/bucket metadata; bytes/signed URL | validation/auth errors occur before backend; provider errors sanitized | existing photo audit, approval, supersession/cleanup unchanged | service-generated employee key; safe display name unchanged |
| Face evidence | OUT OF SCOPE per Owner | no implementation or parity claim | no changes permitted in this task | no tests counted as deliverable | existing service remains unchanged | existing key rules unchanged |
| Attendance selfie | internal put/remove/list/reconcile/purge transport | employee/capture IDs, validated image, retention rows | hashed key, checksum/MIME/size, Prisma row and purge state | private-bucket check, invalid MIME/size/key, provider errors unchanged | existing Prisma selfie lifecycle, audit, orphan reconciliation and purge unchanged | HMAC employee path hash; never PII; exact existing prefix |

## Test plan

1. Run existing service tests unchanged with the existing fake Supabase storage.
2. Run the same assertions with a recording S3 fake implementing only the transport interface.
3. Assert byte-for-byte request body, exact key, bucket, MIME, checksum, error code, and expiry arguments.
4. Assert deny/scope/purged/expired paths make zero backend `sign` calls.
5. Assert success paths preserve Prisma writes, `storageProvider`, bucket/key/checksum, audit event, and retention/purge metadata.
6. Assert invalid bucket/config fails before any backend request.
7. Disposable MinIO integration is a separate opt-in gate and remains BLOCKED until a real disposable service and verified image/license evidence exist. No fake test counts as integration evidence.

No code, provider activation, remote mutation, database write, or object copy/delete is authorized by this design document.
