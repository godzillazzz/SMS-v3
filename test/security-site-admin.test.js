'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { overlapWarnings, createSecuritySiteService } = require('../src/services/security-site.service');

const ids = {
  site: '11111111-1111-4111-8111-111111111111',
  other: '22222222-2222-4222-8222-222222222222',
  credential: '33333333-3333-4333-8333-333333333333',
  actor: '44444444-4444-4444-8444-444444444444'
};

function site(id, overrides = {}) {
  return { id, code: id === ids.site ? 'A' : 'B', name: 'Security Site', latitude: '13.7000000', longitude: '100.5000000', geofenceRadiusMeters: 100, isActive: true, ...overrides };
}

test('overlap warnings are emitted only when active geofence circles overlap', () => {
  const warnings = overlapWarnings([
    site(ids.site),
    site(ids.other, { latitude: '13.7001000' }),
    site('55555555-5555-4555-8555-555555555555', { latitude: '14.7000000', isActive: false })
  ]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].siteId, ids.site);
  assert.equal(warnings[0].otherSiteId, ids.other);
  assert.ok(warnings[0].overlapMeters > 0);
});

test('QR rotation stores only SHA-256 hash, revokes prior active QR and returns raw token once', async () => {
  const calls = { updateMany: null, create: null, audit: null };
  const tx = {
    securitySite: { findUnique: async () => site(ids.site) },
    securitySiteQrCredential: {
      findFirst: async () => ({ version: 2 }),
      updateMany: async (args) => { calls.updateMany = args; return { count: 1 }; },
      create: async (args) => {
        calls.create = args;
        return { id: ids.credential, securitySiteId: ids.site, version: args.data.version, validFrom: args.data.validFrom, validUntil: null, revokedAt: null, createdAt: args.data.validFrom };
      }
    }
  };
  const prisma = { $transaction: async (callback) => callback(tx) };
  const audit = { log: async (payload) => { calls.audit = payload; } };
  const service = createSecuritySiteService({ prisma, audit, randomBytes: () => Buffer.alloc(32, 7) });
  const result = await service.rotateQr(ids.site, ids.actor, 'routine rotation');
  assert.ok(result.qrToken.length >= 24);
  assert.match(calls.create.data.tokenHash, /^[0-9a-f]{64}$/);
  assert.equal(calls.create.data.tokenHash.includes(result.qrToken), false);
  assert.equal(calls.create.data.version, 3);
  assert.deepEqual(calls.updateMany.where, { securitySiteId: ids.site, revokedAt: null });
  assert.equal(JSON.stringify(calls.audit).includes(result.qrToken), false);
  assert.equal(JSON.stringify(calls.audit).includes(calls.create.data.tokenHash), false);
  assert.equal(Object.hasOwn(result.credential, 'tokenHash'), false);
});

test('deactivation is blocked while a Site is still a Department Default', async () => {
  const tx = {
    securitySite: { findUnique: async () => site(ids.site) },
    $queryRawUnsafe: async () => [{ departmentName: 'OPS' }]
  };
  const service = createSecuritySiteService({ prisma: { $transaction: async (callback) => callback(tx) }, audit: { log: async () => {} } });
  await assert.rejects(
    () => service.update(ids.site, { isActive: false, reason: 'Governed deactivation test' }, ids.actor),
    (error) => error.details?.code === 'SECURITY_SITE_DEFAULT_IN_USE'
  );
});

test('migration enforces many-to-many mapping, one Default per Department and restricts Site deletion', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '202608250002_g06_department_security_site_default_v1', 'migration.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE "security_site_departments"/);
  assert.match(migration, /security_site_id.*department_name/s);
  assert.match(migration, /one_default_per_department_key/);
  assert.match(migration, /WHERE "is_default" = TRUE/);
  assert.match(migration, /ON DELETE RESTRICT/);
});

test('Admin Security Site routes are ADMIN-only, mounted under admin path and expose no hard-delete route', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'security-sites.routes.js'), 'utf8');
  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'index.js'), 'utf8');
  assert.match(routeSource, /router\.use\(authenticate, authorize\('ADMIN'\)\)/);
  assert.match(indexSource, /router\.use\('\/admin\/security-sites', securitySitesRoutes\)/);
  assert.doesNotMatch(routeSource, /router\.delete\(/);
  assert.match(routeSource, /department-mapping/);
  assert.match(routeSource, /qr\/rotate/);
  assert.match(routeSource, /revoke/);
});

test('Security Site deactivation requires an explicit audit reason', async () => {
  const tx={securitySite:{findUnique:async()=>({id:'site-1',code:'A',name:'A',latitude:1,longitude:2,geofenceRadiusMeters:100,isActive:true}),update:async()=>{throw new Error('must not update');}},$queryRawUnsafe:async()=>[],attendanceSession:{findFirst:async()=>null}};
  const service=createSecuritySiteService({prisma:{$transaction:async cb=>cb(tx)},audit:{log:async()=>{}}});
  await assert.rejects(()=>service.update('site-1',{isActive:false},'actor-1'),(error)=>error.details?.code==='SECURITY_SITE_DEACTIVATION_REASON_REQUIRED');
});
