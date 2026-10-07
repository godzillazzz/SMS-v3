const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('license list accepts a UUID employee filter and applies it to the server query', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/operations.routes.js'), 'utf8');
  assert.match(source, /const licenseListQuery = paging\.extend\(\{ employeeStatus: z\.enum\(\['ACTIVE', 'INACTIVE', 'ALL'\]\)\.default\('ACTIVE'\), employeeId: uuid\.optional\(\) \}\)/);
  assert.match(source, /const \{ page, pageSize, employeeStatus, employeeId \} = licenseListQuery\.parse\(req\.query\)/);
  assert.match(source, /const where = \{ \.\.\.licenseEmployeeWhere\(employeeStatus\), \.\.\.\(employeeId \? \{ employeeId \} : \{\}\) \};/);
  assert.match(source, /prisma\.employeeLicense\.count\(\{ where \}\)[\s\S]*?prisma\.employeeLicense\.findMany\(\{\s*where,/);
  assert.match(source, /router\.get\('\/licenses', authorize\('ADMIN', 'MANAGER', 'SUPERVISOR'\)/);
});
