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

test('authenticated passkey enrollment and revoke routes use the user-scoped limiter before calling the service', () => {
  const authRoutes = require('../src/routes/auth.routes');
  const routeStack = authRoutes.stack;
  const optionsRoute = routeStack.find((layer) => layer.route?.path === '/passkeys/register/options' && layer.route.methods.post);
  const revokeRoute = routeStack.find((layer) => layer.route?.path === '/passkeys/:id' && layer.route.methods.delete);
  assert.ok(optionsRoute, 'registration options route is registered');
  assert.ok(revokeRoute, 'revoke route is registered');
  const optionsHandlers = optionsRoute.route.stack.map((layer) => layer.handle);
  const revokeHandlers = revokeRoute.route.stack.map((layer) => layer.handle);
  const assertAuthenticatedUserLimiter = (handlers, routeName) => {
    const authenticateIndex = handlers.findIndex((handler) => handler.name === 'authenticate');
    const userLimiterIndex = handlers.findIndex((handler) => handler.rateLimitScope === 'user');
    assert.equal(authenticateIndex, 0, `${routeName} authenticates before applying the user-scoped limit`);
    assert.equal(userLimiterIndex, authenticateIndex + 1, `${routeName} applies the user-scoped limit after authentication and before its handler`);
    assert.equal(userLimiterIndex, handlers.length - 2, `${routeName} limits before calling its service handler`);
  };
  assertAuthenticatedUserLimiter(optionsHandlers, 'registration options');
  assertAuthenticatedUserLimiter(revokeHandlers, 'credential revoke');
});

test('disabled passkey public options do not accept/echo account identity', async () => {
  const first = await request(app).post('/api/v1/auth/passkeys/login/options').send({}).expect(503);
  const second = await request(app).post('/api/v1/auth/passkeys/login/options').send({ email: 'does-not-exist@example.test' }).expect(503);
  assert.equal(first.body.error, second.body.error);
  assert.equal(JSON.stringify(second.body).includes('does-not-exist@example.test'), false);
});
