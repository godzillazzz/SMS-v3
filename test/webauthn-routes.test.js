const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.WEBAUTHN_ENABLED = 'false';
const app = require('../src/app');

test('passkey feature config is public but reveals only enabled state', async () => {
  const response = await request(app).get('/api/v1/auth/passkeys/config').expect(200);
  assert.deepEqual(response.body, { enabled: false });
  assert.equal('email' in response.body, false);
  assert.equal('user' in response.body, false);
});

test('passkey enrollment options require authenticated identity', async () => {
  const response = await request(app).post('/api/v1/auth/passkeys/register/options').send({ currentPassword: 'any', displayName: 'Phone' }).expect(401);
  assert.ok(response.body.error);
});

test('passkey inventory, rename, and revoke are protected', async () => {
  await request(app).get('/api/v1/auth/passkeys').expect(401);
  await request(app).patch('/api/v1/auth/passkeys/22222222-2222-4222-8222-222222222222').send({ displayName: 'Phone' }).expect(401);
  await request(app).delete('/api/v1/auth/passkeys/22222222-2222-4222-8222-222222222222').send({ currentPassword: 'any' }).expect(401);
});

test('disabled passkey public options do not accept/echo account identity', async () => {
  const first = await request(app).post('/api/v1/auth/passkeys/login/options').send({}).expect(503);
  const second = await request(app).post('/api/v1/auth/passkeys/login/options').send({ email: 'does-not-exist@example.test' }).expect(503);
  assert.equal(first.body.error, second.body.error);
  assert.equal(JSON.stringify(second.body).includes('does-not-exist@example.test'), false);
});
