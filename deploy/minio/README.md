# MinIO/S3 preparation package

This package is preparation only. `STORAGE_PROVIDER=supabase` remains the default, Supabase PostgreSQL remains authoritative, and no Supabase object is copied, deleted, or switched by these templates.

## Topology

MinIO is an optional S3-compatible provider for private object storage. Keep the API/database on the existing topology. The example Compose file binds MinIO to loopback only and contains no credentials. Create separate private buckets for attendance selfie, face evidence, reference photos, and license documents. Do not expose the MinIO console or S3 API publicly without a separately reviewed TLS/authentication policy.

## Provider behavior

The application keeps the existing injected storage contracts and records `storageProvider`, bucket, object key, checksum, and retention metadata in PostgreSQL. `STORAGE_PROVIDER=supabase` preserves current behavior. `STORAGE_PROVIDER=s3` uses the optional AWS S3 SDK adapter with endpoint, region, credentials, and path-style configuration. Missing SDK/configuration fails closed; it does not silently fall back to Supabase. Signed-download wiring remains service authorization first, then short-lived private-object access.

Before any test or cutover, all target buckets must be private, keys must be contract-prefixed, and credentials must be supplied only through an untracked secret manager/environment file. No bucket policy or object is changed by this repository package.

## Checksum-first migration/copy procedure

No copy tool is enabled by default in this preparation commit. Any future copy implementation must:

1. Enumerate source metadata and destination metadata without deletion.
2. Validate key prefix, MIME, size, and SHA-256 before upload.
3. Use an idempotency key of `(provider,bucket,key,checksum)`; identical verified objects are `verified/skipped`.
4. Upload only missing/mismatched objects to a staging destination and verify a read-back checksum.
5. Emit counts `scanned/copied/verified/failed/skipped` without secrets or PII.
6. Keep `--dry-run` as the default and require an explicit Owner-approved flag for writes.
7. Never delete source Supabase objects. Deletion, provider metadata switch, and retention changes require a separate Owner gate after checksum evidence.

## Backup, restore, and rollback

Back up PostgreSQL metadata and retain the existing Supabase object backup/retention process before any copy. Separately back up MinIO data using an approved encrypted/off-host procedure; do not treat a filesystem copy as a verified object backup. Test restore into disposable PostgreSQL and MinIO targets, then compare object checksums and metadata. Rollback is configuration-only: set `STORAGE_PROVIDER=supabase`, restart the application, and retain both object stores. Do not delete or mutate either provider during rollback.

## Explicit blockers

MinIO production endpoint, TLS, credentials, bucket policy, network ACL, backup destination, and checksum manifest are not supplied or verified. Therefore this package is not Production-ready and does not authorize MinIO installation, object copy, Supabase deletion, metadata migration, or provider cutover.
