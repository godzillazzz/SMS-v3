'use strict';

process.env.NODE_ENV = 'test';
process.env.ATTENDANCE_API_PREVIEW_ENABLED = 'true';
process.env.VERCEL_ENV = 'preview';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:***@fixture.example.com:5432/smsv3';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-at-least-thirty-two-chars';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createAttendanceSupervisorRoutes } = require('../src/routes/attendance-supervisor.routes');

test('GET month-print validates selectedDate and delegates a read-only request', async () => {
  const calls = [];
  const router = createAttendanceSupervisorRoutes({
    requireAttendanceApiMiddleware: (_req, _res, next) => next(),
    authenticateMiddleware: (req, _res, next) => { req.user = { role: 'ADMIN', sub: 'admin-1' }; next(); },
    authorizeMiddleware: () => (_req, _res, next) => next(),
    service: { monthPrint: async (input) => { calls.push(input); return { selectedDate: input.selectedDate, employees: [] }; } }
  });
  const app = express();
  app.use('/api/v1/attendance/supervisor', router);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 400).json({ error: error.message }));

  const ok = await request(app).get('/api/v1/attendance/supervisor/month-print?selectedDate=2026-08-29');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.selectedDate, '2026-08-29');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { actor: { role: 'ADMIN', sub: 'admin-1' }, selectedDate: '2026-08-29' });

  const invalid = await request(app).get('/api/v1/attendance/supervisor/month-print?selectedDate=2026-02-30');
  assert.equal(invalid.status, 400);
  assert.equal(calls.length, 1);
});
