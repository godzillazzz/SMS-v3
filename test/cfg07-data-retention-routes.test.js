'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'operations.routes.js'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

test('CFG-07 exposes only governed Admin retention APIs and protected cron cleanup', () => {
  assert.match(routes, /router\.get\('\/internal\/data-retention-cleanup'[\s\S]*authorizedLicenseReconciliationCron\(req\)/);
  assert.match(routes, /router\.get\('\/retention-policies', authorize\('ADMIN'\)/);
  assert.match(routes, /router\.post\('\/retention-policies\/preview', authorize\('ADMIN'\)/);
  assert.match(routes, /router\.post\('\/retention-policies\/changes', authorize\('ADMIN'\)/);
  assert.match(routes, /router\.post\('\/retention-policies\/changes\/:id\/cancel', authorize\('ADMIN'\)/);
  assert.match(routes, /router\.post\('\/retention-cleanup\/run', authorize\('ADMIN'\)/);
  assert.match(routes, /router\.get\('\/retention-cleanup\/runs', authorize\('ADMIN'\)/);
  assert.match(routes, /acknowledgeCleanup: z\.literal\(true\)/);
  assert.match(routes, /batchSize:[\s\S]*max\(200\)/);
  assert.match(routes, /maxBatches:[\s\S]*max\(5\)/);
});

test('CFG-07 cron runs daily after Attendance evidence retention with the existing cron secret authority', () => {
  const attendance = vercel.crons.find((item) => item.path === '/api/v1/internal/attendance-evidence-retention');
  const retention = vercel.crons.find((item) => item.path === '/api/v1/internal/data-retention-cleanup');
  assert.ok(attendance);
  assert.ok(retention);
  assert.equal(retention.schedule, '50 18 * * *');
  assert.notEqual(retention.schedule, attendance.schedule);
  assert.match(routes, /const authorizedLicenseReconciliationCron = \(req\) =>[\s\S]*process\.env\.CRON_SECRET/);
});
