const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const routeSource = fs.readFileSync(require.resolve('../src/routes/operations.routes.js'), 'utf8');
const serviceSource = fs.readFileSync(require.resolve('../src/services/license-document.service.js'), 'utf8');

test('license routes expose the intended role policy', () => {
  assert.match(routeSource, /router\.get\('\/licenses', authorize\('ADMIN', 'MANAGER'\)/);
  assert.match(routeSource, /router\.put\('\/licenses\/:id', authorize\('ADMIN', 'MANAGER'\)/);
  assert.match(routeSource, /router\.delete\('\/licenses\/:id', authorize\('ADMIN'\)/);
  assert.match(routeSource, /router\.get\('\/licenses\/:id\/documents', authorize\('ADMIN', 'MANAGER'\)/);
  assert.match(routeSource, /router\.post\('\/licenses\/:id\/documents', authorize\('ADMIN', 'MANAGER'\)/);
  assert.match(routeSource, /router\.get\('\/license-documents\/:id\/view', authorize\('ADMIN', 'MANAGER'\)/);
  assert.match(routeSource, /router\.post\('\/license-documents\/:id\/approve', authorize\('ADMIN'\)/);
  assert.match(routeSource, /router\.post\('\/license-documents\/:id\/reject', authorize\('ADMIN'\)/);
});

test('license document service grants manager access without department scope', () => {
  assert.match(serviceSource, /return requestUser\.role === 'MANAGER';/);
  assert.doesNotMatch(serviceSource, /manager\.department/);
});

test('master license fields remain behind the document approval workflow', () => {
  assert.match(routeSource, /License number and dates require a new document for review/);
});
