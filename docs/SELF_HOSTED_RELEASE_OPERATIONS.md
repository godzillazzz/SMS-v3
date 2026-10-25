# Self-hosted release operations

This tooling is a release artifact builder, read-only verifier, and explicitly gated paired cutover for the Debian self-hosted runtime. It does not migrate or roll back PostgreSQL, mutate MinIO/Supabase objects, or infer provenance for the existing `/var/www/sms` directory.

## Build an immutable paired release

From a clean checkout, run as root (the build applies `root:smsv3` backend and `root:www-data` frontend ownership and fails before any install step if either group is missing), supplying one exact 40-character commit SHA:

```sh
npm run self-hosted:release -- build \
  --sha <EXACT_GIT_SHA> \
  --output /srv/sms-v3/releases \
  --identity operator@host \
  --previous-release /srv/sms-v3/releases/<KNOWN_GOOD_RELEASE>
```

The resulting `sms-v3-<SHA>` directory contains `backend/`, `frontend/dist/`, and `release-manifest.json`. The manifest binds the Git SHA/tree SHA, build identity/toolchain, backend and frontend inventory digests, every frontend asset hash, the previous rollback release, and the compatibility contract `postgres-authoritative-mixed-provider-read-v1` (Supabase plus MinIO/S3 reads). The build runs `npm ci --omit=dev`, Prisma generate, frontend `npm ci`, and the frontend production build. It never runs migrations.

## Verify before any cutover

```sh
npm run self-hosted:release -- verify \
  --release /srv/sms-v3/releases/sms-v3-<SHA> \
  --repo /srv/sms-v3-checkout \
  --trusted-manifest-sha256 <CANDIDATE_EXTERNALLY_PINNED_SHA256> \
  --rollback-target /srv/sms-v3/releases/<KNOWN_GOOD_RELEASE> \
  --trusted-rollback-manifest-sha256 <ROLLBACK_EXTERNALLY_PINNED_SHA256>
```

Verification fails closed unless an externally pinned manifest digest and an independent trusted Git checkout are supplied. It rejects symlinks/non-regular files, path traversal, TOCTOU changes, missing mandatory backend/static checks, invalid/mismatched Git/tree identity, manifest/inventory/asset tampering, and releases or rollback targets that do not preserve database-authoritative mixed-provider reads. A manifest's self-derived digest is never trusted as its own authenticity proof.

## Cutover gates

The default is read-only:

```sh
npm run self-hosted:release -- cutover --release <RELEASE_DIR>
```

A real cutover requires all of these exact gates, in order:

1. **Artifact creation:** exact SHA build succeeds and the manifest is retained with its digest.
2. **Preflight:** verifier passes for the candidate and rollback target; host filesystem, service account, environment file, and static asset/readiness checks are reviewed. Existing production webroot provenance remains **NOT VERIFIED** until an authorized versioned cutover.
3. **OWNER deploy authorization:** operator supplies `--apply --operator-gate I_UNDERSTAND_ATOMIC_SELF_HOSTED_CUTOVER` only after explicit Owner authorization. `--apply` also requires `--rollback-target` to be the exact release the shared pointer `/srv/sms-v3/.current` currently resolves to, pinned by its own `--trusted-rollback-manifest-sha256`. No database rollback or migration is implied.
4. **Post-cutover verification:** the verifier performs fixed structured backend/static/pointer checks; no arbitrary shell health command is accepted or executed. Backend and frontend are exposed through one shared release pointer, so interruption cannot leave mixed pointers. Any failed check restores the prior shared pointer.
5. **Rollback authorization/trigger:** Owner authorizes rollback to a verified compatible release; run verifier against that target before cutover. Automatic restore is only the safety response to failed post-cutover checks, not a database rollback.

The implementation atomically renames one staged shared pointer and preserves the old release directory and environment files. Production paths are intentionally not exercised by the rehearsal.

## Rehearsal and evidence

The focused rehearsal uses disposable directories and synthetic values:

```sh
node --test test/self-hosted-release.test.js
```

It proves successful manifest verification, tamper rejection, default dry-run/no production-path mutation, and MinIO mixed-provider compatibility rejection. Synthetic example manifest values are emitted in the test fixture (`git_sha=a...`, `tree_sha=b...`, `build_identity=synthetic@test`); no secrets or authenticated endpoints are used.

No claim is made here about current Production frontend provenance, database state, MinIO objects, backups, GPG, NAS, or rollback readiness. Those remain Owner/server gates.
