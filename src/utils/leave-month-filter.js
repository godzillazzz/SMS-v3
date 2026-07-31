const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

function parseLeaveMonth(query = {}) {
  const hasYear = query.year !== undefined && query.year !== '';
  const hasMonth = query.month !== undefined && query.month !== '';
  if (!hasYear && !hasMonth) return undefined;
  if (!hasYear || !hasMonth) throw new Error('Year and month must be provided together.');

  const year = Number(query.year);
  const month = Number(query.month);
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR || !Number.isInteger(month) || month < 1 || month > 12) throw new Error('Invalid year or month.');

  return {
    year,
    month,
    monthStart: new Date(Date.UTC(year, month - 1, 1)),
    nextMonthStart: new Date(Date.UTC(year, month, 1))
  };
}

function leaveMonthWhere(monthFilter) {
  if (!monthFilter) return {};
  return { startDate: { lt: monthFilter.nextMonthStart }, endDate: { gte: monthFilter.monthStart } };
}

module.exports = { parseLeaveMonth, leaveMonthWhere };
