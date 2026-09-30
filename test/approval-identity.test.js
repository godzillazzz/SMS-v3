'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  approvalActor,
  legacyApprovalFallback,
  resolveApprovalActors,
  withApprovalIdentity
} = require('../src/services/approval-identity.service');

test('approval identity exposes human display name and role while preserving authoritative user id', () => {
  assert.deepEqual(approvalActor({ id: '11111111-1111-4111-8111-111111111111', displayName: 'Somchai Approver', role: 'SUPERVISOR' }), {
    id: '11111111-1111-4111-8111-111111111111', displayName: 'Somchai Approver', role: 'SUPERVISOR'
  });
});

test('legacy non-UUID approver text remains displayable without pretending it is a User id', () => {
  assert.deepEqual(legacyApprovalFallback('Legacy Manager Name'), {
    id: null, displayName: 'Legacy Manager Name', role: null, legacyRef: 'Legacy Manager Name'
  });
  assert.equal(legacyApprovalFallback('11111111-1111-4111-8111-111111111111'), null);
});

test('batch resolver loads human approver names from authoritative User records', async () => {
  const calls = [];
  const prisma = { user: { findMany: async (args) => { calls.push(args); return [{ id: '11111111-1111-4111-8111-111111111111', displayName: 'Named Approver', role: 'ADMIN' }]; } } };
  const actors = await resolveApprovalActors(prisma, ['11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'legacy-name']);
  const result = withApprovalIdentity({ approvedByLegacyRef: '11111111-1111-4111-8111-111111111111' }, 'approvedByLegacyRef', actors);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].where.id.in, ['11111111-1111-4111-8111-111111111111']);
  assert.equal(result.approvedByDisplayName, 'Named Approver');
  assert.equal(result.approvedByRole, 'ADMIN');
});