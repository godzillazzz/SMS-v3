process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const base = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(base, p), 'utf8');

test('activation persists in existing SystemSetting and creates no new migration', () => {
  const schema = read('prisma/schema.prisma');
  assert.match(schema, /model SystemSetting\s*\{/);
  assert.match(schema, /key\s+String\s+@id/);
  const migration = fs.readFileSync(path.join(base, 'prisma/migrations/202608170001_annual_leave_quota_year/migration.sql'));
  const normalizedMigration = Buffer.from(migration.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  assert.equal(crypto.createHash('sha256').update(normalizedMigration).digest('hex'), '5c912c927d2827d53b67df02679fc4fcb596f39f18623bb230adf2a11fa69cfe');
  assert.equal(fs.readdirSync(path.join(base, 'prisma/migrations')).filter((name) => /activation|multi.year/i.test(name)).length, 0);
});

test('central activation policy is strict, base-year 2026 only, and no activation endpoint exists', () => {
  const gate = read('src/services/g03-1-multi-year-activation.service.js');
  const routes = read('src/routes/operations.routes.js');
  assert.match(gate, /G03_1_MULTI_YEAR_WRITES_ENABLED/);
  assert.match(gate, /G03_1_ROLLOUT_BASE_YEAR = 2026/);
  assert.match(gate, /return value === 'true'/);
  assert.doesNotMatch(routes, /activate-g03|multi-year-writes.*router\.(post|put|patch)/i);
  assert.match(routes, /isReservedOperationalSettingKey\(key\)/);
});

test('existing annual row is returned before non-base creation gate is evaluated', () => {
  const service = read('src/services/annual-leave-quota.service.js');
  const existing = service.indexOf("if (state.state === 'ANNUAL_EXISTS') return");
  const legacy = service.indexOf("if (state.state === 'LEGACY_AMBIGUOUS')");
  const gate = service.indexOf('await assertAnnualQuotaCreationAllowed(tx, year)');
  const create = service.indexOf('tx.leaveQuota.createMany');
  assert.ok(existing >= 0 && legacy > existing && gate > legacy && create > gate);
});

test('all active annual DB creation boundaries are gated and inactive legacy writers are not mounted runtime paths', () => {
  const annual = read('src/services/annual-leave-quota.service.js');
  const admin = read('src/services/leave-quota-provisioning.service.js');
  const cron = read('src/services/annual-leave-quota-cron.service.js');
  const accounting = read('src/services/leave-annual-accounting.service.js');
  const routes = read('src/routes/operations.routes.js');
  const link = read('src/services/leave-quota-link.service.js');
  const routeIndex = read('src/routes/index.js');
  assert.match(annual, /assertAnnualQuotaCreationAllowed\(tx, year\)[\s\S]*leaveQuota\.createMany/);
  assert.match(admin, /assertAnnualQuotaCreationAllowed\(tx, year\)[\s\S]*leaveQuota\.create/);
  assert.match(cron, /isMultiYearWriteActivated\(prismaClient\)[\s\S]*ensureAnnualQuota/);
  assert.match(accounting, /ensureAnnualQuotaInTransaction/);
  assert.match(link, /assertAnnualQuotaCreationAllowed\(tx, year\)[\s\S]*leaveQuota\.update/);
  assert.doesNotMatch(routes, /leaveQuota\.(create|createMany|upsert)\s*\(/);
  assert.doesNotMatch(routeIndex, /leaves\.routes/);
});

test('cron gate is checked before employee scan and reserved key cannot be changed by generic settings PUT', () => {
  const cron = read('src/services/annual-leave-quota-cron.service.js');
  const routes = read('src/routes/operations.routes.js');
  assert.ok(cron.indexOf('isMultiYearWriteActivated(prismaClient)') < cron.indexOf('prismaClient.employee.findMany'));
  const put = routes.indexOf("router.put('/system-settings/:key'");
  const reserve = routes.indexOf('isReservedOperationalSettingKey(key)', put);
  const upsert = routes.indexOf('tx.systemSetting.upsert', put);
  assert.ok(put >= 0 && reserve > put && upsert > reserve);
});
