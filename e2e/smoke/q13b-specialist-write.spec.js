'use strict';

const { test, expect } = require('../helpers/uat-test');
const { roleAccessToken } = require('../helpers/uat-auth');
const { authenticatedRequest } = require('../helpers/uat-authenticated-request');

const Q13B_CONFIRMATION = 'MUTATE_Q13B_PREVIEW_SPECIALIST_V1';
const AUTO_PATTERN_CODE = 'ZZZ_Q13B_UAT_PATTERN_V1';
const AUTO_PATTERN_NAME = 'Q13B Preview Fixture V1';
const LEAVE_MARKER = 'Q13B-UAT';
const FIXTURE_EMPLOYEE_CODE = 'ZZZ-UAT-DISPOSABLE-V1';
const FIXTURE_LEAVE_DATE = '2026-11-17';

function assertMutationGuard() {
  expect(process.env.UAT_TARGET_MODE).toBe('preview');
  expect(process.env.Q13B_WRITE_CONFIRMATION).toBe(Q13B_CONFIRMATION);
  expect(process.env.UAT_BASE_URL).toMatch(/^https:\/\/sms-v3-staging-[a-z0-9]+-godzillazz\.vercel\.app$/i);
  expect(process.env.UAT_BASE_URL).not.toBe('https://sms-v3-staging-ten.vercel.app');
}

async function findFixtureEmployee(accessToken) {
  const response = await authenticatedRequest(`/api/v1/employees?page=1&pageSize=20&search=${encodeURIComponent(FIXTURE_EMPLOYEE_CODE)}`, { accessToken });
  expect(response.status).toBe(200);
  const exact = (response.payload?.data || []).filter((row) => row.employeeCode === FIXTURE_EMPLOYEE_CODE);
  expect(exact).toHaveLength(1);
  return exact[0];
}

async function leaveRows(accessToken) {
  const response = await authenticatedRequest(`/api/v1/leave-requests?page=1&pageSize=50&search=${encodeURIComponent(LEAVE_MARKER)}`, { accessToken });
  expect(response.status).toBe(200);
  return response.payload?.data || [];
}

async function bestEffortTerminalLeave(accessToken, leaveId) {
  if (!leaveId) return;
  const rows = await leaveRows(accessToken).catch(() => []);
  const row = rows.find((item) => item.id === leaveId);
  if (!row || ['CANCELLED', 'REJECTED'].includes(row.status)) return;
  if (row.status === 'PENDING') {
    const returned = await authenticatedRequest(`/api/v1/leave-requests/${leaveId}/return-for-correction`, {
      accessToken,
      method: 'POST',
      data: { reason: 'Q13B-UAT fallback return before cleanup' }
    }).catch(() => null);
    if (!returned || returned.status !== 200) return;
  }
  await authenticatedRequest(`/api/v1/leave-requests/${leaveId}/cancel`, {
    accessToken,
    method: 'POST',
    data: { reason: 'Q13B-UAT fallback terminal cleanup' }
  }).catch(() => undefined);
}

function approvalBody(policy) {
  return {
    reviewerRoles: [...policy.reviewerRoles],
    dueSoonHours: policy.dueSoonHours,
    overdueHours: policy.overdueHours,
    additionalSupervisorAliases: [...(policy.additionalSupervisorAliases || [])],
    additionalManagerAliases: [...(policy.additionalManagerAliases || [])]
  };
}

function changedApprovalBody(policy) {
  const next = approvalBody(policy);
  if (next.dueSoonHours < Math.min(168, next.overdueHours - 1)) next.dueSoonHours += 1;
  else if (next.dueSoonHours > 1) next.dueSoonHours -= 1;
  else if (next.overdueHours < 720) next.overdueHours += 1;
  else next.overdueHours -= 1;
  if (next.overdueHours <= next.dueSoonHours) throw new Error('Q13B_APPROVAL_POLICY_MUTATION_UNAVAILABLE');
  return next;
}

async function readLeavePolicy(accessToken) {
  const response = await authenticatedRequest('/api/v1/approval-policies', { accessToken });
  expect(response.status).toBe(200);
  const row = (response.payload?.data || []).find((item) => item.requestType === 'LEAVE_REQUEST');
  expect(row).toBeTruthy();
  return row;
}

test('Q13B ADMIN: Preview mutation safety guard', async () => {
  assertMutationGuard();
  const accessToken = roleAccessToken('ADMIN');
  const ready = await authenticatedRequest('/api/v1/ready', { accessToken });
  expect(ready.status).toBe(200);
  expect(ready.payload?.status).toBe('ready');
  expect(ready.payload?.database).toBe('ok');
});

test('Q13B ADMIN: Leave Pending reversible decision workflow', async () => {
  assertMutationGuard();
  test.setTimeout(120_000);
  const accessToken = roleAccessToken('ADMIN');
  const employee = await findFixtureEmployee(accessToken);
  const typesResponse = await authenticatedRequest('/api/v1/leave-types?includeInactive=true', { accessToken });
  expect(typesResponse.status).toBe(200);
  const leaveType = (typesResponse.payload?.data || []).find((row) => row.isActive !== false && ['SICK', 'PERSONAL', 'VACATION'].includes(row.quotaBucket));
  expect(leaveType).toBeTruthy();

  let leaveId;
  try {
    const created = await authenticatedRequest('/api/v1/leave-requests', {
      accessToken,
      method: 'POST',
      data: {
        employeeId: employee.id,
        leaveType: leaveType.code,
        startDate: FIXTURE_LEAVE_DATE,
        endDate: FIXTURE_LEAVE_DATE,
        substitute: 'Q13B UAT Substitute',
        reason: `${LEAVE_MARKER} reversible Leave Pending decision`
      }
    });
    expect(created.status).toBe(201);
    expect(created.payload?.data?.status).toBe('PENDING');
    leaveId = created.payload?.data?.id;
    expect(leaveId).toBeTruthy();

    const returned = await authenticatedRequest(`/api/v1/leave-requests/${leaveId}/return-for-correction`, {
      accessToken,
      method: 'POST',
      data: { reason: `${LEAVE_MARKER} return-for-correction contract` }
    });
    expect(returned.status).toBe(200);
    expect(returned.payload?.data?.status).toBe('RETURNED_FOR_CORRECTION');

    const cancelled = await authenticatedRequest(`/api/v1/leave-requests/${leaveId}/cancel`, {
      accessToken,
      method: 'POST',
      data: { reason: `${LEAVE_MARKER} owner cancellation cleanup` }
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.payload?.data?.status).toBe('CANCELLED');

    const rows = await leaveRows(accessToken);
    expect(rows.find((row) => row.id === leaveId)?.status).toBe('CANCELLED');
  } finally {
    await bestEffortTerminalLeave(accessToken, leaveId);
  }
});

test('Q13B ADMIN: Auto Schedule Pattern create update and cleanup', async () => {
  assertMutationGuard();
  const accessToken = roleAccessToken('ADMIN');
  const existing = await authenticatedRequest('/api/v1/auto-schedule-patterns?includeInactive=true', { accessToken });
  expect(existing.status).toBe(200);
  expect((existing.payload?.data || []).some((row) => row.code === AUTO_PATTERN_CODE)).toBe(false);

  const shifts = await authenticatedRequest('/api/v1/shift-types', { accessToken });
  expect(shifts.status).toBe(200);
  const shift = (shifts.payload?.data || []).find((row) => row.isActive !== false && row.code !== 'AL');
  expect(shift).toBeTruthy();
  const baselineSteps = [{ phaseCode: 'Q13B1', shiftCode: shift.code, label: 'Q13B fixture baseline' }];
  let patternId;
  try {
    const created = await authenticatedRequest('/api/v1/auto-schedule-patterns', {
      accessToken,
      method: 'POST',
      data: { code: AUTO_PATTERN_CODE, name: AUTO_PATTERN_NAME, mode: 'CYCLE', steps: baselineSteps, isActive: false, targetGroup: 'MANUAL', sortOrder: 9900 }
    });
    expect(created.status).toBe(201);
    expect(created.payload?.data?.code).toBe(AUTO_PATTERN_CODE);
    patternId = created.payload?.data?.id;
    expect(patternId).toBeTruthy();

    const updated = await authenticatedRequest(`/api/v1/auto-schedule-patterns/${patternId}`, {
      accessToken,
      method: 'PUT',
      data: { name: `${AUTO_PATTERN_NAME} Updated`, isActive: true, sortOrder: 9901, steps: [{ ...baselineSteps[0], label: 'Q13B fixture updated' }] }
    });
    expect(updated.status).toBe(200);
    expect(updated.payload?.data?.isActive).toBe(true);
    expect(updated.payload?.data?.name).toBe(`${AUTO_PATTERN_NAME} Updated`);

    const readBack = await authenticatedRequest('/api/v1/auto-schedule-patterns?includeInactive=true', { accessToken });
    expect(readBack.status).toBe(200);
    const row = (readBack.payload?.data || []).find((item) => item.id === patternId);
    expect(row?.code).toBe(AUTO_PATTERN_CODE);
    expect(row?.isActive).toBe(true);
  } finally {
    if (patternId) {
      await authenticatedRequest(`/api/v1/auto-schedule-patterns/${patternId}`, {
        accessToken,
        method: 'PUT',
        data: { name: AUTO_PATTERN_NAME, mode: 'CYCLE', steps: baselineSteps, isActive: false, targetGroup: 'MANUAL', sortOrder: 9900 }
      }).catch(() => undefined);
    }
  }
});

test('Q13B ADMIN: Approval Authority policy update and exact restore', async () => {
  assertMutationGuard();
  const accessToken = roleAccessToken('ADMIN');
  const original = await readLeavePolicy(accessToken);
  const changed = changedApprovalBody(original);
  try {
    const update = await authenticatedRequest('/api/v1/approval-policies/LEAVE_REQUEST', { accessToken, method: 'PUT', data: changed });
    expect(update.status).toBe(200);
    const after = update.payload?.data;
    expect(after).toBeTruthy();
    expect(after.dueSoonHours === original.dueSoonHours && after.overdueHours === original.overdueHours).toBe(false);
  } finally {
    const restore = await authenticatedRequest('/api/v1/approval-policies/LEAVE_REQUEST', { accessToken, method: 'PUT', data: approvalBody(original) });
    expect(restore.status).toBe(200);
  }
  const restored = await readLeavePolicy(accessToken);
  expect(approvalBody(restored)).toEqual(approvalBody(original));
});

test('Q13B ADMIN: Access self-mutation denial contract', async () => {
  assertMutationGuard();
  const accessToken = roleAccessToken('ADMIN');
  const users = await authenticatedRequest('/api/v1/users', { accessToken });
  expect(users.status).toBe(200);
  const adminEmail = String(process.env.UAT_ADMIN_EMAIL || '').trim().toLowerCase();
  expect(adminEmail).toBeTruthy();
  const before = (users.payload?.data || []).find((row) => String(row.email || '').toLowerCase() === adminEmail);
  expect(before).toBeTruthy();
  expect(before.accountStatus).toBe('ACTIVE');
  expect(before.isActive).toBe(true);

  const denied = await authenticatedRequest(`/api/v1/users/${before.id}`, {
    accessToken,
    method: 'PUT',
    data: { accountStatus: 'SUSPENDED' }
  });
  expect(denied.status).toBe(403);
  expect(JSON.stringify(denied.payload || {})).toContain('SELF_ACCESS_MUTATION_FORBIDDEN');

  const afterUsers = await authenticatedRequest('/api/v1/users', { accessToken });
  expect(afterUsers.status).toBe(200);
  const after = (afterUsers.payload?.data || []).find((row) => row.id === before.id);
  expect(after?.accountStatus).toBe(before.accountStatus);
  expect(after?.isActive).toBe(before.isActive);
  expect(after?.role).toBe(before.role);
});