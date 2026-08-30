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

test("protected immutable candidate check avoids raw curl status plumbing", () => {
  const workflow = fs.readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
  const script = extractRunBlock(
    workflow,
    "Verify immutable candidate, explicitly promote, then verify canonical Production",
  );
  const protectedStart = script.indexOf("verify_protected_candidate()");
  const protectedEnd = script.indexOf("\n}\n", protectedStart);
  assert.notEqual(protectedStart, -1);
  assert.notEqual(protectedEnd, -1);
  const protectedBlock = script.slice(protectedStart, protectedEnd + 3);
  assert.equal(protectedBlock.includes("--write-out"), false);
  assert.equal(protectedBlock.includes("approval_status="), false);
  assert.match(
    script,
    /verify_public_runtime \"\$EXPECTED_CANONICAL_URL\" CANONICAL_PRODUCTION/,
  );
  assert.match(script, /approval\.status !== 401/);
});
