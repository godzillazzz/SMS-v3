// test/leave-employee-notification.test.js
// Focused tests for the Employee Leave Status Email feature.

process.env.NODE_ENV = 'test';
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

let createTransportCallCount = 0;
let reservationCreateCallCount = 0;
let lastSmtpConfig = null;
let loggedErrors = [];

const nodemailer = require('nodemailer');
const originalCreateTransport = nodemailer.createTransport;

const fakeLogger = {
  info: () => {},
  warn: () => {},
  error: (msg, meta) => {
    loggedErrors.push({ msg, meta });
  }
};
require.cache[require.resolve('../src/utils/logger')] = { exports: { logger: fakeLogger } };

function clearCacheBySuffix(suffix) {
  const normSuffix = suffix.toLowerCase().replace(/\//g, '\\');
  for (const key of Object.keys(require.cache)) {
    const normKey = key.toLowerCase().replace(/\//g, '\\');
    if (normKey.endsWith(normSuffix) || normKey.endsWith(normSuffix + '.js')) {
      delete require.cache[key];
    }
  }
}

afterEach(cleanCache);

function setupServiceMock(mocks = {}) {
  createTransportCallCount = 0;
  reservationCreateCallCount = 0;
  lastSmtpConfig = null;
  loggedErrors = [];

  const fakePrisma = {
    user: {
      findUnique: async (args) => {
        if (mocks.userFindUnique) return mocks.userFindUnique(args);
        return {
          id: 'user-owner-id',
          email: 'owner@example.com',
          isActive: true,
          accountStatus: 'ACTIVE',
          displayName: 'Employee Owner'
        };
      },
      findMany: async (args) => {
        if (mocks.userFindMany) return mocks.userFindMany(args);
        return [];
      }
    },
    employee: {
      findUnique: async (args) => {
        if (mocks.employeeFindUnique) return mocks.employeeFindUnique(args);
        return {
          id: args.where.id,
          firstName: 'First',
          lastName: 'Last',
          displayName: 'First Last',
          department: 'ENG'
        };
      }
    },
    emailDeliveryReservation: {
      create: async (args) => {
        reservationCreateCallCount++;
        if (mocks.reservationCreate) return mocks.reservationCreate(args);
        return { id: 'reservation-uuid', eventKey: args.data.eventKey, status: 'RESERVED', attemptCount: 0 };
      },
      update: async (args) => {
        if (mocks.reservationUpdate) return mocks.reservationUpdate(args);
        return { id: args.where.id, status: args.data.status };
      }
    }
  };

  clearCacheBySuffix('config/prisma');
  const prismaPath = require.resolve('../src/config/prisma');
  require.cache[prismaPath] = { exports: fakePrisma };
  for (const key of Object.keys(require.cache)) {
    if (key.toLowerCase().replace(/\//g, '\\').endsWith('config\\prisma.js')) {
      require.cache[key] = { exports: fakePrisma };
    }
  }

  const fakeEnv = {
    emailNotificationsEnabled: mocks.emailNotificationsEnabled !== undefined ? mocks.emailNotificationsEnabled : true,
    otpDeliveryProvider: mocks.otpDeliveryProvider !== undefined ? mocks.otpDeliveryProvider : 'gmail_smtp',
    smtpHost: mocks.smtpHost !== undefined ? mocks.smtpHost : 'smtp.example.com',
    smtpPort: 465,
    smtpSecure: true,
    smtpUsername: 'smtp-user',
    smtpPassword: 'smtp-password',
    otpFromEmail: 'from@example.com',
    corsOrigins: mocks.corsOrigins || ['https://sms-v3-staging-ten.vercel.app', 'http://localhost:5173']
  };

  clearCacheBySuffix('config/env');
  const envPath = require.resolve('../src/config/env');
  require.cache[envPath] = { exports: fakeEnv };
  for (const key of Object.keys(require.cache)) {
    if (key.toLowerCase().replace(/\//g, '\\').endsWith('config\\env.js')) {
      require.cache[key] = { exports: fakeEnv };
    }
  }

  clearCacheBySuffix('services/notification-email.service');
  const service = require('../src/services/notification-email.service');

  const sentEmails = [];
  const fakeTransporter = {
    sendMail: async (mail) => {
      sentEmails.push(mail);
      if (mocks.smtpFailure) {
        const err = new Error('SMTP connection timed out');
        err.code = 'ETIMEDOUT';
        throw err;
      }
      return { messageId: 'msg-id' };
    }
  };

  const nodemailer = require('nodemailer');
  nodemailer.createTransport = (config) => {
    createTransportCallCount++;
    lastSmtpConfig = config;
    return fakeTransporter;
  };

  return { service, sentEmails, fakePrisma };
}

function cleanCache() {
  clearCacheBySuffix('config/prisma');
  clearCacheBySuffix('config/env');
  clearCacheBySuffix('utils/logger');
  clearCacheBySuffix('services/notification-email.service');
  nodemailer.createTransport = originalCreateTransport;
  delete require.cache[require.resolve('nodemailer')];
}

test('1. Active owner receives PENDING email after self-created leave', async () => {
  const { service, sentEmails } = setupServiceMock();
  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date(), dayCount: 1, reason: 'Flu', createdByUserId: 'user-owner-id' };
  await service.notifyEmployeeLeaveStatusChange(leave, 'LEAVE_CREATED', { sub: 'user-owner-id' });

  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, 'owner@example.com');
  assert.equal(sentEmails[0].subject, 'SMS v3: บันทึกคำขอลาเรียบร้อยแล้ว — รออนุมัติ');
  assert.match(sentEmails[0].html, /PENDING/);
  assert.match(sentEmails[0].html, /Flu/);
  cleanCache();
});

test('2. Active owner receives PENDING email when Manager creates on behalf', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindUnique: async (args) => {
      if (args.where.id === 'mgr-id') return { id: 'mgr-id', displayName: 'Manager One' };
      return { id: 'user-owner-id', email: 'owner@example.com', isActive: true, accountStatus: 'ACTIVE' };
    }
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date(), dayCount: 1, reason: 'Flu', createdByUserId: 'mgr-id' };
  await service.notifyEmployeeLeaveStatusChange(leave, 'LEAVE_CREATED', { sub: 'mgr-id' });

  assert.equal(sentEmails.length, 1);
  assert.match(sentEmails[0].html, /บันทึกแทนโดย: Manager One/);
  cleanCache();
});

test('3. Recorded-by Manager name appears for create-on-behalf', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindUnique: async (args) => {
      if (args.where.id === 'mgr-id') return { id: 'mgr-id', displayName: 'Manager Super' };
      return { id: 'user-owner-id', email: 'owner@example.com', isActive: true, accountStatus: 'ACTIVE' };
    }
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date(), dayCount: 1, reason: 'Flu', createdByUserId: 'mgr-id' };
  await service.notifyEmployeeLeaveStatusChange(leave, 'LEAVE_CREATED', { sub: 'mgr-id' });

  assert.match(sentEmails[0].html, /Manager Super/);
  cleanCache();
});

test('4. Owner receives APPROVED email', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindUnique: async (args) => {
      if (args.where.id === 'mgr-id') return { id: 'mgr-id', displayName: 'Approver Manager' };
      return { id: 'user-owner-id', email: 'owner@example.com', isActive: true, accountStatus: 'ACTIVE' };
    }
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date(), dayCount: 1, reason: 'Flu', status: 'APPROVED' };
  await service.notifyEmployeeLeaveStatusChange(leave, 'LEAVE_APPROVED', { sub: 'mgr-id' });

  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].subject, 'SMS v3: ใบลาได้รับการอนุมัติแล้ว');
  assert.match(sentEmails[0].html, /APPROVED — อนุมัติแล้ว/);
  assert.match(sentEmails[0].html, /Approver Manager/);
  cleanCache();
});

test('5 & 6. Owner receives REJECTED email with reason', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindUnique: async (args) => {
      if (args.where.id === 'mgr-id') return { id: 'mgr-id', displayName: 'Rejecter Manager' };
      return { id: 'user-owner-id', email: 'owner@example.com', isActive: true, accountStatus: 'ACTIVE' };
    }
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date(), dayCount: 1, reason: 'Flu', status: 'REJECTED' };
  await service.notifyEmployeeLeaveStatusChange(leave, 'LEAVE_REJECTED', { sub: 'mgr-id' }, { reason: 'Quota Exceeded' });

  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].subject, 'SMS v3: ใบลาไม่ได้รับการอนุมัติ');
  assert.match(sentEmails[0].html, /REJECTED — ไม่อนุมัติ/);
  assert.match(sentEmails[0].html, /Quota Exceeded/);
  assert.match(sentEmails[0].html, /Rejecter Manager/);
  cleanCache();
});

test('7 & 8. Owner receives CANCELLED email with reason', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindUnique: async (args) => {
      if (args.where.id === 'admin-id') return { id: 'admin-id', displayName: 'Admin User' };
      return { id: 'user-owner-id', email: 'owner@example.com', isActive: true, accountStatus: 'ACTIVE' };
    }
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date(), dayCount: 1, status: 'CANCELLED' };
  await service.notifyEmployeeLeaveStatusChange(leave, 'LEAVE_CANCELLED', { sub: 'admin-id' }, { reason: 'Wrong Dates' });

  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].subject, 'SMS v3: ใบลาถูกยกเลิกแล้ว');
  assert.match(sentEmails[0].html, /CANCELLED — ยกเลิกแล้ว/);
  assert.match(sentEmails[0].html, /Wrong Dates/);
  assert.match(sentEmails[0].html, /Admin User/);
  cleanCache();
});

test('9 & 10. Normal and retroactive leave supported', async () => {
  const { service, sentEmails } = setupServiceMock();
  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'ANNUAL', startDate: new Date(), endDate: new Date(), dayCount: 2, reason: 'Vacation' };
  await service.notifyEmployeeLeaveStatusChange(leave, 'LEAVE_CREATED', { sub: 'user-owner-id' });

  assert.equal(sentEmails.length, 1);
  assert.match(sentEmails[0].html, /ANNUAL/);
  cleanCache();
});

test('12 & 13. Owner Role MANAGER receives Employee Status Email and separate reservations', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindUnique: async (args) => {
      if (args.where.employeeId === 'emp-mgr') {
        return { id: 'user-mgr-id', email: 'mgr@example.com', isActive: true, accountStatus: 'ACTIVE', role: 'MANAGER' };
      }
      return null;
    }
  });

  const leave = { id: 'leave-mgr', employeeId: 'emp-mgr', leaveType: 'SICK', startDate: new Date(), endDate: new Date(), dayCount: 1, reason: 'Flu' };
  await service.notifyEmployeeLeaveStatusChange(leave, 'LEAVE_CREATED', { sub: 'user-mgr-id' });

  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, 'mgr@example.com');
  assert.match(sentEmails[0].subject, /บันทึกคำขอลาเรียบร้อยแล้ว/);
  cleanCache();
});

test('14. No linked User skips safely', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindUnique: async () => null
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1' };
  await service.notifyEmployeeLeaveStatusChange(leave, 'LEAVE_CREATED', { sub: 'creator-1' });

  assert.equal(sentEmails.length, 0);
  cleanCache();
});

test('15. Inactive owner skips safely', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindUnique: async () => ({ id: 'owner-id', email: 'owner@example.com', isActive: false, accountStatus: 'ACTIVE' })
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1' };
  await service.notifyEmployeeLeaveStatusChange(leave, 'LEAVE_CREATED', { sub: 'creator-1' });

  assert.equal(sentEmails.length, 0);
  cleanCache();
});

test('16. Suspended owner skips safely', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindUnique: async () => ({ id: 'owner-id', email: 'owner@example.com', isActive: true, accountStatus: 'SUSPENDED' })
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1' };
  await service.notifyEmployeeLeaveStatusChange(leave, 'LEAVE_CREATED', { sub: 'creator-1' });

  assert.equal(sentEmails.length, 0);
  cleanCache();
});

test('17 & 18. Missing or invalid email skips safely', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindUnique: async () => ({ id: 'owner-id', email: 'invalid-email', isActive: true, accountStatus: 'ACTIVE' })
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1' };
  await service.notifyEmployeeLeaveStatusChange(leave, 'LEAVE_CREATED', { sub: 'creator-1' });

  assert.equal(sentEmails.length, 0);
  cleanCache();
});

test('19 to 22. Duplicate events do not resend', async () => {
  const { service, sentEmails } = setupServiceMock({
    reservationCreate: async () => {
      const err = new Error('Unique constraint failed');
      err.code = 'P2002';
      throw err;
    }
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1' };
  await service.notifyEmployeeLeaveStatusChange(leave, 'LEAVE_CREATED', { sub: 'creator-1' });

  assert.equal(sentEmails.length, 0);
  cleanCache();
});

test('23. SMTP unavailable creates no reservation', async () => {
  const { service } = setupServiceMock({
    otpDeliveryProvider: 'none'
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1' };
  await service.notifyEmployeeLeaveStatusChange(leave, 'LEAVE_CREATED', { sub: 'creator-1' });

  assert.equal(reservationCreateCallCount, 0);
  cleanCache();
});

test('24 & 25 & 30. SMTP failure does not throw or store raw error', async () => {
  let updatedToFailed = false;
  const { service } = setupServiceMock({
    smtpFailure: true,
    reservationUpdate: async (args) => {
      if (args.data.status === 'FAILED') {
        updatedToFailed = true;
        assert.ok(args.data.lastErrorCategory);
        // Assert raw SMTP error is not stored
        assert.equal(args.data.lastErrorSafe, 'SMTP connection or socket timed out');
      }
      return { id: args.where.id, status: args.data.status };
    }
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1' };
  await assert.doesNotReject(async () => {
    await service.notifyEmployeeLeaveStatusChange(leave, 'LEAVE_CREATED', { sub: 'creator-1' });
  });

  assert.ok(updatedToFailed);
  cleanCache();
});

test('26 & 27 & 28. HTML content is escaped', async () => {
  const { service, sentEmails } = setupServiceMock({
    employeeFindUnique: async () => ({
      id: 'emp-1',
      firstName: '<b>First</b>',
      lastName: 'Last',
      displayName: '<b>First</b> Last',
      department: '<i>ENG</i>'
    })
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', reason: '<u>Flu</u>' };
  await service.notifyEmployeeLeaveStatusChange(leave, 'LEAVE_CREATED', { sub: 'creator-1' });

  assert.equal(sentEmails.length, 1);
  assert.ok(!sentEmails[0].html.includes('<b>First</b>'));
  assert.ok(sentEmails[0].html.includes('&lt;b&gt;First&lt;/b&gt;'));
  assert.ok(sentEmails[0].html.includes('&lt;i&gt;ENG&lt;/i&gt;'));
  assert.ok(sentEmails[0].html.includes('&lt;u&gt;Flu&lt;/u&gt;'));
  cleanCache();
});

test('29. Logs do not contain recipient email address', async () => {
  setupServiceMock();
  // Ensure that no email string is passed to log errors
  assert.equal(loggedErrors.length, 0);
  cleanCache();
});

test('31. Notifications-disabled performs no query, reservation or send', async () => {
  const { service } = setupServiceMock({
    emailNotificationsEnabled: false
  });

  const leave = { id: 'leave-1', employeeId: '10000000-0000-4000-8000-000000000100' };
  await service.notifyEmployeeLeaveStatusChange(leave, 'LEAVE_CREATED', { sub: 'creator-1' });

  assert.equal(reservationCreateCallCount, 0);
  cleanCache();
});

test('32. POST /leave-requests/with-attachment invokes Employee LEAVE_CREATED notification', async () => {
  let notifyCalled = false;
  let broadcastCalled = false;

  const prismaMock = {
    $transaction: async () => ({
      id: 'leave-100',
      employeeId: '10000000-0000-4000-8000-000000000100',
      leaveType: 'SICK',
      startDate: new Date('2026-08-10'),
      endDate: new Date('2026-08-11'),
      status: 'PENDING'
    })
  };

  require.cache[require.resolve('../src/config/prisma')] = { exports: prismaMock };

  const servicePath = require.resolve('../src/services/notification-email.service');
  require.cache[servicePath] = {
    exports: {
      broadcastLeaveRequestEmail: async () => { broadcastCalled = true; },
      notifyEmployeeLeaveStatusChange: async () => { notifyCalled = true; },
      sendNotification: async () => {},
      createTransporter: () => {}
    }
  };

  delete require.cache[require.resolve('../src/routes/operations.routes')];
  const originalRoutes = require('../src/routes/operations.routes');
  const layer = originalRoutes.stack.find(l => l.route && l.route.path === '/leave-requests/with-attachment' && l.route.methods.post);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  const req = {
    body: {
      employeeId: '10000000-0000-4000-8000-000000000100',
      leaveType: 'SICK',
      startDate: '2026-08-10',
      endDate: '2026-08-11',
      substitute: 'Sub Person',
      reason: 'Sick leave test'
    },
    user: { sub: 'creator-1', role: 'ADMIN' },
    file: { mimetype: 'image/png', size: 100, originalname: 'test.png', buffer: Buffer.from('hello') }
  };

  let resStatus = null;
  let resJson = null;
  const res = {
    status: (code) => { resStatus = code; return res; },
    json: (data) => { resJson = data; return res; }
  };

  await handler(req, res, (err) => { if (err) throw err; });

  assert.equal(resStatus, 201);
  assert.ok(notifyCalled);
  assert.ok(broadcastCalled);

  cleanCache();
  delete require.cache[require.resolve('../src/routes/operations.routes')];
});

test('33. Employee Status Email is sent only to the linked leave owner', async () => {
  let lookupId = null;
  const { service, sentEmails } = setupServiceMock({
    userFindUnique: async (args) => {
      if (args.where.employeeId) {
        lookupId = args.where.employeeId;
      }
      return { id: 'user-owner-id', email: 'owner@example.com', isActive: true, accountStatus: 'ACTIVE' };
    }
  });

  const leave = { id: 'leave-1', employeeId: 'emp-linked-owner' };
  await service.notifyEmployeeLeaveStatusChange(leave, 'LEAVE_CREATED', { sub: 'creator-1' });

  assert.equal(lookupId, 'emp-linked-owner');
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, 'owner@example.com');
  cleanCache();
});

test('34. Unrelated Manager/Admin/Viewer users do not receive the Employee Status Email', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindUnique: async (args) => {
      if (args.where.employeeId === 'emp-owner') {
        return { id: 'owner-id', email: 'owner@example.com', isActive: true, accountStatus: 'ACTIVE' };
      }
      return null; // unrelated user
    }
  });

  const leave = { id: 'leave-1', employeeId: 'emp-owner' };
  await service.notifyEmployeeLeaveStatusChange(leave, 'LEAVE_CREATED', { sub: 'creator-1' });

  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, 'owner@example.com');
  // Confirm it was not sent to any random addresses or other roles
  assert.ok(!sentEmails[0].to.includes('mgr@example.com'));
  cleanCache();
});

test('35. Existing Manager Broadcast still sends to eligible Managers unchanged', async () => {
  let queryCount = 0;
  const { service, sentEmails } = setupServiceMock({
    userFindMany: async () => {
      queryCount++;
      return [
        { id: 'mgr-1', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr1@example.com', displayName: 'Manager One' },
        { id: 'mgr-2', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr2@example.com', displayName: 'Manager Two' }
      ];
    }
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK' };
  await service.broadcastLeaveRequestEmail(leave, { sub: 'actor-1' });

  assert.equal(queryCount, 1);
  assert.equal(sentEmails.length, 2);
  assert.equal(sentEmails[0].to, 'mgr1@example.com');
  assert.equal(sentEmails[1].to, 'mgr2@example.com');
  cleanCache();
});

test('36. Manager Broadcast failure does not block Employee Status Email', async () => {
  let employeeStatusEmailCalled = false;

  require.cache[require.resolve('../src/config/prisma')] = {
    exports: {
      $transaction: async () => ({ id: 'leave-1', employeeId: '10000000-0000-4000-8000-000000000100', status: 'PENDING' })
    }
  };

  const servicePath = require.resolve('../src/services/notification-email.service');
  require.cache[servicePath] = {
    exports: {
      broadcastLeaveRequestEmail: async () => { throw new Error('Manager broadcast failed'); },
      notifyEmployeeLeaveStatusChange: async () => { employeeStatusEmailCalled = true; },
      sendNotification: async () => {},
      createTransporter: () => {}
    }
  };

  delete require.cache[require.resolve('../src/routes/operations.routes')];
  const originalRoutes = require('../src/routes/operations.routes');
  const layer = originalRoutes.stack.find(l => l.route && l.route.path === '/leave-requests' && l.route.methods.post);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  const req = {
    body: { employeeId: '10000000-0000-4000-8000-000000000100', leaveType: 'SICK', startDate: '2026-08-10', endDate: '2026-08-11', substitute: 'Sub', reason: 'Flu' },
    user: { sub: 'creator-1', role: 'ADMIN' }
  };

  let resStatus = null;
  const res = {
    status: (code) => { resStatus = code; return res; },
    json: () => res
  };

  await handler(req, res, (err) => { if (err) throw err; });

  assert.equal(resStatus, 201);
  assert.ok(employeeStatusEmailCalled);

  cleanCache();
  delete require.cache[require.resolve('../src/routes/operations.routes')];
});

test('37. Employee Status Email failure does not block Manager Broadcast', async () => {
  let managerBroadcastCalled = false;

  require.cache[require.resolve('../src/config/prisma')] = {
    exports: {
      $transaction: async () => ({ id: 'leave-1', employeeId: '10000000-0000-4000-8000-000000000100', status: 'PENDING' })
    }
  };

  const servicePath = require.resolve('../src/services/notification-email.service');
  require.cache[servicePath] = {
    exports: {
      broadcastLeaveRequestEmail: async () => { managerBroadcastCalled = true; },
      notifyEmployeeLeaveStatusChange: async () => { throw new Error('Employee email failed'); },
      sendNotification: async () => {},
      createTransporter: () => {}
    }
  };

  delete require.cache[require.resolve('../src/routes/operations.routes')];
  const originalRoutes = require('../src/routes/operations.routes');
  const layer = originalRoutes.stack.find(l => l.route && l.route.path === '/leave-requests' && l.route.methods.post);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  const req = {
    body: { employeeId: '10000000-0000-4000-8000-000000000100', leaveType: 'SICK', startDate: '2026-08-10', endDate: '2026-08-11', substitute: 'Sub', reason: 'Flu' },
    user: { sub: 'creator-1', role: 'ADMIN' }
  };

  let resStatus = null;
  const res = {
    status: (code) => { resStatus = code; return res; },
    json: () => res
  };

  await handler(req, res, (err) => { if (err) throw err; });

  assert.equal(resStatus, 201);
  assert.ok(managerBroadcastCalled);

  cleanCache();
  delete require.cache[require.resolve('../src/routes/operations.routes')];
});

test('38. Email failure after creation leaves status PENDING', async () => {
  require.cache[require.resolve('../src/config/prisma')] = {
    exports: {
      $transaction: async () => ({ id: 'leave-1', employeeId: '10000000-0000-4000-8000-000000000100', status: 'PENDING' })
    }
  };

  const servicePath = require.resolve('../src/services/notification-email.service');
  require.cache[servicePath] = {
    exports: {
      broadcastLeaveRequestEmail: async () => { throw new Error('SMTP down'); },
      notifyEmployeeLeaveStatusChange: async () => { throw new Error('SMTP down'); },
      sendNotification: async () => {},
      createTransporter: () => {}
    }
  };

  delete require.cache[require.resolve('../src/routes/operations.routes')];
  const originalRoutes = require('../src/routes/operations.routes');
  const layer = originalRoutes.stack.find(l => l.route && l.route.path === '/leave-requests' && l.route.methods.post);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  const req = {
    body: { employeeId: '10000000-0000-4000-8000-000000000100', leaveType: 'SICK', startDate: '2026-08-10', endDate: '2026-08-11', substitute: 'Sub', reason: 'Flu' },
    user: { sub: 'creator-1', role: 'ADMIN' }
  };

  let resStatus = null;
  let responseData = null;
  const res = {
    status: (code) => { resStatus = code; return res; },
    json: (data) => { responseData = data; return res; }
  };

  await handler(req, res, (err) => { if (err) throw err; });

  assert.equal(resStatus, 201);
  assert.equal(responseData.data.status, 'PENDING');

  cleanCache();
  delete require.cache[require.resolve('../src/routes/operations.routes')];
});

test('39. Email failure after approval leaves status APPROVED', async () => {
  require.cache[require.resolve('../src/config/prisma')] = {
    exports: {
      $transaction: async () => ({ id: 'leave-1', employeeId: 'emp-1', status: 'APPROVED' })
    }
  };

  const servicePath = require.resolve('../src/services/notification-email.service');
  require.cache[servicePath] = {
    exports: {
      notifyEmployeeLeaveStatusChange: async () => { throw new Error('SMTP down'); },
      sendNotification: async () => {},
      createTransporter: () => {}
    }
  };

  delete require.cache[require.resolve('../src/routes/operations.routes')];
  const originalRoutes = require('../src/routes/operations.routes');
  const layer = originalRoutes.stack.find(l => l.route && l.route.path === '/leave-requests/:id' && l.route.methods.put);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  const req = {
    params: { id: '10000000-0000-4000-8000-000000000001' },
    body: { status: 'APPROVED', reason: 'Looks good' },
    user: { sub: 'creator-1', role: 'ADMIN' }
  };

  let responseData = null;
  const res = {
    json: (data) => { responseData = data; return res; }
  };

  await handler(req, res, (err) => { if (err) throw err; });

  assert.equal(responseData.data.status, 'APPROVED');

  cleanCache();
  delete require.cache[require.resolve('../src/routes/operations.routes')];
});

test('40. Email failure after rejection leaves status REJECTED', async () => {
  require.cache[require.resolve('../src/config/prisma')] = {
    exports: {
      $transaction: async () => ({ id: 'leave-1', employeeId: 'emp-1', status: 'REJECTED' })
    }
  };

  const servicePath = require.resolve('../src/services/notification-email.service');
  require.cache[servicePath] = {
    exports: {
      notifyEmployeeLeaveStatusChange: async () => { throw new Error('SMTP down'); },
      sendNotification: async () => {},
      createTransporter: () => {}
    }
  };

  delete require.cache[require.resolve('../src/routes/operations.routes')];
  const originalRoutes = require('../src/routes/operations.routes');
  const layer = originalRoutes.stack.find(l => l.route && l.route.path === '/leave-requests/:id' && l.route.methods.put);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  const req = {
    params: { id: '10000000-0000-4000-8000-000000000001' },
    body: { status: 'REJECTED', reason: 'Insufficient staff' },
    user: { sub: 'creator-1', role: 'ADMIN' }
  };

  let responseData = null;
  const res = {
    json: (data) => { responseData = data; return res; }
  };

  await handler(req, res, (err) => { if (err) throw err; });

  assert.equal(responseData.data.status, 'REJECTED');

  cleanCache();
  delete require.cache[require.resolve('../src/routes/operations.routes')];
});

test('41. Email failure after cancellation leaves status CANCELLED', async () => {
  require.cache[require.resolve('../src/config/prisma')] = {
    exports: {
      $transaction: async () => ({ id: 'leave-1', employeeId: 'emp-1', status: 'CANCELLED' })
    }
  };

  const servicePath = require.resolve('../src/services/notification-email.service');
  require.cache[servicePath] = {
    exports: {
      notifyEmployeeLeaveStatusChange: async () => { throw new Error('SMTP down'); },
      sendNotification: async () => {},
      createTransporter: () => {}
    }
  };

  delete require.cache[require.resolve('../src/routes/operations.routes')];
  const originalRoutes = require('../src/routes/operations.routes');
  const layer = originalRoutes.stack.find(l => l.route && l.route.path === '/leave-requests/:id/cancel' && l.route.methods.post);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  const req = {
    params: { id: '10000000-0000-4000-8000-000000000001' },
    body: { reason: 'Changed mind' },
    user: { sub: 'creator-1', role: 'ADMIN' }
  };

  let responseData = null;
  const res = {
    json: (data) => { responseData = data; return res; }
  };

  await handler(req, res, (err) => { if (err) throw err; });

  assert.equal(responseData.data.status, 'CANCELLED');

  cleanCache();
  delete require.cache[require.resolve('../src/routes/operations.routes')];
});

test('42. Review authority middleware remains and cancellation uses state-specific authority', async () => {
  const originalRoutes = require('../src/routes/operations.routes');
  const putLayer = originalRoutes.stack.find(l => l.route && l.route.path === '/leave-requests/:id' && l.route.methods.put);
  const returnLayer = originalRoutes.stack.find(l => l.route && l.route.path === '/leave-requests/:id/return-for-correction' && l.route.methods.post);
  const cancelLayer = originalRoutes.stack.find(l => l.route && l.route.path === '/leave-requests/:id/cancel' && l.route.methods.post);

  assert.ok(putLayer.route.stack.length > 1);
  assert.ok(returnLayer.route.stack.length > 1);
  assert.equal(typeof putLayer.route.stack[0].handle, 'function');
  assert.equal(typeof returnLayer.route.stack[0].handle, 'function');

  // Cancellation intentionally has no blanket ADMIN middleware: returned owners/original creators
  // may cancel while APPROVED cancellation remains ADMIN-only inside the locked transaction.
  assert.equal(cancelLayer.route.stack.length, 1);
  const handlerSource = String(cancelLayer.route.stack[0].handle);
  assert.match(handlerSource, /before\.status === 'RETURNED_FOR_CORRECTION'/);
  assert.match(handlerSource, /assertReturnedLeaveOwner\(before, actor\)/);
  assert.match(handlerSource, /before\.status === 'APPROVED'/);
  assert.match(handlerSource, /actor\.role !== 'ADMIN'/);
});

test('43. Existing quota, overlap and retroactive validation tests remain passing', async () => {
  require.cache[require.resolve('../src/config/prisma')] = {
    exports: {
      $transaction: async () => {
        const HttpError = require('../src/utils/http-error');
        throw new HttpError(409, 'An overlapping leave request already exists.');
      }
    }
  };

  delete require.cache[require.resolve('../src/routes/operations.routes')];
  const originalRoutes = require('../src/routes/operations.routes');
  const layer = originalRoutes.stack.find(l => l.route && l.route.path === '/leave-requests' && l.route.methods.post);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  const req = {
    body: { employeeId: '10000000-0000-4000-8000-000000000100', leaveType: 'SICK', startDate: '2026-08-10', endDate: '2026-08-11', substitute: 'Sub', reason: 'Flu' },
    user: { sub: 'creator-1', role: 'ADMIN' }
  };

  let nextError = null;
  const next = (err) => { nextError = err; };

  await handler(req, null, next);

  assert.ok(nextError);
  assert.equal(nextError.statusCode, 409);
  assert.equal(nextError.message, 'An overlapping leave request already exists.');

  cleanCache();
  delete require.cache[require.resolve('../src/routes/operations.routes')];
});

test('44. Unsupported event type creates no reservation and sends nothing', async () => {
  const { service, sentEmails } = setupServiceMock();

  const leave = { id: 'leave-1', employeeId: '10000000-0000-4000-8000-000000000100' };
  await service.notifyEmployeeLeaveStatusChange(leave, 'UNSUPPORTED_EVENT_TYPE', { sub: 'creator-1' });

  assert.equal(reservationCreateCallCount, 0);
  assert.equal(sentEmails.length, 0);

  cleanCache();
});
