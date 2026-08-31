const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");

const workflowPath = path.join(
  process.cwd(),
  ".github",
  "workflows",
  "deploy-approved-production-v2.yml",
);

function extractRunBlock(workflow, stepName) {
  const marker = `      - name: ${stepName}\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `step not found: ${stepName}`);
  const runMarker = "        run: |\n";
  const runStart = workflow.indexOf(runMarker, start);
  assert.notEqual(runStart, -1, `run block not found: ${stepName}`);
  const contentStart = runStart + runMarker.length;
  const nextStep = workflow.indexOf("\n      - name:", contentStart);
  const raw = workflow.slice(
    contentStart,
    nextStep === -1 ? workflow.length : nextStep,
  );
  return raw
    .split("\n")
    .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
    .join("\n");
}

test(
  "protected Production verifier shell is syntactically valid on bash runners",
  { skip: process.platform === "win32" },
  () => {
    const workflow = fs
      .readFileSync(workflowPath, "utf8")
      .replace(/\r\n/g, "\n");
    const script = extractRunBlock(
      workflow,
      "Verify immutable candidate, explicitly promote, then verify canonical Production",
    );
    const result = spawnSync("bash", ["-n"], {
      input: script,
      encoding: "utf8",
    });
    assert.equal(
      result.status,
      0,
      result.stderr || result.stdout || "bash -n failed",
    );
  },
);

test("Production verifier avoids Vercel beta curl and keeps authoritative canonical checks", () => {
  const workflow = fs.readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
  const script = extractRunBlock(
    workflow,
    "Verify immutable candidate, explicitly promote, then verify canonical Production",
  );
  assert.equal(script.includes('vercel@"$VERCEL_CLI_VERSION" curl'), false);
  assert.match(script, /IMMUTABLE_CANDIDATE_INSPECT=PASS/);
  assert.match(script, /inspect \"\$DEPLOYMENT_ID\" --format=json/);
  assert.match(script, /promote \"\$DEPLOYMENT_ID\"/);
  assert.match(
    script,
    /verify_public_runtime \"\$EXPECTED_CANONICAL_URL\" CANONICAL_PRODUCTION/,
  );
  assert.match(script, /approval\.status !== 401/);
});


test("pre-applied migration release guard requires exact prior Production migration evidence and stays read-only", () => {
  const workflow = fs.readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
  const sourceGuard = extractRunBlock(
    workflow,
    "Validate exact source identity, branch ancestry, migration policy, and clean tree",
  );
  const productionGuard = extractRunBlock(
    workflow,
    "Revalidate pre-applied Production database state",
  );
  const rollbackGuard = extractRunBlock(
    workflow,
    "Verify rollback checkpoint is still current Production",
  );

  assert.match(sourceGuard, /PRE_APPLIED_APPROVED_MIGRATION/);
  assert.match(
    workflow,
    /PRE_APPLIED_MIGRATION_EVIDENCE_RUN_ID: \$\{\{ steps\.manifest\.outputs\.pre_applied_migration_evidence_run_id \}\}\r?\n\s+ROLLBACK_DEPLOYMENT_ID: \$\{\{ steps\.manifest\.outputs\.rollback_deployment_id \}\}/,
  );
  assert.match(sourceGuard, /Apply Approved Production Migration V2/);
  assert.match(sourceGuard, /Approve Production Migration/);
  assert.match(sourceGuard, /verify-approved-production-migration\.js/);
  assert.match(sourceGuard, /test "\$MIGRATION_ID" = "CFG-03"/);
  assert.match(sourceGuard, /test "\$MIGRATION_CURRENT_PRODUCTION_DEPLOYMENT_ID" = "\$ROLLBACK_DEPLOYMENT_ID"/);
  assert.match(sourceGuard, /test "\$MIGRATION_CURRENT_PRODUCTION_APPLICATION_SHA" = "\$CURRENT_PRODUCTION_SOURCE_SHA"/);
  assert.match(sourceGuard, /git diff --quiet "\$MIGRATION_SOURCE_SHA" "\$TARGET_SHA" -- prisma\/schema\.prisma prisma\/migrations/);
  assert.match(sourceGuard, /git merge-base --is-ancestor "\$EVIDENCE_HEAD" "\$GITHUB_SHA"/);
  assert.match(sourceGuard, /apply-approved-production-migration-v2\.yml/);
  assert.match(sourceGuard, /verify-cfg03-production-migration\.js|\$POST_VERIFY_SCRIPT/);
  assert.match(productionGuard, /verify-deployment-target\.js --verify/);
  assert.match(productionGuard, /prisma-migration\.js status/);
  assert.match(productionGuard, /\/tmp\/pre-applied-post-verify\.js/);
  assert.doesNotMatch(productionGuard, /verify-perf05-indexes\.js/);
  assert.doesNotMatch(productionGuard, /prisma-migration\.js deploy|prisma migrate deploy/);
  assert.match(rollbackGuard, /inspect "\$EXPECTED_CANONICAL_URL" --format=json/);
  assert.match(rollbackGuard, /ROLLBACK_CHECKPOINT_CURRENT=PASS/);
  assert.match(rollbackGuard, /expectedId, expectedProjectId/);
});


test("revalidates the CFG-03 pre-applied migration from release-control evidence after Owner approval", () => {
  const workflow = fs.readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
  const revalidate = extractRunBlock(
    workflow,
    "Revalidate exact source after Owner approval",
  );

  assert.match(revalidate, /git fetch --no-tags origin "\$GITHUB_SHA"/);
  assert.match(revalidate, /git show "\$GITHUB_SHA:\$PRE_APPLIED_MIGRATION_MANIFEST_PATH"/);
  assert.match(revalidate, /verify-approved-production-migration\.js/);
  assert.match(revalidate, /validateCfg03Sql/);
  assert.match(revalidate, /git merge-base --is-ancestor "\$MIGRATION_SOURCE_SHA" "\$TARGET_SHA"/);
  assert.match(revalidate, /git show "\$GITHUB_SHA:\$POST_VERIFY_SCRIPT" >\/tmp\/pre-applied-post-verify\.js/);
  assert.doesNotMatch(revalidate, /prisma-migration\.js deploy|prisma migrate deploy/);
});
