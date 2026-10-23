# R6A release provenance design

Status: design and local regression tests only. No workflow, deployment, Production, database, migration, secret, or runtime integration is included.

## Purpose

A release is auditable only when the backend and frontend can be proven to come from one exact source/build record. The verifier in `scripts/ci/verify-release-provenance.js` is intentionally isolated from the existing release workflow until a separately approved integration task defines how CI emits and transports the record.

## Manifest schema: `sms-v3-release-provenance/v1`

Required fields:

- `schema_version`: literal `sms-v3-release-provenance/v1`.
- `git_sha`: full 40-character Git commit SHA.
- `tree_sha`: full 40-character Git tree SHA for `git_sha`.
- `build_id`: non-empty CI/build identifier.
- `build_timestamp`: parseable UTC timestamp.
- `source_branch`: non-empty source branch/ref.
- `ci_run_id`: positive CI run identifier.
- `artifacts.backend_digest`: SHA-256 of the canonical, sorted backend file inventory.
- `artifacts.frontend_inventory_digest`: SHA-256 of the canonical, sorted frontend file inventory.
- `tooling.node`: Node.js version used to build/verify.
- `tooling.package_manager`: package manager and version.
- `tooling.verifier`: verifier identity/version.

Each inventory is a sorted JSON array of `{path, bytes, sha256}` entries. Paths are relative, use `/` separators, and file bytes are hashed directly. The inventory JSON is then serialized deterministically and SHA-256 hashed. This is an inventory contract, not a claim that current Production has been proven against it.

## Verification rules

1. Validate every required field and exact format; missing or malformed records fail closed.
2. Compare full Git SHA, tree SHA, build ID, source branch, and CI run ID with the release identity supplied by the caller.
3. Recompute backend and frontend inventory digests from the candidate artifacts.
4. Reject any modified frontend asset, modified backend artifact, mixed backend/frontend sources, mismatched SHA, missing manifest, or missing artifact root.
5. Do not use a deployment URL, branch name, project name, or successful readiness response as a substitute for the manifest.

## Explicit non-goals and next integration gate

This design does not generate manifests, sign manifests, alter CI workflows, inspect Vercel, bind a deployment, or prove current Production frontend provenance. The current Production frontend provenance remains UNKNOWN. A future integration task must specify the canonical build output roots, manifest transport/signature policy, CI attestation source, and exact deployment-side readback before wiring this verifier into release control.
