process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const HttpError = require('../src/utils/http-error');

const calls = [];
const fakeService = {
  list: async () => ({ data: [] }),
  getById: async () => ({ id: '11111111-1111-4111-8111-111111111111' }),
  searchCandidates: async (input) => { calls.push(['search', input]); return { data: [], meta: { employeeMatchState: 'EMPLOYEE_NOT_FOUND' } }; },
  match: async (input) => { calls.push(['match', input]); return { id: input.id, status: 'MATCHED' }; },
  approve: async (input) => { calls.push(['approve', input]); return { user: { role: 'VIEWER' } }; },
  reject: async (input) => { calls.push(['reject', input]); return { id: input.id, status: 'REJECTED' }; }
};
require.cache[require.resolve('../src/services/registration-request.service')] = { exports: { createRegistrationRequestService: () => fakeService } };
require.cache[require.resolve('../src/services/approval-policy.service')] = { exports: {
  createApprovalPolicyService: () => ({
    assertReviewer: async (_requestType, actor) => {
      if (!['ADMIN', 'MANAGER'].includes(actor?.role)) throw new HttpError(403, 'Forbidden.');
      return { requestType: 'REGISTRATION_REQUEST', reviewerRoles: ['ADMIN', 'MANAGER'], dueSoonHours: 24, overdueHours: 48 };
    }
  })
} };
require.cache[require.resolve('../src/middlewares/authenticate')] = { exports: {
  authenticate: (req, _res, next) => {
    const role = req.get('x-test-role');
    if (!role) return next(new HttpError(401, 'Authentication required.'));
    req.user = { sub: `${role.toLowerCase()}-user`, role };
    next();
  },
  authorize: (...roles) => (req, _res, next) => roles.includes(req.user?.role) ? next() : next(new HttpError(403, 'Forbidden.'))
} };
const reviewRoutes = require('../src/routes/registration-requests.routes');
const { errorHandler } = require('../src/middlewares/error-handler');
const reviewApp = express(); reviewApp.use(express.json()); reviewApp.use('/registration-requests', reviewRoutes); reviewApp.use(errorHandler);

for (const [method, path, body] of [
  ['get', '/registration-requests'],
  ['get', '/registration-requests/11111111-1111-4111-8111-111111111111/candidates?search=ab'],
  ['post', '/registration-requests/11111111-1111-4111-8111-111111111111/match', { employeeId: '22222222-2222-4222-8222-222222222222' }],
  ['post', '/registration-requests/11111111-1111-4111-8111-111111111111/approve', {}],
  ['post', '/registration-requests/11111111-1111-4111-8111-111111111111/reject', { reason: 'not eligible' }]
]) {
  test(`anonymous cannot ${method.toUpperCase()} ${path.split('?')[0]}`, async () => {
    const response = await request(reviewApp)[method](path).send(body || undefined);
    assert.equal(response.status, 401);
  });
  test(`VIEWER cannot ${method.toUpperCase()} ${path.split('?')[0]}`, async () => {
    const response = await request(reviewApp)[method](path).set('x-test-role', 'VIEWER').send(body || undefined);
    assert.equal(response.status, 403);
  });
}

test('ADMIN and MANAGER may use protected review/search/match/approve APIs, with no role input', async () => {
  for (const role of ['ADMIN', 'MANAGER']) {
    assert.equal((await request(reviewApp).get('/registration-requests').set('x-test-role', role)).status, 200);
    assert.equal((await request(reviewApp).get('/registration-requests/11111111-1111-4111-8111-111111111111/candidates?search=ab').set('x-test-role', role)).status, 200);
    assert.equal((await request(reviewApp).post('/registration-requests/11111111-1111-4111-8111-111111111111/match').set('x-test-role', role).send({ employeeId: '22222222-2222-4222-8222-222222222222' })).status, 200);
    const approved = await request(reviewApp).post('/registration-requests/11111111-1111-4111-8111-111111111111/approve').set('x-test-role', role).send({});
    assert.equal(approved.status, 200); assert.equal(approved.body.data.user.role, 'VIEWER');
  }
  assert.ok(calls.filter(([kind]) => kind === 'approve').every(([, input]) => !Object.prototype.hasOwnProperty.call(input, 'role')));
});

test('registration approval rejects a tampered role field before service invocation', async () => {
  const before = calls.length;
  const response = await request(reviewApp).post('/registration-requests/11111111-1111-4111-8111-111111111111/approve').set('x-test-role', 'MANAGER').send({ role: 'ADMIN' });
  assert.equal(response.status, 400);
  assert.equal(calls.length, before);
});

// Load a fresh auth router with a fake OTP service so public input validation can be exercised without a database.
const fakeOtp = {
  requestRegistration: async () => ({ message: 'generic' }),
  verifyRegistration: async () => ({ message: 'generic' }),
  requestPasswordReset: async () => ({ message: 'generic' }),
  completePasswordReset: async () => ({ message: 'generic' })
};
require.cache[require.resolve('../src/services/email-otp.service')] = { exports: { createOtpService: () => fakeOtp } };
delete require.cache[require.resolve('../src/routes/auth.routes')];
const authRoutes = require('../src/routes/auth.routes');
const publicApp = express(); publicApp.use(express.json()); publicApp.use('/auth', authRoutes); publicApp.use(errorHandler);

test('anonymous employee registration directory no longer exists', async () => {
  const response = await request(publicApp).get('/auth/register/available-employees');
  assert.equal(response.status, 404);
});

test('public registration rejects applicant authority fields employeeId, matchedEmployeeId, role, status, and approved', async () => {
  for (const field of ['employeeId', 'matchedEmployeeId', 'role', 'status', 'approved', 'reviewedBy']) {
    const response = await request(publicApp).post('/auth/register/request-otp').send({ submittedName: 'Applicant Name', email: 'applicant@example.test', password: 'long-password', [field]: field === 'role' ? 'ADMIN' : '11111111-1111-4111-8111-111111111111' });
    assert.equal(response.status, 400, field);
  }
});

test('public registration accepts only private applicant fields and returns no employee data', async () => {
  const response = await request(publicApp).post('/auth/register/request-otp').send({ submittedName: 'Applicant Name', email: 'applicant@example.test', password: 'long-password', departmentHint: 'Security' });
  assert.equal(response.status, 202);
  assert.deepEqual(response.body, { message: 'generic' });
  assert.equal(/employeeCode|employeeId|departmentHint/.test(JSON.stringify(response.body)), false);
});
