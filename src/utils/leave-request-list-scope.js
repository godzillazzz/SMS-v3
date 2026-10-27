'use strict';

function leaveRequestListActorScopeWhere(actor) {
  const employeeId = actor?.employeeId !== undefined ? actor.employeeId : actor?.employeeAuthority?.id;
  return actor?.role === 'VIEWER' ? { employeeId } : {};
}

function leaveRequestListWhere(actor, filters = {}) {
  return {
    ...leaveRequestListActorScopeWhere(actor),
    ...(actor?.role === 'VIEWER' ? {} : (filters.employeeId ? { employeeId: filters.employeeId } : {})),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.department ? { departmentSnapshot: { contains: filters.department, mode: 'insensitive' } } : {}),
    ...(filters.search ? { OR: [
      { employeeNameSnapshot: { contains: filters.search, mode: 'insensitive' } },
      { departmentSnapshot: { contains: filters.search, mode: 'insensitive' } },
      { leaveTypeNameSnapshot: { contains: filters.search, mode: 'insensitive' } },
      { leaveType: { contains: filters.search, mode: 'insensitive' } },
      { reason: { contains: filters.search, mode: 'insensitive' } }
    ] } : {}),
    ...(filters.monthFilter ? require('./leave-month-filter').leaveMonthWhere(filters.monthFilter) : {})
  };
}

module.exports = { leaveRequestListActorScopeWhere, leaveRequestListWhere };
