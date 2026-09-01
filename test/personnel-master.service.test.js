'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../src/services/personnel-master.service');

test('personnel master normalizes names consistently', () => {
  assert.equal(service.normalizeName('  Security Operations  '), 'security operations');
});

test('active Department Master canonicalizes selected value', async () => {
  const client = { departmentMaster: { findUnique: async ({ where }) => where.normalizedName === 'security' ? { name: 'Security', isActive: true } : null } };
  assert.equal(await service.assertActiveValue(client, 'department', ' SECURITY '), 'Security');
});

test('inactive or missing Position Master fails closed', async () => {
  const client = { positionMaster: { findUnique: async () => ({ name: 'Officer', isActive: false }) } };
  await assert.rejects(() => service.assertActiveValue(client, 'position', 'Officer'), (error) => error?.details?.code === 'PERSONNEL_MASTER_ACTIVE_VALUE_REQUIRED');
});
