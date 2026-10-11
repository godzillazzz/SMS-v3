'use strict';

// Keep the Owner-approved Employee License scope identical for dashboard and Cron.
function securityGuardEmployeeWhere(scope = {}) {
  return {
    ...scope,
    OR: [
      { jobTitle: { contains: 'guard', mode: 'insensitive' } },
      { jobTitle: { contains: 'รปภ' } },
      { jobTitle: { contains: 'รักษาความปลอดภัย' } }
    ]
  };
}

function securityGuardRelationScope(scope) {
  return { ...scope, employee: { is: securityGuardEmployeeWhere(scope?.employee?.is || { isActive: true, deletedAt: null }) } };
}

module.exports = { securityGuardEmployeeWhere, securityGuardRelationScope };
