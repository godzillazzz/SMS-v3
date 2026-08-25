'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSecuritySiteAuthorityService, SITE_AUTHORITY_SOURCES } = require('../src/services/security-site-authority.service');

const ids = {
  employee: '11111111-1111-4111-8111-111111111111',
  assignment: '22222222-2222-4222-8222-222222222222',
  scheduleSite: '33333333-3333-4333-8333-333333333333',
  defaultSite: '44444444-4444-4444-8444-444444444444'
};

function site(id, overrides = {}) {
  return { id, code: id === ids.scheduleSite ? 'SCH' : 'HOME', name: 'Site', latitude: 13.7, longitude: 100.5, geofenceRadiusMeters: 100, isActive: true, ...overrides };
}

function assignment(overrides = {}) {
  return { id: ids.assignment, employeeId: ids.employee, departmentSnapshot: 'OPS', securitySiteId: null, securitySite: null, ...overrides };
}

function fakeDb({ defaultRows = [], employeeDepartment = 'OPS', sites = {} } = {}) {
  const state = { rawCalls: 0, siteCalls: 0 };
  return {
    state,
    db: {
      securitySite: {
        findUnique: async ({ where }) => { state.siteCalls += 1; return sites[where.id] || null; }
      },
      employee: {
        findUnique: async () => ({ department: employeeDepartment })
      },
      $queryRawUnsafe: async () => { state.rawCalls += 1; return defaultRows; }
    }
  };
}

test('explicit ShiftAssignment SecuritySite has highest authority and does not consult Department Default', async () => {
  const schedule = site(ids.scheduleSite);
  const { db, state } = fakeDb({ defaultRows: [{ ...site(ids.defaultSite), securitySiteId: ids.defaultSite, departmentName: 'OPS', isDefault: true }] });
  const service = createSecuritySiteAuthorityService({ prisma: db });
  const result = await service.resolve({ assignment: assignment({ securitySiteId: ids.scheduleSite, securitySite: schedule }) });
  assert.equal(result.site.id, ids.scheduleSite);
  assert.equal(result.source, SITE_AUTHORITY_SOURCES.SCHEDULE);
  assert.equal(result.pinnedBySession, false);
  assert.equal(state.rawCalls, 0);
});

test('Department Default Site is used when schedule has no explicit Site', async () => {
  const home = { ...site(ids.defaultSite), securitySiteId: ids.defaultSite, departmentName: 'OPS', isDefault: true };
  const { db } = fakeDb({ defaultRows: [home] });
  const result = await createSecuritySiteAuthorityService({ prisma: db }).resolve({ assignment: assignment() });
  assert.equal(result.site.id, ids.defaultSite);
  assert.equal(result.source, SITE_AUTHORITY_SOURCES.DEPARTMENT_DEFAULT);
  assert.equal(result.departmentName, 'OPS');
});

test('missing or conflicting Department Default fails closed', async () => {
  const missing = fakeDb({ defaultRows: [] }).db;
  await assert.rejects(
    () => createSecuritySiteAuthorityService({ prisma: missing }).resolve({ assignment: assignment() }),
    (error) => error.details?.code === 'ATTENDANCE_SITE_REQUIRED'
  );

  const row = { ...site(ids.defaultSite), securitySiteId: ids.defaultSite, departmentName: 'OPS', isDefault: true };
  const conflict = fakeDb({ defaultRows: [row, { ...row, id: ids.scheduleSite, securitySiteId: ids.scheduleSite }] }).db;
  await assert.rejects(
    () => createSecuritySiteAuthorityService({ prisma: conflict }).resolve({ assignment: assignment() }),
    (error) => error.details?.code === 'ATTENDANCE_SITE_AUTHORITY_CONFLICT'
  );
});

test('existing AttendanceSession pins historical expected Site when Department Default changes', async () => {
  const pinned = site(ids.defaultSite);
  const { db, state } = fakeDb({
    defaultRows: [{ ...site(ids.scheduleSite), securitySiteId: ids.scheduleSite, departmentName: 'OPS', isDefault: true }],
    sites: { [ids.defaultSite]: pinned }
  });
  const result = await createSecuritySiteAuthorityService({ prisma: db }).resolve({
    assignment: assignment(),
    existingSession: {
      expectedSiteId: ids.defaultSite,
      expectationSnapshot: { site: { authoritySource: 'DEPARTMENT_DEFAULT', departmentName: 'OPS' } }
    }
  });
  assert.equal(result.site.id, ids.defaultSite);
  assert.equal(result.pinnedBySession, true);
  assert.equal(state.rawCalls, 0);
});

test('inactive schedule/default/pinned Site fails closed', async () => {
  const inactiveSchedule = site(ids.scheduleSite, { isActive: false });
  const { db: explicitDb } = fakeDb();
  await assert.rejects(
    () => createSecuritySiteAuthorityService({ prisma: explicitDb }).resolve({ assignment: assignment({ securitySiteId: ids.scheduleSite, securitySite: inactiveSchedule }) }),
    (error) => error.details?.code === 'ATTENDANCE_SITE_INACTIVE'
  );

  const inactiveDefault = { ...site(ids.defaultSite, { isActive: false }), securitySiteId: ids.defaultSite, departmentName: 'OPS', isDefault: true };
  await assert.rejects(
    () => createSecuritySiteAuthorityService({ prisma: fakeDb({ defaultRows: [inactiveDefault] }).db }).resolve({ assignment: assignment() }),
    (error) => error.details?.code === 'ATTENDANCE_SITE_INACTIVE'
  );
});
