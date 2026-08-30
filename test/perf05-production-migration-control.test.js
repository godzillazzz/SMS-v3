"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const workflow = fs.readFileSync(
  path.join(
    root,
    ".github/workflows/apply-approved-perf05-production-migration.yml",
  ),
  "utf8",
);
const manifest = JSON.parse(
  fs.readFileSync(
    path.join(
      root,
      ".github/releases/approved-perf05-production-migration.json",
    ),
    "utf8",
  ),
);
const verifier = fs.readFileSync(
  path.join(root, "scripts/ci/verify-perf05-indexes.js"),
  "utf8",
);

const expectedIndexes = [
  "users_account_status_requested_at_created_at_idx",
  "attendance_device_change_requests_status_created_at_idx",
  "employee_reference_photos_status_uploaded_at_idx",
  "employee_license_documents_status_uploaded_at_idx",
  "leave_requests_status_requested_at_idx",
];

test("PERF-05 migration manifest is migration-only and exact-source pinned", () => {
  assert.equal(manifest.migration_id, "PERF-05");
  assert.match(manifest.source_commit_sha, /^[0-9a-f]{40}$/);
  assert.match(manifest.source_tree_sha, /^[0-9a-f]{40}$/);
  assert.equal(manifest.application_deploy, false);
  assert.equal(manifest.destructive_rollback, false);
  assert.equal(manifest.owner_action, "APPROVE_PRODUCTION_MIGRATION_ONLY");
});

test("PERF-05 workflow has one protected migration gate and no Vercel deployment command", () => {
  assert.match(workflow, /name: Approve Production Migration/);
  assert.match(workflow, /environment:\s*\n\s*name: production-sms-v3-staging/);
  assert.match(workflow, /node scripts\/ci\/prisma-migration\.js deploy/);
  assert.match(workflow, /git show \"\$GITHUB_SHA:scripts\/ci\/verify-perf05-indexes\.js\"/);
  assert.match(workflow, /node \/tmp\/verify-perf05-indexes\.js/);
  assert.doesNotMatch(
    workflow,
    /vercel(?:@[^\s]+)?\s+deploy|vercel\s+promote|vercel\s+rollback/i,
  );
  assert.match(workflow, /Application deployment performed: NO/);
});

test("PERF-05 Production verifier requires all five exact index names", () => {
  for (const indexName of expectedIndexes)
    assert.match(verifier, new RegExp(indexName));
});
