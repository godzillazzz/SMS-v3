'use strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:***@localhost:5432/smsv3_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-at-least-thirty-two-chars';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createAnnouncementRoutes } = require('../src/routes/announcements.routes');

function app(user, service) {
  const router = createAnnouncementRoutes({
    service,
    authenticateMiddleware: (req, _res, next) => { req.user = user; next(); },
    authorizeMiddleware: (...roles) => (req, _res, next) => roles.includes(req.user.role) ? next() : next(Object.assign(new Error('forbidden'), { statusCode: 403 }))
  });
  const server = express();
  server.use(express.json());
  server.use('/api/v1/announcements', router);
  server.use((error, _req, res, _next) => res.status(error.statusCode || (error.name === 'ZodError' ? 400 : 500)).json({ error: error.message }));
  return server;
}

const ID = '44444444-4444-4444-8444-444444444444';
const calls = [];
const service = {
  list: async (input) => { calls.push(['list', input]); return [{ id: ID }]; },
  get: async (input) => { calls.push(['get', input]); return { id: ID }; },
  create: async (input) => { calls.push(['create', input]); return { id: ID }; },
  update: async (input) => { calls.push(['update', input]); return { id: ID }; },
  remove: async (input) => { calls.push(['remove', input]); return { id: ID, deleted: true }; }
};

test('GET is open to every authenticated role and validates filters', async () => {
  const viewer = app({ sub: 'u', role: 'VIEWER' }, service);
  const ok = await request(viewer).get('/api/v1/announcements?category=POLICY&limit=5');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['cache-control'], 'no-store');
  assert.deepEqual(calls.at(-1)[1].query, { category: 'POLICY', limit: 5, includeExpired: false });
  assert.equal((await request(viewer).get('/api/v1/announcements?category=SECRET')).status, 400);
});

test('lowest role reads list and detail', async () => {
  for (const role of ['VIEWER', 'SUPERVISOR', 'MANAGER', 'ADMIN']) {
    const server = app({ sub: 'u', role, employeeAuthority: { id: 'e' } }, service);
    assert.equal((await request(server).get('/api/v1/announcements')).status, 200, role);
    assert.equal((await request(server).get(`/api/v1/announcements/${ID}`)).status, 200, role);
  }
});

test('POST/PATCH/DELETE are ADMIN-only at the route layer (403 for every other role)', async () => {
  const body = { title: 'หัวข้อ', body: 'เนื้อหา', category: 'GENERAL' };
  const before = calls.length;
  for (const role of ['VIEWER', 'SUPERVISOR', 'MANAGER']) {
    const server = app({ sub: 'u', role }, service);
    assert.equal((await request(server).post('/api/v1/announcements').send(body)).status, 403, role);
    assert.equal((await request(server).patch(`/api/v1/announcements/${ID}`).send({ pinned: true })).status, 403, role);
    assert.equal((await request(server).delete(`/api/v1/announcements/${ID}`)).status, 403, role);
  }
  assert.equal(calls.length, before);
  const admin = app({ sub: 'u', role: 'ADMIN' }, service);
  assert.equal((await request(admin).post('/api/v1/announcements').send(body)).status, 201);
  assert.equal((await request(admin).patch(`/api/v1/announcements/${ID}`).send({ pinned: true })).status, 200);
  assert.equal((await request(admin).delete(`/api/v1/announcements/${ID}`)).status, 200);
});

test('validation rejects oversize title, unknown fields, bad ids and bad dates', async () => {
  const admin = app({ sub: 'u', role: 'ADMIN' }, service);
  assert.equal((await request(admin).post('/api/v1/announcements').send({ title: 'x'.repeat(151), body: 'b', category: 'GENERAL' })).status, 400);
  assert.equal((await request(admin).post('/api/v1/announcements').send({ title: 't', body: 'b', category: 'GENERAL', siteId: '44444444-4444-4444-8444-444444444444' })).status, 400);
  assert.equal((await request(admin).post('/api/v1/announcements').send({ title: 't', body: 'b', category: 'GENERAL', expiresOn: '31/10/2026' })).status, 400);
  assert.equal((await request(admin).post('/api/v1/announcements').send({ title: 't', body: 'x'.repeat(5001), category: 'GENERAL' })).status, 400);
  assert.equal((await request(admin).patch('/api/v1/announcements/not-a-uuid').send({ pinned: true })).status, 400);
});

test('popups list is open to every role; image upload/delete ADMIN-only; image read requires auth only', async () => {
  const svc = { ...service, popups: async () => [{ id: ID }], setImage: async () => ({ id: ID, hasImage: true }), removeImage: async () => ({ id: ID }), image: async () => ({ bytes: Buffer.from([0xff, 0xd8, 0xff]), mimeType: 'image/jpeg' }) };
  const viewer = app({ sub: 'u', role: 'VIEWER' }, svc);
  assert.equal((await request(viewer).get('/api/v1/announcements/popups')).status, 200);
  const img = await request(viewer).get(`/api/v1/announcements/${ID}/image`);
  assert.equal(img.status, 200);
  assert.equal(img.headers['content-type'], 'image/jpeg');
  assert.match(img.headers['cache-control'], /private/);
  for (const role of ['VIEWER', 'SUPERVISOR', 'MANAGER']) {
    const server = app({ sub: 'u', role }, svc);
    assert.equal((await request(server).put(`/api/v1/announcements/${ID}/image`).attach('image', Buffer.from([0xff, 0xd8, 0xff, 0]), { filename: 'a.jpg', contentType: 'image/jpeg' })).status, 403, role);
    assert.equal((await request(server).delete(`/api/v1/announcements/${ID}/image`)).status, 403, role);
  }
  const admin = app({ sub: 'u', role: 'ADMIN' }, svc);
  assert.equal((await request(admin).put(`/api/v1/announcements/${ID}/image`).attach('image', Buffer.from([0xff, 0xd8, 0xff, 0]), { filename: 'a.jpg', contentType: 'image/jpeg' })).status, 200);
  assert.equal((await request(admin).put(`/api/v1/announcements/${ID}/image`).attach('image', Buffer.alloc(5 * 1024 * 1024 + 10), { filename: 'a.jpg', contentType: 'image/jpeg' })).status, 413);
  assert.equal((await request(admin).post('/api/v1/announcements').send({ title: 't', body: 'b', category: 'GENERAL', showPopup: 'yes' })).status, 400);
  assert.equal((await request(admin).post('/api/v1/announcements').send({ title: 't', body: 'b', category: 'GENERAL', showPopup: true })).status, 201);
});
