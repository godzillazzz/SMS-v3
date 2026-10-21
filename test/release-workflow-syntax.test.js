const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");

const sentinelManifest = require('../frontend/src/release-runtime-sentinels.json');
const workflowPath = path.join(
  process.cwd(),
  ".github",
  "workflows",
  "deploy-approved-production-v2.yml",
);

function findDuplicateMappingKeys(yamlText) {
  const duplicates = [];
  const contexts = new Map();
  const sequenceGenerations = new Map();
  const mappingStack = [];
  let blockScalarIndent = null;

  for (const [index, rawLine] of yamlText.replace(/\r\n/g, "\n").split("\n").entries()) {
    const lineNumber = index + 1;
    const leadingWhitespace = rawLine.match(/^\s*/)[0].length;
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (blockScalarIndent !== null) {
      if (leadingWhitespace > blockScalarIndent || trimmed.startsWith("#")) continue;
      blockScalarIndent = null;
    }

    const sequence = rawLine.match(/^(\s*)-($|\s)/);
    if (sequence) {
      const sequenceIndent = sequence[1].length;
      while (mappingStack.length && mappingStack.at(-1).indent >= sequenceIndent) mappingStack.pop();
      const generation = (sequenceGenerations.get(sequenceIndent) || 0) + 1;
      sequenceGenerations.set(sequenceIndent, generation);
      mappingStack.push({
        indent: sequenceIndent,
        key: `#${generation}`,
        contextId: `sequence:${sequenceIndent}:${generation}`,
      });
      for (const indent of contexts.keys()) {
        if (indent > sequenceIndent) contexts.delete(indent);
      }
    }

    const mapping = rawLine.match(/^(\s*)([A-Za-z0-9_.\-]+):(?:\s|$)(.*)$/);
    if (!mapping) continue;
    const indent = mapping[1].length;
    const key = mapping[2];
    while (mappingStack.length && mappingStack.at(-1).indent >= indent) mappingStack.pop();
    const parent = mappingStack.at(-1);
    const parentGeneration = parent ? `${parent.contextId}/${parent.key}` : "root";
    const contextId = `${parentGeneration}|${indent}`;
    const keys = contexts.get(contextId) || new Map();
    if (keys.has(key)) {
      duplicates.push({ key, firstLine: keys.get(key), duplicateLine: lineNumber });
    } else {
      keys.set(key, lineNumber);
      contexts.set(contextId, keys);
    }
    mappingStack.push({ indent, key, contextId });

    if (/^[|>][+-]?\d*$/.test(mapping[3].trim())) blockScalarIndent = indent;
  }
  return duplicates;
}

test("all GitHub workflow YAML mappings have unique keys", () => {
  const workflowDir = path.join(process.cwd(), ".github", "workflows");
  const workflowFiles = fs
    .readdirSync(workflowDir)
    .filter((file) => /\.ya?ml$/i.test(file))
    .sort();
  assert.ok(workflowFiles.length > 0, "expected GitHub workflow files");

  for (const file of workflowFiles) {
    const source = fs.readFileSync(path.join(workflowDir, file), "utf8");
    assert.deepEqual(
      findDuplicateMappingKeys(source),
      [],
      `${file} contains duplicate YAML mapping keys`,
    );
  }

  const mutated = fs
    .readFileSync(workflowPath, "utf8")
    .replace(
      "          DIRECT_URL: ${{ secrets.DIRECT_URL }}\n          VERCEL_TOKEN:",
      "          DIRECT_URL: ${{ secrets.DIRECT_URL }}\n        env:\n          VERCEL_TOKEN:",
    );
  const mutationFindings = findDuplicateMappingKeys(mutated);
  assert.ok(
    mutationFindings.some(({ key }) => key === "env"),
    "mutation proof: duplicate env mapping must be detected",
  );
});

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

function workflowRunBlocks(workflow, file) {
  const lines = workflow.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const run = lines[index].match(/^(\s*)run:\s*\|[-+]?\s*$/);
    if (!run) continue;
    const runIndent = run[1].length;
    let stepStart = index;
    while (stepStart >= 0 && !/^\s*-\s+/.test(lines[stepStart])) stepStart -= 1;
    let shell = null;
    for (let cursor = stepStart + 1; cursor < index; cursor += 1) {
      const shellMatch = lines[cursor].match(/^\s*shell:\s*(\S+)\s*$/);
      if (shellMatch) shell = shellMatch[1];
    }
    const content = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const line = lines[cursor];
      const indent = line.match(/^\s*/)[0].length;
      if (line.trim() && indent <= runIndent) break;
      content.push(line.startsWith(" ".repeat(runIndent + 2)) ? line.slice(runIndent + 2) : line);
      cursor += 1;
    }
    if (shell === null || shell === "bash") blocks.push({ file, line: index + 1, script: content.join("\n") });
    index = cursor - 1;
  }
  return blocks;
}

function bashSyntaxFindings(workflowDir) {
  const findings = [];
  const files = fs.readdirSync(workflowDir).filter((file) => /\.ya?ml$/i.test(file)).sort();
  for (const file of files) {
    const source = fs.readFileSync(path.join(workflowDir, file), "utf8");
    for (const block of workflowRunBlocks(source, file)) {
      const script = block.script.replace(/\$\{\{[\s\S]*?\}\}/g, "__GITHUB_EXPRESSION__");
      const result = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
      if (result.status !== 0) findings.push({ file, line: block.line, error: result.stderr.trim() });
    }
  }
  return findings;
}

test("every workflow bash run block passes bash -n", { skip: process.platform === "win32" }, () => {
  const workflowDir = path.join(process.cwd(), ".github", "workflows");
  assert.deepEqual(bashSyntaxFindings(workflowDir), [], "workflow bash syntax errors");
  const workflow = fs.readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
  const mutated = workflow.replace(
    /          record=\$\(node -e '[^\n]+\n          echo "current_production_post_release_record=\$record"/,
    '          echo "current_production_post_release_record=$(node -e \\"process.stdout.write(\\"bad\\")\\")"',
  );
  assert.notEqual(mutated, workflow, "mutation proof target must exist");
  const mutatedBlock = workflowRunBlocks(mutated, path.basename(workflowPath)).find(({ script }) => script.includes("current_production_post_release_record=$(node -e"));
  assert.ok(mutatedBlock, "mutation proof run block must be found");
  const mutatedResult = spawnSync("bash", ["-n"], { input: mutatedBlock.script, encoding: "utf8" });
  assert.notEqual(mutatedResult.status, 0, "mutation proof: bad quoting must fail bash -n");
});

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

test("Production workflow loads every referenced release-control helper before use", () => {
  const workflow = fs.readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
  const loader = extractRunBlock(workflow, "Load release-control verifier from dispatched source SHA");
  const toolList = loader.match(/for tool in ([^\n]+); do/);
  assert.ok(toolList, "expected the release-control helper loader loop");
  const loaded = new Set(toolList[1].trim().split(/\s+/));
  const referenced = new Set(
    [...workflow.matchAll(/\/tmp\/sms-release-control-plane\/([A-Za-z0-9-]+\.js)\b/g)]
      .map((match) => match[1]),
  );

  assert.ok(referenced.size > 0, "expected release-control helper references");
  for (const filename of referenced) {
    assert.ok(loaded.has(filename), `${filename} must be loaded from the dispatched control-plane SHA before use`);
  }
});

test(
  "Production release guard shell blocks are syntactically valid on bash runners",
  { skip: process.platform === "win32" },
  () => {
    const workflow = fs
      .readFileSync(workflowPath, "utf8")
      .replace(/\r\n/g, "\n");
    for (const stepName of [
      "Verify pre-applied Production baseline before Owner gate",
      "Validate exact source identity, branch ancestry, migration policy, and clean tree",
      "Revalidate exact source after Owner approval",
      "Verify pre-applied Production baseline immediately after Owner approval",
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
  assert.ok(sentinelManifest.runtime.includes('ตารางผู้มีอำนาจอนุมัติและกรอบเวลา'));
  assert.ok(sentinelManifest.runtime.includes('เกณฑ์ SLA'));
  assert.ok(sentinelManifest.runtime.includes('การเปลี่ยนแปลงสำคัญ'));
  assert.ok(sentinelManifest.runtime.includes('เปลี่ยนชื่อ'));
  assert.ok(sentinelManifest.runtime.includes('ย้ายหน่วยงาน / แผนก'));
  assert.ok(sentinelManifest.runtime.includes('เปลี่ยนตำแหน่ง'));
  assert.ok(sentinelManifest.runtime.includes('Data Retention Center / การเก็บรักษาข้อมูล'));
  assert.ok(sentinelManifest.runtime.includes('รัน Cleanup รอบถัดไป'));
  assert.ok(sentinelManifest.runtime.includes('SUPPORT_SITE'));
  assert.ok(sentinelManifest.runtime.includes('ช่วยปฏิบัติงาน'));
  assert.match(workflow, /Critical UI sentinels: PASS \(20\/20\)/);
});

test("Production runtime verification includes the G06 Simple Attendance contract", () => {
  const workflow = fs.readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
  const runtime = extractRunBlock(
    workflow,
    "Verify immutable candidate, explicitly promote, then verify canonical Production",
  );

  for (const sentinel of [
    "GPS / GEOFENCE",
    "SUPPORT_SITE",
    "ช่วยปฏิบัติงาน",
    "เครื่องแรกจะผูกอัตโนมัติ",
    "ใช้อุปกรณ์อื่น · ต้องตรวจ",
    "ออฟไลน์พร้อมใช้งาน",
    "รอ ADMIN ยืนยันก่อนนับ",
  ]) {
    assert.ok(sentinelManifest.runtime.includes(sentinel), `missing G06 runtime sentinel: ${sentinel}`);
  }
  assert.match(runtime, /SENTINELS=\$\{sentinels\.length\}/);
  assert.match(workflow, /Critical UI sentinels: PASS \(20\/20\)/);
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


test('Stage B baseline workflow is pinned, scoped, and fail-closed', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
  assert.match(workflow, /TRUSTED_SHA_A: 04e0a76b478c285c263a2757b350efc6fa76f999/);
  assert.match(workflow, /VERCEL_CANONICAL_IDENTITY: DEFERRED_TO_PROTECTED_ENVIRONMENT/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /continue-on-error:/);
  assert.doesNotMatch(workflow.slice(workflow.indexOf('    env:\n      VERCEL_ORG_ID'), workflow.indexOf('    outputs:')), /VERCEL_TOKEN:/);
  assert.match(workflow, /INVARIANT_FINGERPRINT|BASELINE_INVARIANT_FINGERPRINT_DRIFT/);
});

test('SELFIE-POLICY null baseline guard is present before and after the Owner gate', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
  const prepareGuard = workflow.indexOf('Verify pre-applied Production baseline before Owner gate');
  const environment = workflow.indexOf('environment:\n      name: production-sms-v3-staging');
  const postGuard = workflow.indexOf('Verify pre-applied Production baseline immediately after Owner approval');
  const npmCi = workflow.indexOf('      - run: npm ci', postGuard);
  assert.ok(prepareGuard >= 0 && prepareGuard < environment, 'pre-approval guard must precede the Owner environment gate');
  assert.ok(postGuard > environment && postGuard < npmCi, 'post-approval guard must precede npm ci');
  assert.match(workflow, /verify-pre-applied-migration-production-baseline\.js/);
  assert.match(workflow, /verify-post-release-record\.js/);
  assert.match(workflow, /git show "\$GITHUB_SHA:scripts\/ci\/\$tool"/);
  assert.match(workflow, /verify-pre-applied-migration-production-baseline\.js; do/);
  assert.match(workflow, /gh api --paginate .*deployments\?environment=Production/);
  assert.match(workflow, /POST_APPROVAL_PRE_APPLIED_MIGRATION_BASELINE=PASS/);
});


test('split-trust baseline contract defers Vercel before Owner approval and verifies it after', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
  const pre = extractRunBlock(workflow, 'Verify pre-applied Production baseline before Owner gate');
  const post = extractRunBlock(workflow, 'Verify pre-applied Production baseline immediately after Owner approval');
  assert.doesNotMatch(pre, /VERCEL_TOKEN|api\\.vercel\\.com|vercel@|collectVercel/);
  assert.match(pre, /vercelCanonicalIdentity: ['"]DEFERRED_TO_PROTECTED_ENVIRONMENT['"]/);
  assert.match(workflow, /VERCEL_CANONICAL_IDENTITY: DEFERRED_TO_PROTECTED_ENVIRONMENT/);
  assert.match(workflow, /name: Verify pre-applied Production baseline immediately after Owner approval[\s\S]*?VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/);
  assert.match(post, /collectVercel/);
  assert.match(post, /compareBaselineTransition/);
  assert.ok(workflow.indexOf('Verify pre-applied Production baseline immediately after Owner approval') < workflow.indexOf('      - run: npm ci'));
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
