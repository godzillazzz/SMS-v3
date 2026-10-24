# Self-hosted release operations

This tooling is a release artifact builder, read-only verifier, and explicitly gated paired cutover for the Debian self-hosted runtime. It does not migrate or roll back PostgreSQL, mutate MinIO/Supabase objects, or infer provenance for the existing `/var/www/sms` directory.

## Build an immutable paired release

From a clean checkout, supply one exact 40-character commit SHA:

```sh
npm run self-hosted:release -- build \
  --sha <EXACT_GIT_SHA> \
  --output /opt/sms-v3/releases \
  --identity operator@host \
  --previous-release /opt/sms-v3/releases/<KNOWN_GOOD_RELEASE>
```

The resulting `sms-v3-<SHA>` directory contains `backend/`, `frontend/dist/`, and `release-manifest.json`. The manifest binds the Git SHA/tree SHA, build identity/toolchain, backend and frontend inventory digests, every frontend asset hash, the previous rollback release, and the compatibility contract `postgres-authoritative-mixed-provider-read-v1` (Supabase plus MinIO/S3 reads). The build runs `npm ci --omit=dev`, Prisma generate, frontend `npm ci`, and the frontend production build. It never runs migrations.

## Verify before any cutover

```sh
npm run self-hosted:release -- verify \
  --release /opt/sms-v3/releases/sms-v3-<SHA> \
  --rollback-target /opt/sms-v3/releases/<KNOWN_GOOD_RELEASE>
```

Verification rejects a missing frontend or manifest, invalid/mismatched Git or tree identity, manifest/inventory/asset tampering, and releases or rollback targets that do not preserve database-authoritative mixed-provider reads.

## Cutover gates

The default is read-only:

```sh
npm run self-hosted:release -- cutover --release <RELEASE_DIR>
```

A real cutover requires all of these exact gates, in order:

1. **Artifact creation:** exact SHA build succeeds and the manifest is retained with its digest.
2. **Preflight:** verifier passes for the candidate and rollback target; host filesystem, service account, environment file, and static asset/readiness checks are reviewed. Existing production webroot provenance remains **NOT VERIFIED** until an authorized versioned cutover.
3. **OWNER deploy authorization:** operator supplies `--apply --operator-gate I_UNDERSTAND_ATOMIC_SELF_HOSTED_CUTOVER` only after explicit Owner authorization. No database rollback or migration is implied.
4. **Post-cutover verification:** verify `/health`, `/api/v1/ready`, frontend static asset hashes, and that backend/frontend pointers resolve to the same release. Any failed health/readiness/static verification triggers restore to the prior paired pointers.
5. **Rollback authorization/trigger:** Owner authorizes rollback to a verified compatible release; run verifier against that target before cutover. Automatic restore is only the safety response to failed post-cutover checks, not a database rollback.

The implementation stages symlinks on the same filesystem and renames the paired pointers. It preserves the old release directory and environment files. Production paths are intentionally not exercised by the rehearsal.

## Rehearsal and evidence

The focused rehearsal uses disposable directories and synthetic values:

```sh
node --test test/self-hosted-release.test.js
```

It proves successful manifest verification, tamper rejection, default dry-run/no production-path mutation, and MinIO mixed-provider compatibility rejection. Synthetic example manifest values are emitted in the test fixture (`git_sha=a...`, `tree_sha=b...`, `build_identity=synthetic@test`); no secrets or authenticated endpoints are used.

No claim is made here about current Production frontend provenance, database state, MinIO objects, backups, GPG, NAS, or rollback readiness. Those remain Owner/server gates.
