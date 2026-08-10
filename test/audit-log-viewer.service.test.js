const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PAGE_SIZE,
  auditLogQuery,
  bangkokDateStart,
  buildAuditLogWhere,
  getAuditLogPage,
  isTechnicalEvent,
  sanitizeAuditMetadata
} = require('../src/services/audit-log-viewer.service');

test('audit log query defaults to bounded server pagination and excludes technical session noise', () => {
  const filters = auditLogQuery.parse({});
  assert.equal(filters.page, 1);
  assert.equal(filters.pageSize, DEFAULT_PAGE_SIZE);
  const where = buildAuditLogWhere(filters);
  assert.deepEqual(where.AND, [{ NOT: { OR: [{ action: { in: ['REFRESH', 'TOKEN_REUSE'] } }, { entityType: 'RefreshSession' }] } }]);
  assert.throws(() => auditLogQuery.parse({ pageSize: 101 }));
  assert.throws(() => auditLogQuery.parse({ dateFrom: '2026-08-11', dateTo: '2026-08-10' }));
});

test('audit log filters use Bangkok-inclusive date boundaries and deterministic query clauses', () => {
  const filters = auditLogQuery.parse({ page: '2', pageSize: '50', dateFrom: '2026-08-10', dateTo: '2026-08-10', actor: 'Admin', entityType: 'LeaveRequest', action: 'UPDATE', search: 'leave', category: 'all' });
  const where = buildAuditLogWhere(filters);
  assert.equal(where.createdAt.gte.toISOString(), bangkokDateStart('2026-08-10').toISOString());
  assert.equal(where.createdAt.lt.toISOString(), '2026-08-10T17:00:00.000Z');
  assert.equal(where.entityType.equals, 'LeaveRequest');
  assert.equal(where.action, 'UPDATE');
  assert.equal(where.AND.length, 2);
  assert.equal(where.AND[0].actor.is.displayName.contains, 'Admin');
  assert.equal(where.AND[1].OR[0].entityType.contains, 'leave');
});

test('metadata sanitization redacts nested sensitive values and bounds large payloads', () => {
  const metadata = sanitizeAuditMetadata({ password: 'never-show', nested: { refreshToken: 'never-show', safe: 'visible' }, api_key: 'never-show' });
  assert.equal(metadata.password, '[REDACTED]');
  assert.equal(metadata.nested.refreshToken, '[REDACTED]');
  assert.equal(metadata.nested.safe, 'visible');
  assert.equal(metadata.api_key, '[REDACTED]');
  const oversized = sanitizeAuditMetadata({ notes: 'x'.repeat(10000) });
  assert.ok(String(oversized.notes || oversized.notice).length <= 600);
});

test('audit page query resolves actors in one bounded read and keeps missing actors safe', async () => {
  const calls = {};
  const client = {
    auditLog: {
      count(options) { calls.count = options; return Promise.resolve(2); },
      findMany(options) {
        calls.findMany = options;
        return Promise.resolve([
          { id: 'newest', action: 'UPDATE', entityType: 'EmployeeLicenseDocument', entityId: 'license-doc', metadata: { event: 'APPROVE', accessToken: 'redact' }, createdAt: new Date('2026-08-10T09:00:00.000Z'), actor: { id: 'actor-1', displayName: 'Admin One', role: 'ADMIN' } },
          { id: 'older', action: 'CREATE', entityType: 'LeaveRequest', entityId: 'leave-1', metadata: { status: 'PENDING' }, createdAt: new Date('2026-08-10T08:00:00.000Z'), actor: null }
        ]);
      }
    },
    $transaction(queries) { return Promise.all(queries); }
  };
  const result = await getAuditLogPage({ prismaClient: client, query: { page: 2, pageSize: 25, category: 'all' } });
  assert.equal(result.meta.total, 2);
  assert.equal(result.meta.page, 2);
  assert.equal(calls.findMany.skip, 25);
  assert.equal(calls.findMany.take, 25);
  assert.deepEqual(calls.findMany.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
  assert.equal(result.data[0].module, 'LICENSE');
  assert.equal(result.data[0].metadata.accessToken, '[REDACTED]');
  assert.equal(result.data[1].actor, null);
  assert.equal(isTechnicalEvent({ action: 'REFRESH', entityType: 'User' }), true);
  assert.equal(isTechnicalEvent({ action: 'LOGIN', entityType: 'User' }), false);
});
