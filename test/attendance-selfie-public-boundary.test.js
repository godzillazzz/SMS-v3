'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selfieStorageError } = require('../src/services/attendance-simple.service');
const { errorHandler } = require('../src/middlewares/error-handler');

function responseProbe(error) {
  const response = { statusCode: null, body: null };
  const res = {
    status(code) { response.statusCode = code; return this; },
    json(body) { response.body = body; return this; }
  };
  errorHandler(error, { requestId: 'test-request' }, res, () => {});
  return response;
}

test('storage provider messages never cross the public error boundary', () => {
  for (const origin of ['code', 'details.code', 'publicCode']) {
    const error = new Error('provider-secret-LEAK-MARKER');
    error.publicMessage = 'provider-public-LEAK-MARKER';
    if (origin === 'code') error.code = 'ATTENDANCE_SELFIE_STORAGE_UPLOAD_FAILED';
    if (origin === 'details.code') error.details = { code: 'ATTENDANCE_SELFIE_STORAGE_UPLOAD_FAILED' };
    if (origin === 'publicCode') error.publicCode = 'ATTENDANCE_SELFIE_STORAGE_UPLOAD_FAILED';
    const response = responseProbe(selfieStorageError(error));
    assert.deepEqual(response, {
      statusCode: 502,
      body: { error: 'Attendance selfie upload failed.', requestId: 'test-request', code: 'ATTENDANCE_SELFIE_STORAGE_UPLOAD_FAILED' }
    });
    assert.doesNotMatch(JSON.stringify(response), /provider-(?:secret|public)-LEAK-MARKER/);
  }
});

test('unknown storage errors use the fixed unavailable contract', () => {
  const response = responseProbe(selfieStorageError(Object.assign(new Error('provider-secret-LEAK-MARKER'), {
    publicMessage: 'provider-public-LEAK-MARKER', code: 'PROVIDER_TRANSIENT_FAILURE'
  })));
  assert.deepEqual(response, {
    statusCode: 503,
    body: { error: 'Attendance selfie storage is temporarily unavailable.', requestId: 'test-request', code: 'ATTENDANCE_SELFIE_STORAGE_UNAVAILABLE' }
  });
  assert.doesNotMatch(JSON.stringify(response), /provider-(?:secret|public)-LEAK-MARKER/);
});
