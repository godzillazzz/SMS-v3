const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'deploy-production.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8').replaceAll('\r\n', '\n');

function jobBlock(jobName) {
  const heading = `  ${jobName}:`;
  const start = workflow.indexOf(`${heading}\n`);
  assert.notEqual(start, -1, `workflow job ${jobName} must exist`);
  const bodyStart = workflow.indexOf('\n', start) + 1;
  const nextJobOffset = workflow.slice(bodyStart).search(/\r?\n  [a-zA-Z0-9_-]+:/);
  const end = nextJobOffset === -1 ? workflow.length : bodyStart + nextJobOffset;
  return workflow.slice(bodyStart, end);
}

test('production deploy and migration jobs share the approved GitHub Environment', () => {
  const migrate = jobBlock('migrate');
  const deploy = jobBlock('deploy');
  const expectedEnvironment = 'production-sms-v3-staging';
  const expectedUrl = 'https://sms-v3-staging-ten.vercel.app';

  for (const block of [migrate, deploy]) {
    assert.match(block, new RegExp(`environment:\\r?\\n\\s+name: ${expectedEnvironment}`));
    assert.match(block, new RegExp(`url: ${expectedUrl.replaceAll('.', '\\.')}`));
  }
});

test('diagnostic-only mode skips migration, build, deploy, and health', () => {
  const migrate = jobBlock('migrate');
  const diagnose = jobBlock('diagnose');
  const deploy = jobBlock('deploy');
  const health = jobBlock('health');

  assert.match(workflow, /diagnostic_only:/);
  assert.match(diagnose, /node scripts\/ci\/vercel-linkage\.js --diagnostic/);
  assert.doesNotMatch(diagnose, /DATABASE_URL|DIRECT_URL|prisma|vercel (?:build|deploy)/i);
  assert.match(migrate, /if: \$\{\{ inputs\.diagnostic_only != true && inputs\.run_migrations == true \}\}/);
  assert.match(deploy, /if: \$\{\{ always\(\) && inputs\.diagnostic_only != true && \(inputs\.run_migrations == false \|\| needs\.migrate\.result == 'success'\) && needs\.validate\.result == 'success' \}\}/);
  assert.match(health, /if: \$\{\{ always\(\) && inputs\.diagnostic_only != true && needs\.validate\.result == 'success' && needs\.deploy\.result == 'success' \}\}/);
});

test('deploy job remains migration-gated and bound to the approved Vercel project', () => {
  const deploy = jobBlock('deploy');

  assert.match(deploy, /needs: \[validate, migrate\]/);
  assert.match(deploy, /VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/);
  assert.match(deploy, /VERCEL_ORG_ID: \$\{\{ secrets\.VERCEL_ORG_ID \}\}/);
  assert.match(deploy, /VERCEL_PROJECT_ID: \$\{\{ secrets\.VERCEL_PROJECT_ID \}\}/);
  assert.match(workflow, /EXPECTED_PROJECT_ID: prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s/);
  assert.match(workflow, /EXPECTED_ORG_ID: team_nemCExHbZ8EAhSgsvefHPAEz/);
  assert.match(deploy, /test "\$VERCEL_PROJECT_ID" = "\$EXPECTED_PROJECT_ID"/);
  assert.match(deploy, /test "\$VERCEL_ORG_ID" = "\$EXPECTED_ORG_ID"/);
  assert.doesNotMatch(deploy, /vercel\s+(?:project\s+)?(?:add|create)/i);
  assert.doesNotMatch(deploy, /(?:^|[\s"'])sms-v3(?:[\s"']|$)/);
});

test('deployment identity comes from deploy JSON and rejects rollback reuse', () => {
  const deploy = jobBlock('deploy');
  const health = jobBlock('health');
  assert.match(deploy, /deploy --prebuilt --prod .*--project "\$EXPECTED_PROJECT_ID"/);
  assert.match(deploy, /--format=json/);
  assert.match(deploy, /scripts\/ci\/vercel-deployment\.js/);
  assert.match(deploy, /rollback_deployment_id/);
  assert.match(deploy, /inspect_stdout/);
  assert.match(deploy, /inspect_stderr/);
  assert.doesNotMatch(deploy, /grep -Eo .*vercel\.app/);
  assert.match(deploy, /deployment_url: \$\{\{ steps\.deploy\.outputs\.deployment_url \}\}/);
  assert.match(deploy, /deployment_id: \$\{\{ steps\.deploy\.outputs\.deployment_id \}\}/);
  assert.match(deploy, /\[\[ "\$deployment_id" =~ \^dpl_/);
  assert.match(deploy, /\[\[ "\$deployment_url" =~ \^https:\/\/sms-v3-staging-/);
  assert.match(health, /if: \$\{\{ always\(\) && inputs\.diagnostic_only != true && needs\.validate\.result == 'success' && needs\.deploy\.result == 'success' \}\}/);
  assert.match(health, /DEPLOYMENT_URL: \$\{\{ needs\.deploy\.outputs\.deployment_url \}\}/);
  assert.match(health, /DEPLOYMENT_ID: \$\{\{ needs\.deploy\.outputs\.deployment_id \}\}/);
  assert.match(health, /Validate deployment outputs/);
});

test('build gate validates build-only behavior and the Vite artifact', () => {
  const migrate = jobBlock('migrate');
  const deploy = jobBlock('deploy');

  assert.doesNotMatch(deploy, /CI migration gate accepted; production migration skipped/);
  assert.doesNotMatch(workflow, /CI migration gate accepted; production migration skipped/);
  assert.match(deploy, /Vercel build is build-only/);
  assert.match(deploy, /Prisma generate passed/);
  assert.match(deploy, /Application build passed/);
  assert.match(deploy, /prisma migrate deploy/);
  assert.doesNotMatch(deploy, /node\s+scripts\/ci\/prisma-migration\.js\s+deploy/);
  assert.match(migrate, /node\s+scripts\/ci\/prisma-migration\.js\s+deploy/);
  assert.match(deploy, /test -f frontend\/dist\/index\.html/);
  assert.match(deploy, /frontend\/dist\/assets\/index-\*\.js/);
  assert.match(deploy, /frontend\/dist -type f -path '\*\/_next\/\*'/);
});

test('health job uses canonical URL as its only health source', () => {
  const health = jobBlock('health');
  assert.match(health, /CANONICAL_URL: https:\/\/sms-v3-staging-ten\.vercel\.app/);
  assert.match(health, /DEPLOYMENT_URL: \$\{\{ needs\.deploy\.outputs\.deployment_url \}\}/);
  assert.match(health, /DEPLOYMENT_ID: \$\{\{ needs\.deploy\.outputs\.deployment_id \}\}/);
});

test('production workflow is manual-only and has no automatic deployment triggers', () => {
  assert.match(workflow, /^on:\r?\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(?:push|schedule|repository_dispatch):/m);
});
