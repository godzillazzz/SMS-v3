'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');

test('Q12-D CI isolates frontend production build from job-level NODE_ENV=test', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.match(workflow, /- name: Build frontend production bundle\n\s+env:\n\s+NODE_ENV: production\n\s+run: npm --prefix frontend run build/);
  assert.match(workflow, /- name: Verify frontend production bundle\n\s+run: node scripts\/ci\/verify-frontend-production-bundle\.js/);
  assert.match(workflow, /feature\/q12d-node22-build-repro/);
});

test('Q12-D production bundle guard enforces scoped production budgets and rejects dev JSX runtime', () => {
  const guard = read('scripts/ci/verify-frontend-production-bundle.js');
  assert.match(guard, /budgets=\{main:400000,map:300000,other:500000,css:700000\}/);
  assert.match(guard, /jsx-dev-runtime/);
  assert.match(guard, /reason=budget-exceeded/);
  assert.match(guard, /reason=gis-lazy-chunk-missing/);
  assert.match(guard, /FRONTEND_PRODUCTION_BUNDLE=PASS/);
});
