process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const requestContext = require('../src/middlewares/request-context');
const { errorHandler } = require('../src/middlewares/error-handler');
const HttpError = require('../src/utils/http-error');

function createResponse() {
  const headers = {};
  let statusCode = 200;
  let body;
  const response = {
    setHeader(name, value) { headers[String(name).toLowerCase()] = String(value); },
    status(value) { statusCode = value; return response; },
    json(value) { body = value; return response; }
  };
  return { response, headers, get statusCode() { return statusCode; }, get body() { return body; } };
}

function contextRequest(overrides = {}) {
  return {
    get: () => undefined,
    method: 'GET',
    originalUrl: '/api/v1/request-id-contract',
    ...overrides
  };
}

test('normal versioned API response contains a safe X-Request-Id', async () => {
  const response = await request(app).get('/api/v1/health');
  assert.equal(response.status, 200);
  assert.equal(typeof response.headers['x-request-id'], 'string');
  assert.ok(response.headers['x-request-id'].length > 0);
});

for (const status of [400, 401, 403, 404, 409, 422]) {
  test(`controlled ${status} error preserves the same request ID in context, header, and body`, () => {
    const req = contextRequest();
    const capture = createResponse();
    requestContext(req, capture.response, () => {});
    const requestId = req.requestId;
    errorHandler(new HttpError(status, 'Safe controlled error.'), req, capture.response, () => {});
    assert.equal(capture.statusCode, status);
    assert.equal(capture.headers['x-request-id'], requestId);
    assert.equal(capture.body.requestId, requestId);
    assert.equal(capture.body.error, 'Safe controlled error.');
  });
}

test('controlled 5xx error middleware preserves request ID without exposing internals', () => {
  const req = contextRequest({ method: 'POST' });
  const capture = createResponse();
  requestContext(req, capture.response, () => {});
  const error = Object.assign(new Error('private stack SQL database URL token'), {
    stack: 'C:\\private\\server\\file.js:1:1',
    code: 'SYNTHETIC_INTERNAL',
    meta: { sql: 'SELECT private', token: 'secret' }
  });
  errorHandler(error, req, capture.response, () => {});
  assert.equal(capture.statusCode, 500);
  assert.equal(capture.headers['x-request-id'], req.requestId);
  assert.deepEqual(capture.body, { error: 'Internal server error.', requestId: req.requestId });
  const serialized = JSON.stringify(capture.body);
  for (const forbidden of ['private stack', 'SELECT private', 'token', 'server\\file.js', 'SYNTHETIC_INTERNAL']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
