process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(base, p), 'utf8');

test('G03.1 schema keeps quotaYear nullable and enforces employee/year uniqueness', () => {
  const schema = read('prisma/schema.prisma');
  assert.match(schema, /quotaYear\s+Int\?\s+@map\("quota_year"\)/);
  assert.match(schema, /@@unique\(\[employeeId, quotaYear\]\)/);
  assert.match(schema, /@@index\(\[quotaYear\]\)/);
});

test('G03.1 migration is additive only with no legacy backfill or entitlement rewrite', () => {
  const sql = read('prisma/migrations/202608170001_annual_leave_quota_year/migration.sql');
  assert.match(sql, /ADD COLUMN "quota_year" INTEGER/);
  assert.match(sql, /CREATE UNIQUE INDEX "leave_quotas_employee_id_quota_year_key"/);
  assert.doesNotMatch(sql, /\bUPDATE\b|\bDELETE\b|\bDROP\b/i);
  assert.doesNotMatch(sql, /30|personal_leave|vacation_leave|sick_leave/i);
});

test('annual cron uses the repository cron configuration and Bangkok Jan 1 UTC schedule', () => {
  const config = JSON.parse(read('vercel.json'));
  const annual = config.crons.find((item) => item.path === '/api/v1/internal/annual-leave-quota-provisioning');
  assert.deepEqual(annual, { path: '/api/v1/internal/annual-leave-quota-provisioning', schedule: '0 17 31 12 *' });
  const routes = read('src/routes/operations.routes.js');
  const cronIndex = routes.indexOf("router.get('/internal/annual-leave-quota-provisioning'");
  const authIndex = routes.indexOf('router.use(authenticate);');
  assert.ok(cronIndex >= 0 && cronIndex < authIndex, 'CRON_SECRET route must be mounted before user authentication');
  assert.match(routes.slice(cronIndex, authIndex), /authorizedLicenseReconciliationCron\(req\)/);
});

test('active leave runtime contains no old 30/6/10 fallback or employee-only quota lookup', () => {
  const routes = read('src/routes/operations.routes.js');
  assert.doesNotMatch(routes, /\{ sickLeave: 30, personalLeave: 6, vacationLeave: 10 \}/);
  assert.doesNotMatch(routes, /leaveQuota\.findFirst\(\{ where: \{ employeeId \} \}\)/);
  assert.match(routes, /nativeUsageByQuotaYear/);
  assert.match(routes, /persistedUsageByQuotaYear/);
});

test('report summary current quota KPI is scoped to Bangkok current year', () => {
  const routes = read('src/routes/operations.routes.js');
  assert.match(routes, /leaveQuota\.count\(\{ where: \{ quotaYear: bangkokQuotaYear\(\) \} \}\)/);
});

test('G03.1 preflight command is read-only by source contract', () => {
  const service = read('src/services/g03-1-preflight.service.js');
  const cli = read('scripts/g03-1-preflight.js');
  assert.doesNotMatch(service, /\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/);
  assert.match(service, /SAFE_FOR_G03_1_CUTOVER/);
  assert.match(service, /G03_1_DATA_INVARIANT_REQUIRES_REMEDIATION/);
  assert.match(cli, /classifyG031Data/);
});
