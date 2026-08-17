const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { authenticatedRequest } = require('../e2e/helpers/uat-authenticated-request');

test('authenticated request returns only safe response data', async () => {
  const server = http.createServer((request, response) => {
    assert.equal(request.headers.authorization, 'Bearer FAKE_AUTH_TOKEN_123456789');
    response.writeHead(403, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ code: 'FORBIDDEN' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const result = await authenticatedRequest('/api/v1/protected', {
      accessToken: 'FAKE_AUTH_TOKEN_123456789',
      baseURL: `http://127.0.0.1:${address.port}`
    });
    assert.deepEqual(result, { status: 403, payload: { code: 'FORBIDDEN' } });
    assert.equal(JSON.stringify(result).includes('FAKE_AUTH_TOKEN_123456789'), false);
    assert.equal(JSON.stringify(result).includes('Authorization'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('authenticated request emits safe network errors', async () => {
  await assert.rejects(
    authenticatedRequest('/api/v1/protected', {
      accessToken: 'FAKE_AUTH_TOKEN_123456789',
      baseURL: 'http://127.0.0.1:1',
      timeout: 100
    }),
    (error) => error.code === 'UAT_API_REQUEST_FAILED' && !error.message.includes('FAKE_AUTH_TOKEN_123456789')
  );
});
