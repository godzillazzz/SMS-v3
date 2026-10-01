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

test("Production workflow Node heredoc terminators stay inside YAML run blocks", () => {
  const workflow = fs
    .readFileSync(workflowPath, "utf8")
    .replace(/\r\n/g, "\n");
  const heredocStarts = (workflow.match(/<<'NODE'/g) || []).length;
  const indentedTerminators = (workflow.match(/^ {10}NODE$/gm) || []).length;

  assert.ok(heredocStarts > 0, "expected inline Node checks in the release workflow");
  assert.equal(
    indentedTerminators,
    heredocStarts,
    "every Node heredoc terminator must remain indented under its YAML run scalar",
  );
  assert.doesNotMatch(
    workflow,
    /^NODE$/m,
    "an unindented heredoc terminator ends the YAML scalar and invalidates the workflow",
  );
});

test(
  "Production release guard shell blocks are syntactically valid on bash runners",
  { skip: process.platform === "win32" },
  () => {
    const workflow = fs
      .readFileSync(workflowPath, "utf8")
      .replace(/\r\n/g, "\n");
    for (const stepName of [
      "Validate exact source identity, branch ancestry, migration policy, and clean tree",
      "Revalidate exact source after Owner approval",
      "Create Git-sourced immutable Production candidate",
      "Verify immutable candidate, explicitly promote, then verify canonical Production",
    ]) {
      const script = extractRunBlock(workflow, stepName);
      const result = spawnSync("bash", ["-n"], {
        input: script,
        encoding: "utf8",
      });
      assert.equal(
        result.status,
        0,
        result.stderr || result.stdout || `bash -n failed: ${stepName}`,
      );
    }
  },
);

test("Production verifier checks native Git provenance and immutable runtime before promotion", () => {
  const workflow = fs.readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
  const create = extractRunBlock(workflow, "Create Git-sourced immutable Production candidate");
  const ciGuard = extractRunBlock(workflow, "Require successful exact-SHA CI evidence");
  const script = extractRunBlock(
    workflow,
    "Verify immutable candidate, explicitly promote, then verify canonical Production",
  );
  assert.match(workflow, /git show "\$GITHUB_SHA:scripts\/ci\/\$tool"/);
  assert.match(workflow, /vercel-api-deployment\.js/);
  assert.match(workflow, /inspect-vercel-deployment\.js/);
  assert.match(create, /create-vercel-git-candidate\.js/);
  assert.match(create, /candidate_canonical_alias_assigned/);
  assert.match(create, /inspect-vercel-deployment\.js "\$deployment_id" "\$TARGET_SHA" "\$SOURCE_BRANCH" production true/);
  assert.match(script, /IMMUTABLE_CANDIDATE_NO_CANONICAL_ALIAS=PASS/);
  assert.match(workflow, /CONTROL_PLANE_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(ciGuard, /RELEASE_CONTROL_PLANE_EXACT_SHA_CI=PASS/);
  assert.match(ciGuard, /APPLICATION_SOURCE_EXACT_SHA_CI=PASS/);
  assert.match(script, /verify_public_runtime "\$DEPLOYMENT_URL" IMMUTABLE_CANDIDATE true/);
  assert.match(script, /CANONICAL_ROLLBACK_ALIAS_STILL_CURRENT=PASS/);
  assert.match(script, /inspect-vercel-deployment\.js "\$DEPLOYMENT_ID" "\$TARGET_SHA" "\$SOURCE_BRANCH" production true/);
  assert.match(script, /inspect-vercel-deployment\.js "\$ROLLBACK_DEPLOYMENT_ID" "\$CURRENT_PRODUCTION_SOURCE_SHA" "\$CURRENT_PRODUCTION_SOURCE_REF" production false/);
  assert.ok(script.indexOf('inspect-vercel-deployment.js "$DEPLOYMENT_ID" "$TARGET_SHA" "$SOURCE_BRANCH" production true') < script.indexOf('promote "$DEPLOYMENT_ID"'));
  assert.match(script, /promote \"\$DEPLOYMENT_ID\"/);
  assert.match(
    script,
    /verify_public_runtime \"\$EXPECTED_CANONICAL_URL\" CANONICAL_PRODUCTION/,
  );
  assert.match(script, /approval\.status !== 401/);
  assert.match(script, /Approval Authority Matrix \/ SLA/);
  assert.match(script, /การเปลี่ยนแปลงสำคัญ/);
  assert.match(script, /เปลี่ยนชื่อ/);
  assert.match(script, /ย้ายหน่วยงาน \/ แผนก/);
  assert.match(script, /เปลี่ยนตำแหน่ง/);
  assert.match(script, /Data Retention Center \/ การเก็บรักษาข้อมูล/);
  assert.match(script, /รัน Cleanup รอบถัดไป/);
  assert.match(workflow, /Critical UI sentinels: PASS \(12\/12\)/);
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
  assert.match(sourceGuard, /Apply Approved EMP-UX Production Migration/);
  assert.match(sourceGuard, /Apply Approved PERF-05 Production Migration/);
  assert.match(sourceGuard, /Apply Approved Production Migration V2/);
  assert.match(sourceGuard, /Apply Approved MDG-01B Production Migration/);
  assert.match(sourceGuard, /EVIDENCE_WORKFLOW_EVENT='workflow_dispatch'/);
  assert.match(sourceGuard, /run\.event !== process\.env\.EVIDENCE_WORKFLOW_EVENT/);
  assert.match(sourceGuard, /one-time-vercel-production-sync\.yml/);
  assert.match(sourceGuard, /EVIDENCE_WORKFLOW_PATH/);
  assert.match(sourceGuard, /unexpected migration evidence workflow/);
  assert.match(sourceGuard, /Approve Production Migration/);
  assert.match(sourceGuard, /verify-approved-production-migration\.js/);
  assert.match(sourceGuard, /PRISMA_SCHEMA_CHANGED=\$\(sed -n 's\/\^prisma_schema_changed=\/\/p'/);
  assert.match(sourceGuard, /case "\$PRISMA_SCHEMA_CHANGED" in/);
  assert.match(sourceGuard, /expected_prisma=\$\(printf '%s\\n%s\\n' "\$MIGRATION_PATH" 'prisma\/schema\.prisma'/);
  assert.match(sourceGuard, /expected_prisma=\$\(printf '%s\\n' "\$MIGRATION_PATH"/);
  assert.match(sourceGuard, /test "\$MIGRATION_CURRENT_PRODUCTION_DEPLOYMENT_ID" = "\$ROLLBACK_DEPLOYMENT_ID"/);
  assert.match(sourceGuard, /test "\$MIGRATION_CURRENT_PRODUCTION_APPLICATION_SHA" = "\$CURRENT_PRODUCTION_SOURCE_SHA"/);
  assert.match(sourceGuard, /git diff --quiet "\$MIGRATION_SOURCE_SHA" "\$TARGET_SHA" -- prisma\/schema\.prisma prisma\/migrations/);
  assert.match(sourceGuard, /git merge-base --is-ancestor "\$EVIDENCE_HEAD" "\$GITHUB_SHA"/);
  assert.match(sourceGuard, /apply-approved-production-migration-v2\.yml/);
  assert.match(sourceGuard, /\$POST_VERIFY_SCRIPT/);
  assert.match(productionGuard, /verify-deployment-target\.js --verify/);
  assert.match(productionGuard, /prisma-migration\.js status/);
  assert.match(productionGuard, /\/tmp\/pre-applied-post-verify\.js/);
  assert.doesNotMatch(productionGuard, /verify-perf05-indexes\.js/);
  assert.doesNotMatch(productionGuard, /prisma-migration\.js deploy|prisma migrate deploy/);
  assert.match(rollbackGuard, /inspect "\$EXPECTED_CANONICAL_URL" --format=json/);
  assert.match(rollbackGuard, /ROLLBACK_CHECKPOINT_CURRENT=PASS/);
  assert.match(rollbackGuard, /inspect-vercel-deployment\.js "\$ROLLBACK_DEPLOYMENT_ID" "\$CURRENT_PRODUCTION_SOURCE_SHA" "\$CURRENT_PRODUCTION_SOURCE_REF" production false/);
  assert.match(workflow, /current_production_source_ref: \$\{\{ steps\.manifest\.outputs\.current_production_source_ref \}\}/);
});


test("revalidates the approved pre-applied migration from release-control evidence after Owner approval", () => {
  const workflow = fs.readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
  const revalidate = extractRunBlock(
    workflow,
    "Revalidate exact source after Owner approval",
  );

  assert.match(revalidate, /git fetch --no-tags origin "\$GITHUB_SHA"/);
  assert.match(revalidate, /git show "\$GITHUB_SHA:\$PRE_APPLIED_MIGRATION_MANIFEST_PATH"/);
  assert.match(revalidate, /verify-approved-production-migration\.js/);
  assert.match(revalidate, /validateSqlForMigration\(result\.migrationId/);
  assert.match(revalidate, /git merge-base --is-ancestor "\$MIGRATION_SOURCE_SHA" "\$TARGET_SHA"/);
  assert.match(revalidate, /git show "\$GITHUB_SHA:\$POST_VERIFY_SCRIPT" >\/tmp\/pre-applied-post-verify\.js/);
  assert.doesNotMatch(revalidate, /prisma-migration\.js deploy|prisma migrate deploy/);
});
