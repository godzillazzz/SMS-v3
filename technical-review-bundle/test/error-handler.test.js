const test = require('node:test');
const assert = require('node:assert/strict');
const { errorHandler } = require('../src/middlewares/error-handler');

test('production errors are sanitized and include the request ID', () => {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  let body; const response = { status: () => response, json: (value) => { body = value; return response; } };
  errorHandler(new Error('database connection details'), { requestId: 'request-123' }, response, () => {});
  assert.deepEqual(body, { error: 'Internal server error.', requestId: 'request-123' });
  process.env.NODE_ENV = previous;
});
