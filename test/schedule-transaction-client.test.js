const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('schedule batch reads existing assignments through the transaction client', () => {
  const sourcePath = path.join(
    __dirname,
    '..',
    'src',
    'services',
    'schedule.service.js'
  );

  const source = fs.readFileSync(sourcePath, 'utf8');

  assert.match(
    source,
    /const existingAssList = await tx\.shiftAssignment\.findMany\(\{/,
    'saveBatchAssignments must query existing assignments through tx'
  );

  assert.doesNotMatch(
    source,
    /const existingAssList = await prisma\.shiftAssignment\.findMany\(\{/,
    'saveBatchAssignments must not use the global Prisma client inside the transaction'
  );
});

test('saveBatchAssignments uses tx client for all operations inside transaction', () => {
  const sourcePath = path.join(__dirname, '..', 'src', 'services', 'schedule.service.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.ok(source.includes('tx.shiftAssignment.upsert'), 'Must use tx.shiftAssignment.upsert inside transaction');
});