'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createAnnouncementService, bangkokEndOfDay, ANNOUNCEMENT_CATEGORIES
} = require('../src/services/announcement.service');

const NOW = new Date('2026-10-31T05:00:00.000Z'); // 12:00 Bangkok
const ADMIN = { sub: '11111111-1111-4111-8111-111111111111', role: 'ADMIN' };
const VIEWER = { sub: '22222222-2222-4222-8222-222222222222', role: 'VIEWER', employeeAuthority: { id: 'emp-1' } };
const MANAGER = { sub: '33333333-3333-4333-8333-333333333333', role: 'MANAGER' };
const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function fakePrisma(rows = [], { viewerSites = [SITE_A] } = {}) {
  const state = { rows: rows.map((row) => ({ ...row })), audits: [] };
  const matches = (row, where = {}) => {
    if ('deletedAt' in where && where.deletedAt === null && row.deletedAt) return false;
    if (where.id && row.id !== where.id) return false;
    if (where.category && row.category !== where.category) return false;
    if (where.OR) {
      const ok = where.OR.some((clause) => {
        if ('expiresAt' in clause && clause.expiresAt === null) return row.expiresAt === null;
        if (clause.expiresAt?.gt) return row.expiresAt && row.expiresAt > clause.expiresAt.gt;
        if ('siteId' in clause && clause.siteId === null) return row.siteId === null;
        if (clause.siteId?.in) return clause.siteId.in.includes(row.siteId);
        return false;
      });
      if (!ok) return false;
    }
    if (where.AND) return where.AND.every((part) => matches(row, part));
    return true;
  };
  const client = {
    state,
    announcement: {
      async findMany({ where, orderBy, take }) {
        const list = state.rows.filter((row) => matches(row, where));
        list.sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (b.createdAt - a.createdAt));
        assert.deepEqual(orderBy, [{ pinned: 'desc' }, { createdAt: 'desc' }]);
        return list.slice(0, take);
      },
      async findFirst({ where }) { return state.rows.find((row) => matches(row, where)) || null; },
      async create({ data }) { const row = { id: `a${state.rows.length + 1}`, createdAt: NOW, updatedAt: NOW, deletedAt: null, updatedBy: null, ...data }; state.rows.push(row); return row; },
      async update({ where, data }) { const row = state.rows.find((item) => item.id === where.id); Object.assign(row, data); return row; }
    },
    shiftAssignment: { async findMany() { return viewerSites.map((securitySiteId) => ({ securitySiteId })); } },
    securitySite: { async findUnique({ where }) { return [SITE_A, SITE_B].includes(where.id) ? { id: where.id, name: 'Site' } : null; } },
    async $transaction(fn) { return fn(client); }
  };
  const audit = { async log(entry) { state.audits.push(entry); } };
  return { client, audit, state };
}

const base = (over) => ({ id: over.id, title: over.title || over.id, body: 'b', category: 'GENERAL', pinned: false, siteId: null, expiresAt: null, createdBy: ADMIN.sub, createdAt: new Date('2026-10-30T00:00:00Z'), deletedAt: null, ...over });

test('bangkokEndOfDay maps a calendar date to the following Bangkok midnight', () => {
  assert.equal(bangkokEndOfDay('2026-10-31').toISOString(), '2026-10-31T17:00:00.000Z');
  assert.throws(() => bangkokEndOfDay('2026-02-30'), /ANNOUNCEMENT_EXPIRY_INVALID|invalid/i);
  assert.deepEqual(ANNOUNCEMENT_CATEGORIES, ['GENERAL', 'POLICY', 'EVENT']);
});

test('list orders pinned first then newest and hides expired and deleted rows', async () => {
  const { client, audit } = fakePrisma([
    base({ id: 'old', createdAt: new Date('2026-10-01T00:00:00Z') }),
    base({ id: 'pin', pinned: true, createdAt: new Date('2026-09-01T00:00:00Z') }),
    base({ id: 'new', createdAt: new Date('2026-10-30T00:00:00Z') }),
    base({ id: 'expired', expiresAt: new Date('2026-10-30T17:00:00Z') }),
    base({ id: 'today', expiresAt: new Date('2026-10-31T17:00:00Z') }),
    base({ id: 'gone', deletedAt: NOW })
  ]);
  const service = createAnnouncementService({ prisma: client, audit, clock: () => NOW });
  const list = await service.list({ actor: MANAGER, query: {} });
  assert.deepEqual(list.map((row) => row.id), ['pin', 'new', 'today', 'old']);
  assert.equal(list[0].expired, false);
});

test('ADMIN may include expired rows; non-admin includeExpired is ignored', async () => {
  const rows = [base({ id: 'expired', expiresAt: new Date('2026-10-30T17:00:00Z') })];
  const { client, audit } = fakePrisma(rows);
  const service = createAnnouncementService({ prisma: client, audit, clock: () => NOW });
  assert.equal((await service.list({ actor: ADMIN, query: { includeExpired: true } })).length, 1);
  assert.equal((await service.list({ actor: MANAGER, query: { includeExpired: true } })).length, 0);
});

test('site scope: viewer sees global and own-site announcements only', async () => {
  const rows = [base({ id: 'global' }), base({ id: 'siteA', siteId: SITE_A }), base({ id: 'siteB', siteId: SITE_B })];
  const { client, audit } = fakePrisma(rows, { viewerSites: [SITE_A] });
  const service = createAnnouncementService({ prisma: client, audit, clock: () => NOW });
  const viewer = await service.list({ actor: VIEWER, query: {} });
  assert.deepEqual(viewer.map((row) => row.id).sort(), ['global', 'siteA']);
  const manager = await service.list({ actor: MANAGER, query: {} });
  assert.equal(manager.length, 3);
});

test('viewer without an employee link sees global announcements only', async () => {
  const rows = [base({ id: 'global' }), base({ id: 'siteA', siteId: SITE_A })];
  const { client, audit } = fakePrisma(rows);
  const service = createAnnouncementService({ prisma: client, audit, clock: () => NOW });
  const list = await service.list({ actor: { sub: 'x', role: 'VIEWER' }, query: {} });
  assert.deepEqual(list.map((row) => row.id), ['global']);
});

test('create/update/remove require ADMIN at the service and are audited; delete is soft', async () => {
  const { client, audit, state } = fakePrisma([]);
  const service = createAnnouncementService({ prisma: client, audit, clock: () => NOW });
  await assert.rejects(service.create({ actor: MANAGER, input: { title: 't', body: 'b', category: 'GENERAL' } }), (error) => error.statusCode === 403);
  const created = await service.create({ actor: ADMIN, input: { title: '  แจ้ง  ', body: '<b>x</b>', category: 'POLICY', pinned: true, expiresOn: '2026-11-01', siteId: SITE_A } });
  assert.equal(created.title, 'แจ้ง');
  assert.equal(created.body, '<b>x</b>');
  assert.equal(created.expiresOn, '2026-11-01');
  assert.equal(state.rows[0].expiresAt.toISOString(), '2026-11-01T17:00:00.000Z');
  await assert.rejects(service.update({ actor: VIEWER, id: created.id, input: { pinned: false } }), (error) => error.statusCode === 403);
  const updated = await service.update({ actor: ADMIN, id: created.id, input: { pinned: false, expiresOn: null } });
  assert.equal(updated.pinned, false);
  assert.equal(updated.expiresOn, null);
  await assert.rejects(service.remove({ actor: MANAGER, id: created.id }), (error) => error.statusCode === 403);
  await service.remove({ actor: ADMIN, id: created.id });
  assert.ok(state.rows[0].deletedAt instanceof Date);
  assert.equal(state.rows.length, 1);
  await assert.rejects(service.remove({ actor: ADMIN, id: created.id }), (error) => error.statusCode === 404);
  assert.deepEqual(state.audits.map((entry) => entry.action), ['CREATE', 'UPDATE', 'DELETE']);
  assert.ok(state.audits.every((entry) => entry.entityType === 'Announcement'));
});

test('create rejects past expiry dates and unknown sites', async () => {
  const { client, audit } = fakePrisma([]);
  const service = createAnnouncementService({ prisma: client, audit, clock: () => NOW });
  await assert.rejects(service.create({ actor: ADMIN, input: { title: 't', body: 'b', category: 'GENERAL', expiresOn: '2026-10-30' } }), (error) => error.details?.code === 'ANNOUNCEMENT_EXPIRY_PAST');
  await service.create({ actor: ADMIN, input: { title: 't', body: 'b', category: 'GENERAL', expiresOn: '2026-10-31' } });
  await assert.rejects(service.create({ actor: ADMIN, input: { title: 't', body: 'b', category: 'GENERAL', siteId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } }), (error) => error.details?.code === 'ANNOUNCEMENT_SITE_NOT_FOUND');
});
