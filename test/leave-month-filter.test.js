const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLeaveMonth, leaveMonthWhere } = require('../src/utils/leave-month-filter');

test('leave month filter builds UTC date-only overlap boundaries', () => {
  const filter = parseLeaveMonth({ year: '2024', month: '2' });
  assert.equal(filter.monthStart.toISOString(), '2024-02-01T00:00:00.000Z');
  assert.equal(filter.nextMonthStart.toISOString(), '2024-03-01T00:00:00.000Z');
  assert.deepEqual(leaveMonthWhere(filter), { startDate: { lt: filter.nextMonthStart }, endDate: { gte: filter.monthStart } });
});

test('leave month filter includes every overlapping date range and excludes outside ranges', () => {
  const filter = parseLeaveMonth({ year: '2026', month: '8' });
  const where = leaveMonthWhere(filter);
  const overlaps = (start, end) => new Date(start) < where.startDate.lt && new Date(end) >= where.endDate.gte;
  assert.equal(overlaps('2026-08-04', '2026-08-05'), true);
  assert.equal(overlaps('2026-07-30', '2026-08-02'), true);
  assert.equal(overlaps('2026-08-30', '2026-09-02'), true);
  assert.equal(overlaps('2026-07-01', '2026-09-30'), true);
  assert.equal(overlaps('2026-07-01', '2026-07-31'), false);
  assert.equal(overlaps('2026-09-01', '2026-09-02'), false);
});

test('leave month filter supports January and December rollover', () => {
  assert.equal(parseLeaveMonth({ year: '2026', month: '1' }).nextMonthStart.toISOString(), '2026-02-01T00:00:00.000Z');
  assert.equal(parseLeaveMonth({ year: '2026', month: '12' }).nextMonthStart.toISOString(), '2027-01-01T00:00:00.000Z');
});

test('leave month filter rejects invalid or incomplete values', () => {
  for (const query of [{ month: '8' }, { year: '2026' }, { year: '2026', month: '0' }, { year: '2026', month: '13' }, { year: '1899', month: '8' }, { year: '2201', month: '8' }]) {
    assert.throws(() => parseLeaveMonth(query), /provided together|Invalid year or month/);
  }
  assert.equal(parseLeaveMonth({}), undefined);
});
