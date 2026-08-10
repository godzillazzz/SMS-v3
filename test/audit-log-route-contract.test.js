const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/routes/operations.routes.js'), 'utf8');

test('Audit Log route is ADMIN-only, read-only, and delegates to the bounded viewer service', () => {
  assert.match(source, /router\.get\('\/audit-events', authorize\('ADMIN'\)/);
  assert.match(source, /getAuditLogPage\(\{ prismaClient: prisma, query: req\.query \}\)/);
  assert.doesNotMatch(source, /router\.(post|put|patch|delete)\('\/audit-events'/);
});
