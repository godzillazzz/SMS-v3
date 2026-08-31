'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeReason, createSecuritySiteService } = require('../src/services/security-site.service');

const siteId = '11111111-1111-4111-8111-111111111111';
const newId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const credentialId = '44444444-4444-4444-8444-444444444444';

const sourceSite = { id: siteId, code: 'PS01', name: 'PS 01', latitude: '13.7', longitude: '100.5', geofenceRadiusMeters: 120, isActive: true, createdAt: new Date(), updatedAt: new Date() };

test('CFG-09 requires governed QR operation reasons', () => {
  assert.equal(normalizeReason(' เปลี่ยนป้าย QR '), 'เปลี่ยนป้าย QR');
  assert.throws(() => normalizeReason('x'), (error) => error.details?.code === 'SECURITY_SITE_REASON_REQUIRED');
});

test('CFG-09 duplicates a Site as INACTIVE without copying QR or Department authority', async () => {
  let createArgs;
  let auditPayload;
  const tx = {
    securitySite: {
      findUnique: async () => sourceSite,
      create: async (args) => { createArgs = args; return { ...sourceSite, id: newId, ...args.data }; }
    }
  };
  const service = createSecuritySiteService({ prisma: { $transaction: async (callback) => callback(tx) }, audit: { log: async (payload) => { auditPayload = payload; } } });
  const result = await service.duplicate(siteId, { code: 'PS02', name: 'PS 02' }, actorId);
  assert.equal(result.id, newId);
  assert.equal(result.isActive, false);
  assert.equal(createArgs.data.latitude, sourceSite.latitude);
  assert.equal(createArgs.data.geofenceRadiusMeters, 120);
  assert.equal(Object.hasOwn(createArgs.data, 'qrCredentials'), false);
  assert.equal(JSON.stringify(createArgs).includes('department'), false);
  assert.equal(auditPayload.metadata.action, 'DUPLICATE');
  assert.equal(auditPayload.metadata.sourceSecuritySiteId, siteId);
});

test('CFG-09 QR rotate and revoke include mandatory reason in Audit but never token/hash', async () => {
  const audits = [];
  const tx = {
    securitySite: { findUnique: async () => sourceSite },
    securitySiteQrCredential: {
      findFirst: async () => ({ version: 1 }),
      updateMany: async () => ({ count: 1 }),
      create: async (args) => ({ id: credentialId, securitySiteId: siteId, version: args.data.version, validFrom: args.data.validFrom, validUntil: null, revokedAt: null, createdAt: args.data.validFrom }),
      findUnique: async () => ({ id: credentialId, securitySiteId: siteId, version: 2, validFrom: new Date(), validUntil: null, revokedAt: null, createdAt: new Date() }),
      update: async ({ data }) => ({ id: credentialId, securitySiteId: siteId, version: 2, validFrom: new Date(), validUntil: null, createdAt: new Date(), ...data })
    }
  };
  const service = createSecuritySiteService({ prisma: { $transaction: async (callback) => callback(tx) }, audit: { log: async (payload) => audits.push(payload) }, randomBytes: () => Buffer.alloc(32, 8) });
  const rotated = await service.rotateQr(siteId, actorId, 'เปลี่ยนป้ายประจำจุด');
  await service.revokeQr(siteId, credentialId, actorId, 'ป้ายสูญหาย');
  assert.equal(audits[0].metadata.reason, 'เปลี่ยนป้ายประจำจุด');
  assert.equal(audits[1].metadata.reason, 'ป้ายสูญหาย');
  const serialized = JSON.stringify(audits);
  assert.equal(serialized.includes(rotated.qrToken), false);
  assert.equal(serialized.includes('tokenHash'), false);
});

test('CFG-09 routes expose duplicate and reason-governed QR lifecycle without hard delete', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'security-sites.routes.js'), 'utf8');
  assert.match(source, /\/:id\/duplicate/);
  assert.match(source, /reasonSchema/);
  assert.match(source, /qr\/rotate/);
  assert.match(source, /qr\/:credentialId\/revoke/);
  assert.doesNotMatch(source, /router\.delete\(/);
});
