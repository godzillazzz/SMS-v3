'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Regression lock: a later migration must never silently shrink a CHECK constraint value set.
// The final definition across all migrations must still accept every value that any earlier
// migration allowed, plus the values the owner policy added.
const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => fs.statSync(path.join(MIGRATIONS_DIR, name)).isDirectory())
    .sort()
    .map((name) => path.join(MIGRATIONS_DIR, name, 'migration.sql'))
    .filter((file) => fs.existsSync(file));
}

function quotedValues(definition) {
  return new Set([...definition.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]));
}

function finalConstraint(constraintName) {
  let current = new Set();
  for (const file of migrationFiles()) {
    const sql = fs.readFileSync(file, 'utf8');
    const pattern = new RegExp(`ADD CONSTRAINT "${constraintName}"\\s+CHECK\\s*\\(([\\s\\S]*?)\\)\\s*;`, 'g');
    for (const match of sql.matchAll(pattern)) {
      const values = quotedValues(match[1]);
      if (values.size) current = values;
    }
  }
  return current;
}

test('the final status constraint keeps every value an earlier migration allowed', () => {
  const values = finalConstraint('attendance_adjustment_requests_status_check');
  for (const status of ['DRAFT', 'PENDING_APPROVAL', 'RETURNED_FOR_CORRECTION', 'APPROVED', 'REJECTED', 'CANCELLED']) {
    assert.ok(values.has(status), `status constraint dropped ${status}`);
  }
  for (const status of ['PENDING_SUPERVISOR', 'PENDING_MANAGER', 'PENDING_ADMIN']) {
    assert.ok(values.has(status), `status constraint is missing the staged value ${status}`);
  }
});

test('the final event-type constraint keeps every value an earlier migration allowed', () => {
  const values = finalConstraint('attendance_adjustment_events_type_check');
  for (const event of ['CREATED', 'REVISED', 'SUBMITTED', 'RETURNED', 'REJECTED', 'APPROVED', 'CANCELLED']) {
    assert.ok(values.has(event), `event_type constraint dropped ${event}`);
  }
  assert.ok(values.has('REVIEWED'), 'event_type constraint is missing the REVIEWED event');
});
