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

for (const code of ['P1002', 'P1008', 'P1011', 'P2024', 'P2028']) {
  test(`database availability error ${code} returns a retryable 503`, () => {
    let statusCode; let body;
    const response = {
      status: (value) => { statusCode = value; return response; },
      json: (value) => { body = value; return response; }
    };
    errorHandler({ code }, { requestId: 'request-503' }, response, () => {});
    assert.equal(statusCode, 503);
    assert.deepEqual(body, { error: 'Database unavailable.', requestId: 'request-503' });
  });
}

test('Prisma client initialization failure returns a retryable 503', () => {
  let statusCode; let body;
  const response = {
    status: (value) => { statusCode = value; return response; },
    json: (value) => { body = value; return response; }
  };
  errorHandler({ name: 'PrismaClientInitializationError' }, { requestId: 'request-init' }, response, () => {});
  assert.equal(statusCode, 503);
  assert.deepEqual(body, { error: 'Database unavailable.', requestId: 'request-init' });
});
