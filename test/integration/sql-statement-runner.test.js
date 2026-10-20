'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { executeSqlStatements, splitSqlStatements } = require('./sql-statement-runner');

test('splitSqlStatements preserves semicolons inside dollar-quoted DO bodies', () => {
  const sql = `
    CREATE TABLE example (id integer);
    DO $$
    BEGIN
      PERFORM 1;
      PERFORM 2;
    END $$;
    DO $custom$
    BEGIN
      RAISE NOTICE 'still; inside';
    END $custom$;
    ALTER TABLE example ENABLE ROW LEVEL SECURITY;
  `;

  assert.deepEqual(splitSqlStatements(sql), [
    'CREATE TABLE example (id integer)',
    `DO $$
    BEGIN
      PERFORM 1;
      PERFORM 2;
    END $$`,
    `DO $custom$
    BEGIN
      RAISE NOTICE 'still; inside';
    END $custom$`,
    'ALTER TABLE example ENABLE ROW LEVEL SECURITY'
  ]);
});

test('executeSqlStatements sends each complete statement separately', async () => {
  const executed = [];
  const prisma = {
    $executeRawUnsafe: async (statement) => {
      executed.push(statement);
    }
  };

  await executeSqlStatements(prisma, 'SELECT 1; DO $$ BEGIN PERFORM 1; END $$; SELECT 2;');

  assert.deepEqual(executed, [
    'SELECT 1',
    'DO $$ BEGIN PERFORM 1; END $$',
    'SELECT 2'
  ]);
});
