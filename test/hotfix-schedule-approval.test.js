const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const { updateScheduleApprovalState, approveMonthlySchedule } = require('../src/services/schedule.service');

describe('Bug 1 — Schedule Approval and Revision Workflow', () => {
  test('updateScheduleApprovalState performs no-op check when isNoOp is true', async () => {
    let queried = false;
    const fakeTx = {
      scheduleApproval: {
        findFirst: async ({ where }) => {
          queried = true;
          return { id: 'appr-1', month: where.month, status: 'APPROVED', revision: 2, approvedAt: new Date() };
        }
      }
    };

    const res = await updateScheduleApprovalState(fakeTx, {
      month: new Date(Date.UTC(2026, 6, 1)),
      actorUserId: 'user-1',
      isNoOp: true
    });

    assert.equal(queried, true);
    assert.equal(res.status, 'APPROVED');
    assert.equal(res.revision, 2);
  });

  test('updateScheduleApprovalState AL-only change preserves APPROVED status and revision', async () => {
    let updated = false;
    let auditLogged = false;
    const monthDate = new Date(Date.UTC(2026, 6, 1));

    const fakeTx = {
      scheduleApproval: {
        findFirst: async () => ({
          id: 'appr-1',
          month: monthDate,
          status: 'APPROVED',
          revision: 3,
          approvedAt: new Date(),
          approvedByLegacyRef: 'admin-1'
        }),
        update: async ({ where, data }) => {
          updated = true;
          assert.equal(where.id, 'appr-1');
          assert.equal(data.status, undefined); // status is NOT changed
          return {
            id: 'appr-1',
            month: monthDate,
            status: 'APPROVED',
            revision: 3,
            approvedAt: new Date(),
            approvedByLegacyRef: 'admin-1'
          };
        }
      },
      auditLog: {
        create: async ({ data }) => {
          auditLogged = true;
          assert.equal(data.entityType, 'ScheduleApproval');
        }
      }
    };

    const res = await updateScheduleApprovalState(fakeTx, {
      month: monthDate,
      actorUserId: 'admin-1',
      isAlOnly: true,
      changeType: 'UPDATE_SHIFT'
    });

    assert.equal(updated, true);
    assert.equal(auditLogged, true);
    assert.equal(res.status, 'APPROVED');
    assert.equal(res.revision, 3);
  });

  test('updateScheduleApprovalState meaningful non-AL change resets status to PENDING and clears approval metadata', async () => {
    let updatedData = null;
    const monthDate = new Date(Date.UTC(2026, 6, 1));

    const fakeTx = {
      scheduleApproval: {
        findFirst: async () => ({
          id: 'appr-1',
          month: monthDate,
          status: 'APPROVED',
          revision: 2,
          approvedAt: new Date(),
          approvedByLegacyRef: 'admin-1'
        }),
        update: async ({ data }) => {
          updatedData = data;
          return {
            id: 'appr-1',
            month: monthDate,
            status: data.status,
            revision: 2,
            approvedAt: data.approvedAt,
            approvedByLegacyRef: data.approvedByLegacyRef
          };
        }
      },
      auditLog: {
        create: async () => {}
      }
    };

    const res = await updateScheduleApprovalState(fakeTx, {
      month: monthDate,
      actorUserId: 'manager-1',
      isAlOnly: false,
      changeType: 'UPDATE_SHIFT'
    });

    assert.equal(updatedData.status, 'PENDING');
    assert.equal(updatedData.approvedAt, null);
    assert.equal(updatedData.approvedByLegacyRef, null);
    assert.equal(res.status, 'PENDING');
    assert.equal(res.revision, 2); // Revision remains unchanged!
  });

  test('approveMonthlySchedule increases revision by 1 when ADMIN approves pending schedule', async () => {
    const monthDate = new Date(Date.UTC(2026, 6, 1));
    let updatedData = null;

    const fakeTx = {
      scheduleApproval: {
        findFirst: async ({ where }) => {
          if (where.status === 'APPROVED') {
            return { revision: 1 };
          }
          return { id: 'appr-1', month: monthDate, status: 'PENDING', revision: 1 };
        },
        update: async ({ data }) => {
          updatedData = data;
          return {
            id: 'appr-1',
            month: monthDate,
            status: 'APPROVED',
            revision: data.revision,
            approvedAt: data.approvedAt,
            approvedByLegacyRef: data.approvedByLegacyRef
          };
        }
      },
      auditLog: {
        create: async () => {}
      }
    };

    const res = await approveMonthlySchedule(fakeTx, {
      month: monthDate,
      approvalNote: 'Approved in test',
      actorUser: { sub: 'admin-1', role: 'ADMIN' }
    });

    assert.equal(updatedData.status, 'APPROVED');
    assert.equal(updatedData.revision, 2);
    assert.equal(res.status, 'APPROVED');
    assert.equal(res.revision, 2);
  });

  test('approveMonthlySchedule is idempotent and does not increment revision if already APPROVED', async () => {
    const monthDate = new Date(Date.UTC(2026, 6, 1));
    let updateCalled = false;

    const fakeTx = {
      scheduleApproval: {
        findFirst: async () => ({
          id: 'appr-1',
          month: monthDate,
          status: 'APPROVED',
          revision: 2,
          approvedAt: new Date(),
          approvedByLegacyRef: 'admin-1'
        }),
        update: async () => {
          updateCalled = true;
        }
      },
      auditLog: {
        create: async () => {}
      }
    };

    const res = await approveMonthlySchedule(fakeTx, {
      month: monthDate,
      actorUser: { sub: 'admin-1', role: 'ADMIN' }
    });

    assert.equal(updateCalled, false);
    assert.equal(res.status, 'APPROVED');
    assert.equal(res.revision, 2);
  });

  test('approveMonthlySchedule rejects MANAGER authorization with HTTP 403', async () => {
    let auditRejectLogged = false;
    const fakeTx = {
      auditLog: {
        create: async ({ data }) => {
          if (data.action === 'REJECTED') {
            auditRejectLogged = true;
          }
        }
      }
    };

    await assert.rejects(
      async () => {
        await approveMonthlySchedule(fakeTx, {
          month: new Date(Date.UTC(2026, 6, 1)),
          actorUser: { sub: 'manager-1', role: 'MANAGER' }
        });
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /Only an Admin may approve/);
        return true;
      }
    );

    assert.equal(auditRejectLogged, true);
  });
});
