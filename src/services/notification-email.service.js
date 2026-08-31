const nodemailer = require('nodemailer');
const prisma = require('../config/prisma');
const env = require('../config/env');
const { leaveTypeDisplayName } = require('./leave-type.service');
const { logger, errorCategory } = require('../utils/logger');
const { emailEventEnabled } = require('./notification-center.service');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createTransporter(configuration = env) {
  if (configuration.otpDeliveryProvider !== 'gmail_smtp' || !configuration.smtpHost) {
    return null;
  }
  return nodemailer.createTransport({
    host: configuration.smtpHost,
    port: configuration.smtpPort,
    secure: configuration.smtpSecure,
    auth: { user: configuration.smtpUsername, pass: configuration.smtpPassword }
  });
}

async function getAdminAndManagerEmails() {
  try {
    const users = await prisma.user.findMany({
      where: {
        role: { in: ['ADMIN', 'MANAGER'] },
        isActive: true,
        accountStatus: 'ACTIVE',
        email: { not: '' }
      },
      select: { email: true }
    });
    return [...new Set(users.map((u) => u.email.trim().toLowerCase()).filter(Boolean))];
  } catch (err) {
    logger.error('Failed to query admin and manager emails', { error: err.message });
    return [];
  }
}

async function sendNotification({ to, subject, html, text }, options = {}) {
  const configuration = options.configuration || env;
  const log = options.logger || logger;
  const createConfiguredTransporter = options.createTransporter || createTransporter;
  if (configuration.emailNotificationsEnabled !== true) {
    log.info('Email notification skipped (system disabled)', { subject });
    return;
  }
  const recipients = [...new Set((Array.isArray(to) ? to : [to])
    .filter((email) => email !== null && email !== undefined)
    .map((email) => String(email).trim().toLowerCase())
    .filter(Boolean))];
  if (!recipients.length) return;

  const transporter = createConfiguredTransporter(configuration);
  if (!transporter) {
    log.info('Email notification skipped (SMTP disabled or not configured)', { subject, recipientCount: recipients.length });
    return;
  }

  let sentCount = 0;
  for (const recipient of recipients) {
    try {
      await transporter.sendMail({
        from: configuration.otpFromEmail || configuration.smtpUsername,
        to: recipient,
        subject,
        text: text || html.replace(/<[^>]+>/g, ''),
        html
      });
      sentCount += 1;
    } catch (error) {
      log.error('Failed to send notification email', { errorCategory: errorCategory(error), subject, recipientCount: 1 });
    }
  }
  if (sentCount > 0) log.info('Notification email sent successfully', { subject, recipientCount: sentCount });
}

async function reserveEmailDelivery(eventKey, context = {}) {
  try {
    return await prisma.emailDeliveryReservation.create({
      data: { eventKey, status: 'RESERVED' }
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      logger.info('Email delivery reservation already exists (duplicate ignored)', { eventKey, ...context });
      return null;
    }
    logger.error('Failed to create email delivery reservation', { error: error.message, eventKey, ...context });
    return null;
  }
}

async function deliverReservedEmail({ reservation, eventKey, recipient, subject, html, transporter, context = {} }) {
  try {
    await prisma.emailDeliveryReservation.update({
      where: { id: reservation.id },
      data: { attemptCount: { increment: 1 } }
    });
    await transporter.sendMail({
      from: env.otpFromEmail || env.smtpUsername,
      to: recipient,
      subject,
      text: html.replace(/<[^>]+>/g, ''),
      html
    });
    await prisma.emailDeliveryReservation.update({
      where: { id: reservation.id },
      data: { status: 'SENT', sentAt: new Date() }
    });
    logger.info('Notification email sent successfully', { eventKey, ...context });
  } catch (sendError) {
    const { category, safeMessage } = mapSmtpError(sendError);
    logger.error('Failed to send notification email', { errorCategory: category, eventKey, ...context });
    try {
      await prisma.emailDeliveryReservation.update({
        where: { id: reservation.id },
        data: { status: 'FAILED', failedAt: new Date(), lastErrorCategory: category, lastErrorSafe: safeMessage }
      });
    } catch (dbError) {
      logger.error('Failed to update email reservation to FAILED status', { error: dbError.message, eventKey, ...context });
    }
  }
}

async function getApprovedScheduleRecipients(month) {
  try {
    const [year, monthNumber] = String(month).split('-').map(Number);
    const start = new Date(Date.UTC(year, monthNumber - 1, 1));
    const end = new Date(Date.UTC(year, monthNumber, 1));
    const assignments = await prisma.shiftAssignment.findMany({
      where: { workDate: { gte: start, lt: end }, employee: { isActive: true, deletedAt: null } },
      select: {
        employeeId: true,
        employee: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
            user: { select: { id: true, email: true, isActive: true, accountStatus: true } }
          }
        }
      }
    });
    const recipients = new Map();
    for (const assignment of assignments) {
      const user = assignment.employee?.user;
      const email = user?.email?.trim().toLowerCase();
      if (!user || user.isActive !== true || user.accountStatus !== 'ACTIVE' || !email || !EMAIL_REGEX.test(email)) continue;
      recipients.set(user.id, {
        userId: user.id,
        employeeId: assignment.employeeId,
        email,
        displayName: assignment.employee.displayName || [assignment.employee.firstName, assignment.employee.lastName].filter(Boolean).join(' ')
      });
    }
    return [...recipients.values()];
  } catch (err) {
    logger.error('Failed to query approved schedule recipients', { error: err.message });
    return [];
  }
}

/**
 * 1. Admin approves monthly schedule -> Notify affected active employees
 */
async function notifyScheduleApproved({ month, approvedBy, revision }) {
  if (!(await emailEventEnabled(prisma, 'SCHEDULE_APPROVED'))) { logger.info('Schedule approval email skipped by governed event policy', { month, revision }); return; }
  try {
    if (env.emailNotificationsEnabled !== true) {
      logger.info('Schedule approval email skipped (system disabled)', { month, revision });
      return;
    }
    const transporter = createTransporter(env);
    if (!transporter) {
      logger.info('Schedule approval email skipped (SMTP disabled or not configured)', { month, revision });
      return;
    }
    const scheduleRecipients = await getApprovedScheduleRecipients(month);
    if (!scheduleRecipients.length) return;

    const [yearStr, monthStr] = month.split('-');
    const thaiMonth = new Intl.DateTimeFormat('th-TH', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1)));
    const thaiYear = Number(yearStr) + 543;
    const monthText = `${thaiMonth} ${thaiYear}`;
    const safeMonth = escapeHtml(month);
    const safeMonthText = escapeHtml(monthText);
    const safeApprovedBy = escapeHtml(approvedBy || 'Admin');

    const subject = `SMS v3: แจ้งเตือนอนุมัติตารางกะประจำเดือน ${monthText}`;
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: #059669; margin-top: 0;">✓ อนุมัติตารางกะประจำเดือนเรียบร้อยแล้ว</h2>
        <p>เรียน พนักงานที่มีตารางกะในเดือนนี้</p>
        <p>ตารางกะการทำงานประจำเดือน <strong>${safeMonthText}</strong> ได้รับการตรวจสอบและอนุมัติอย่างเป็นทางการเรียบร้อยแล้ว</p>
        <table style="border-collapse: collapse; margin: 15px 0; width: 100%; background: #f8fafc; border-radius: 8px;">
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0; width: 140px;">ประจำเดือน:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${safeMonthText} (${safeMonth})</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">ผู้อนุมัติ:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${safeApprovedBy}</td></tr>
          <tr><td style="padding: 10px; font-weight: bold;">สถานะตาราง:</td><td style="padding: 10px; color: #059669; font-weight: bold;">Approved (Revision ${revision || 1})</td></tr>
        </table>
        <p>ท่านสามารถเข้าสู่ระบบเพื่อตรวจสอบปฏิทินตารางกะการทำงานของตนเองได้ที่หน้า <strong>Schedule Calendar</strong></p>
        <p style="color: #64748b; font-size: 13px; margin-bottom: 0;">ระบบ Security Management System v3</p>
      </div>
    `;
    for (const recipient of scheduleRecipients) {
      const eventKey = 'schedule:' + month + ':revision:' + String(revision || 1) + ':APPROVED:employee:' + recipient.userId;
      const reservation = await reserveEmailDelivery(eventKey, { userId: recipient.userId });
      if (!reservation) continue;
      await deliverReservedEmail({
        reservation,
        eventKey,
        recipient: recipient.email,
        subject,
        html,
        transporter,
        context: { userId: recipient.userId, employeeId: recipient.employeeId }
      });
    }
  } catch (err) {
    logger.error('notifyScheduleApproved failed', { error: err.message });
  }
}

/**
 * 2. New user registration verified -> Notify Admin & Manager group
 */
async function notifyNewRegistration({ displayName, email, department }) {
  if (!(await emailEventEnabled(prisma, 'REGISTRATION_NEW'))) { logger.info('New registration email skipped by governed event policy'); return; }
  try {
    const adminManagerEmails = await getAdminAndManagerEmails();
    if (!adminManagerEmails.length) return;
    const safeDisplayName = escapeHtml(displayName);
    const safeEmail = escapeHtml(email);
    const safeDepartment = escapeHtml(department || '-');

    const subject = 'SMS v3: มีคำขอลงทะเบียนแบบส่วนตัวรอตรวจสอบ';
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: #2563eb; margin-top: 0;">👤 มีคำขอลงทะเบียนผู้ใช้งานใหม่</h2>
        <p>เรียน ผู้ดูแลระบบ (Admins & Managers),</p>
        <p>มีคำขอลงทะเบียนแบบส่วนตัวที่ยืนยันอีเมลแล้ว กรุณาตรวจสอบข้อมูลและจับคู่กับ Employee Master ที่มีอยู่ก่อนอนุมัติ:</p>
        <table style="border-collapse: collapse; margin: 15px 0; width: 100%; background: #f8fafc; border-radius: 8px;">
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0; width: 140px;">ชื่อ-นามสกุล:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${safeDisplayName}</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">อีเมล:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${safeEmail}</td></tr>
          <tr><td style="padding: 10px; font-weight: bold;">แผนก:</td><td style="padding: 10px;">${safeDepartment}</td></tr>
        </table>
        <p>กรุณาเข้าสู่ระบบที่หน้า <strong>จัดการผู้ใช้งาน (User Management)</strong> เพื่อ Match Employee Master และอนุมัติ โดยสิทธิ์เริ่มต้นหลังอนุมัติคือ <strong>VIEWER</strong></p>
        <p style="color: #64748b; font-size: 13px; margin-bottom: 0;">ระบบ Security Management System v3</p>
      </div>
    `;
    await sendNotification({ to: adminManagerEmails, subject, html });
  } catch (err) {
    logger.error('notifyNewRegistration failed', { error: err.message });
  }
}

async function notifyRegistrationDecision({ request, eventType }) {
  if (!['REGISTRATION_APPROVED', 'REGISTRATION_REJECTED'].includes(eventType)) return;
  if (env.emailNotificationsEnabled !== true) {
    logger.info('Registration decision email skipped (system disabled)', { registrationRequestId: request?.id, eventType });
    return;
  }

  const recipient = request?.email?.trim().toLowerCase();
  if (!recipient || !EMAIL_REGEX.test(recipient)) {
    logger.warn('Registration decision email skipped (missing or invalid applicant email)', { registrationRequestId: request?.id, eventType });
    return;
  }

  const transporter = createTransporter(env);
  if (!transporter) {
    logger.info('Registration decision email skipped (SMTP disabled or not configured)', { registrationRequestId: request.id, eventType });
    return;
  }

  const eventKey = 'registration:' + request.id + ':' + eventType + ':applicant';
  const reservation = await reserveEmailDelivery(eventKey, { registrationRequestId: request.id });
  if (!reservation) return;

  const isApproved = eventType === 'REGISTRATION_APPROVED';
  const safeName = escapeHtml(request.submittedName || 'ผู้สมัคร');
  const safeReason = escapeHtml(request.rejectionReason || '-');
  const appUrl = getPublicAppUrl(env);
  const safeAppUrl = appUrl ? escapeHtml(appUrl) : '';
  const linkHtml = safeAppUrl
    ? '<p>เข้าสู่ระบบได้ที่: <a href="' + safeAppUrl + '">' + safeAppUrl + '</a></p>'
    : '';
  const subject = isApproved
    ? 'SMS v3: บัญชีได้รับการอนุมัติแล้ว'
    : 'SMS v3: ผลการพิจารณาคำขอลงทะเบียน';
  const html = isApproved
    ? '<div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;">' +
      '<h2 style="color: #059669; margin-top: 0;">บัญชีได้รับการอนุมัติแล้ว</h2>' +
      '<p>เรียน คุณ ' + safeName + '</p>' +
      '<p>บัญชีของคุณได้รับการอนุมัติแล้ว สามารถเข้าสู่ระบบได้</p>' +
      linkHtml +
      '<p style="color: #64748b; font-size: 13px;">ระบบ Security Management System v3</p>' +
      '</div>'
    : '<div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;">' +
      '<h2 style="color: #b91c1c; margin-top: 0;">ผลการพิจารณาคำขอลงทะเบียน</h2>' +
      '<p>เรียน คุณ ' + safeName + '</p>' +
      '<p>คำขอลงทะเบียนของคุณไม่ได้รับการอนุมัติ</p>' +
      '<p>เหตุผล: ' + safeReason + '</p>' +
      linkHtml +
      '<p style="color: #64748b; font-size: 13px;">ระบบ Security Management System v3</p>' +
      '</div>';

  await deliverReservedEmail({
    reservation,
    eventKey,
    recipient,
    subject,
    html,
    transporter,
    context: { registrationRequestId: request.id, eventType }
  });
}

/**
 * Legacy/unmounted leave-service helper. Active leave submission notifications
 * use broadcastLeaveRequestEmail from operations.routes.js.
 */
async function notifyLeaveSubmitted({ employeeName, leaveType, startDate, endDate, dayCount, reason, substitute, department }) {
  try {
    const adminManagerEmails = await getAdminAndManagerEmails();
    if (!adminManagerEmails.length) return;

    const startText = startDate ? new Date(startDate).toISOString().slice(0, 10) : '';
    const endText = endDate ? new Date(endDate).toISOString().slice(0, 10) : '';

    const subject = `SMS v3: มีคำขอลาใหม่ (${employeeName} - ${leaveType})`;
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: #d97706; margin-top: 0;">📝 มีคำขอลาใหม่รออนุมัติ</h2>
        <p>เรียน ผู้ดูแลระบบและหัวหน้างาน (Admins & Managers),</p>
        <p>พนักงานได้ยื่นคำขอลาพักงานใหม่เข้าสู่คิวรออนุมัติ:</p>
        <table style="border-collapse: collapse; margin: 15px 0; width: 100%; background: #f8fafc; border-radius: 8px;">
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0; width: 140px;">พนักงาน:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${employeeName} (${department || '-'})</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">ประเภทการลา:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${leaveType}</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">ช่วงวันที่:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${startText} ถึง ${endText} (${dayCount} วัน)</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">ผู้ปฏิบัติงานแทน:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${substitute || '-'}</td></tr>
          <tr><td style="padding: 10px; font-weight: bold;">เหตุผล:</td><td style="padding: 10px;">${reason || '-'}</td></tr>
        </table>
        <p>กรุณาเข้าสู่ระบบเพื่อตรวจสอบและอนุมัติใบลาในหน้า <strong>จัดการการลา (Leave Management)</strong></p>
        <p style="color: #64748b; font-size: 13px; margin-bottom: 0;">ระบบ Security Management System v3</p>
      </div>
    `;
    await sendNotification({ to: adminManagerEmails, subject, html });
  } catch (err) {
    logger.error('notifyLeaveSubmitted failed', { error: err.message });
  }
}

/**
 * Legacy/unmounted leave-service helper retained for compatibility. Active
 * leave status notifications use notifyEmployeeLeaveStatusChange from
 * operations.routes.js.
 */
async function notifyLeaveProcessed({ leave, status, approverName }) {
  try {
    const adminManagerEmails = await getAdminAndManagerEmails();

    let requesterEmail = null;
    if (leave.employeeId) {
      const emp = await prisma.employee.findUnique({
        where: { id: leave.employeeId },
        select: { email: true, user: { select: { email: true } } }
      });
      requesterEmail = emp?.email || emp?.user?.email || null;
    }

    const recipients = [...new Set([...adminManagerEmails, requesterEmail].filter(Boolean))];
    if (!recipients.length) return;

    const isApproved = status === 'APPROVED';
    const statusText = isApproved ? 'อนุมัติแล้ว ✅' : 'ไม่อนุมัติ ❌';
    const statusColor = isApproved ? '#059669' : '#dc2626';

    const startText = leave.startDate ? new Date(leave.startDate).toISOString().slice(0, 10) : '';
    const endText = leave.endDate ? new Date(leave.endDate).toISOString().slice(0, 10) : '';

    const subject = `SMS v3: ผลการอนุมัติคำขอลา (${leave.employeeNameSnapshot} - ${leaveTypeDisplayName(leave.leaveType, leave.leaveTypeNameSnapshot)}: ${isApproved ? 'อนุมัติ' : 'ไม่อนุมัติ'})`;
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: ${statusColor}; margin-top: 0;">ผลการอนุมัติคำขอลา: ${statusText}</h2>
        <p>เรียน ${leave.employeeNameSnapshot} และ ทีมบริหาร,</p>
        <p>คำขอลาได้รับการพิจารณาเรียบร้อยแล้ว:</p>
        <table style="border-collapse: collapse; margin: 15px 0; width: 100%; background: #f8fafc; border-radius: 8px;">
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0; width: 140px;">พนักงาน:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${leave.employeeNameSnapshot} (${leave.departmentSnapshot || '-'})</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">ประเภทการลา:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${leaveTypeDisplayName(leave.leaveType, leave.leaveTypeNameSnapshot)}</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">วันที่ลา:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${startText} ถึง ${endText} (${leave.dayCount} วัน)</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">สถานะ:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: ${statusColor};">${statusText}</td></tr>
          <tr><td style="padding: 10px; font-weight: bold;">ผู้ดำเนินการ:</td><td style="padding: 10px;">${approverName || 'Admin/Manager'}</td></tr>
        </table>
        ${isApproved ? '<p style="color: #059669; font-weight: bold;">✓ ระบบได้ทำการอัปเดตกะ AL ลงในปฏิทินตารางกะเรียบร้อยแล้ว</p>' : ''}
        <p style="color: #64748b; font-size: 13px; margin-bottom: 0;">ระบบ Security Management System v3</p>
      </div>
    `;
    await sendNotification({ to: recipients, subject, html });
  } catch (err) {
    logger.error('notifyLeaveProcessed failed', { error: err.message });
  }
}

function getPublicAppUrl(configuration = env) {
  if (!configuration.corsOrigins || !Array.isArray(configuration.corsOrigins)) {
    return null;
  }
  for (const origin of configuration.corsOrigins) {
    if (typeof origin !== 'string') continue;
    const trimmed = origin.trim();
    if (trimmed.startsWith('https://') && !trimmed.includes('localhost') && !trimmed.includes('127.0.0.1')) {
      return trimmed.replace(/\/+$/, '');
    }
  }
  return null;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function mapSmtpError(err) {
  const msg = (err.message || '').toLowerCase();
  let category = 'SMTP_SEND_FAILURE';
  let safeMessage = 'An error occurred during email transmission';

  if (msg.includes('timeout') || msg.includes('time out') || err.code === 'ETIMEDOUT') {
    category = 'SMTP_TIMEOUT';
    safeMessage = 'SMTP connection or socket timed out';
  } else if (msg.includes('auth') || msg.includes('credentials') || msg.includes('354') || msg.includes('535') || msg.includes('login') || msg.includes('password')) {
    category = 'SMTP_AUTH_FAILURE';
    safeMessage = 'SMTP authentication failed';
  } else if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || msg.includes('connection') || msg.includes('connect')) {
    category = 'SMTP_CONNECTION_FAILURE';
    safeMessage = 'Failed to establish connection to SMTP host';
  } else if (msg.includes('rejected') || msg.includes('recipient') || msg.includes('550') || msg.includes('553') || msg.includes('554') || msg.includes('mailbox')) {
    category = 'SMTP_REJECTED';
    safeMessage = 'Recipient or sender address was rejected by host';
  }

  return { category, safeMessage };
}

async function broadcastLeaveRequestEmail(leaveRequest, requestUser, eventType = 'LEAVE_CREATED') {
  if (!(await emailEventEnabled(prisma, eventType))) { logger.info('Leave reviewer email skipped by governed event policy', { leaveRequestId: leaveRequest?.id, eventType }); return; }
  if (env.emailNotificationsEnabled !== true) {
    logger.info('Email notification broadcast skipped (system disabled)', { leaveRequestId: leaveRequest.id });
    return;
  }

  // 1. Create/reuse SMTP transporter once with explicit delivery timeouts
  if (env.otpDeliveryProvider !== 'gmail_smtp' || !env.smtpHost) {
    logger.warn('Email notification broadcast skipped (SMTP transporter unavailable or not configured)', { leaveRequestId: leaveRequest.id });
    return;
  }

  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: { user: env.smtpUsername, pass: env.smtpPassword },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000
  });

  // 2. Resolve actorUser
  let actorName = 'ระบบ';
  if (requestUser && requestUser.sub) {
    try {
      const actor = await prisma.user.findUnique({
        where: { id: requestUser.sub },
        select: { displayName: true }
      });
      if (actor) {
        actorName = actor.displayName;
      }
    } catch (err) {
      logger.error('Failed to query actor user details for leave request broadcast', { error: err.message, userId: requestUser.sub });
    }
  }

  // 3. Resolve employee details
  let employeeName = leaveRequest.employeeNameSnapshot || 'พนักงาน';
  let employeeDept = leaveRequest.departmentSnapshot || '-';
  let employeeUserId = null;
  try {
    const emp = await prisma.employee.findUnique({
      where: { id: leaveRequest.employeeId },
      select: { firstName: true, lastName: true, displayName: true, department: true, user: { select: { id: true } } }
    });
    if (emp) {
      employeeName = emp.displayName || `${emp.firstName} ${emp.lastName}`;
      employeeDept = emp.department || '-';
      employeeUserId = emp.user?.id || null;
    }
  } catch (err) {
    logger.error('Failed to query employee details for leave request broadcast', { error: err.message, employeeId: leaveRequest.employeeId });
  }

  // 4. Resolve active ADMIN and MANAGER recipients
  let reviewers = [];
  try {
    reviewers = await prisma.user.findMany({
      where: {
        role: { in: ['ADMIN', 'MANAGER'] },
        isActive: true,
        accountStatus: 'ACTIVE',
        email: { not: '' }
      },
      select: {
        id: true,
        role: true,
        email: true,
        displayName: true
      }
    });
  } catch (err) {
    logger.error('Failed to query reviewer recipients for leave request broadcast', { error: err.message });
    return;
  }

  // 5. Normalize, validate and deduplicate email addresses
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const eligibleReviewers = [];
  const seenUserIds = new Set();

  for (const reviewer of reviewers) {
    if (!reviewer.email || seenUserIds.has(reviewer.id)) continue;
    const trimmed = reviewer.email.trim();
    if (!trimmed) continue;
    const normalized = trimmed.toLowerCase();
    if (!emailRegex.test(normalized)) {
      logger.warn('Skipping invalid reviewer email address', { reviewerUserId: reviewer.id });
      continue;
    }
    seenUserIds.add(reviewer.id);
    eligibleReviewers.push({
      id: reviewer.id,
      role: reviewer.role,
      email: normalized,
      displayName: reviewer.displayName
    });
  }

  if (!eligibleReviewers.length) {
    logger.info('No eligible leave reviewers found for leave request notification', { leaveRequestId: leaveRequest.id });
    return;
  }

  // 6. Create reservations outside of leave transaction (using individual inserts to capture duplicates per user safely)
  const reservationsToSend = [];
  for (const reviewer of eligibleReviewers) {
    const roleKey = reviewer.role === 'MANAGER' ? 'manager' : 'admin';
    const eventKey = 'leave:' + leaveRequest.id + ':' + eventType + ':' + roleKey + ':' + reviewer.id;
    try {
      const reservation = await prisma.emailDeliveryReservation.create({
        data: {
          eventKey,
          status: 'RESERVED'
        }
      });
      reservationsToSend.push({ reviewer, reservation });
    } catch (err) {
      if (err.code === 'P2002') {
        logger.info('Email delivery reservation already exists (ignoring duplicate)', { eventKey, reviewerUserId: reviewer.id });
      } else {
        logger.error('Failed to create email delivery reservation', { error: err.message, eventKey, reviewerUserId: reviewer.id });
      }
    }
  }

  // 7. Send emails sequentially (concurrency limit = 1, ensuring all settle before returning)
  for (const item of reservationsToSend) {
    const { reviewer, reservation } = item;
    try {
      // Increment attempt count on database first
      await prisma.emailDeliveryReservation.update({
        where: { id: reservation.id },
        data: { attemptCount: { increment: 1 } }
      });

      const escapedEmployeeName = escapeHtml(employeeName);
const subject = eventType === 'LEAVE_RESUBMITTED'
        ? `SMS v3: มีคำขอลาส่งตรวจสอบอีกครั้ง (${escapedEmployeeName})`
        : `SMS v3: มีคำขอลาใหม่รออนุมัติ (${escapedEmployeeName})`;

      const appUrl = getPublicAppUrl(env);
      let isValidHttpsUrl = false;
      if (appUrl) {
        try {
          const parsedUrl = new URL(appUrl);
          if (parsedUrl.protocol === 'https:') {
            isValidHttpsUrl = true;
          }
        } catch (err) {
          // ignore
        }
      }
      if (appUrl && !isValidHttpsUrl) {
        logger.warn('Public app URL is not a valid HTTPS URL; link omitted', { leaveRequestId: leaveRequest.id });
      }
      const linkHtml = (appUrl && isValidHttpsUrl) ? `<p>ท่านสามารถเข้าสู่ระบบเพื่อตรวจสอบและอนุมัติใบลาได้ที่: <a href="${appUrl}/operations/leaves">${appUrl}/operations/leaves</a></p>` : '';

      const escapedLeaveType = escapeHtml(leaveTypeDisplayName(leaveRequest.leaveType, leaveRequest.leaveTypeNameSnapshot));
      const escapedReason = escapeHtml(leaveRequest.reason || '-');
      const escapedManagerName = escapeHtml(reviewer.displayName || (reviewer.role === 'ADMIN' ? 'ผู้ดูแลระบบ' : 'ผู้จัดการ'));
      const escapedEmployeeDept = escapeHtml(employeeDept);

      const startText = leaveRequest.startDate ? new Date(leaveRequest.startDate).toISOString().slice(0, 10) : '';
      const endText = leaveRequest.endDate ? new Date(leaveRequest.endDate).toISOString().slice(0, 10) : '';
      const escapedStartText = escapeHtml(startText);
      const escapedEndText = escapeHtml(endText);
      const escapedDayCount = escapeHtml(String(leaveRequest.dayCount || ''));

      const escapedActorName = escapeHtml(actorName);
      const onBehalfText = leaveRequest.createdByUserId !== employeeUserId ? `<p>บันทึกแทนโดย: ${escapedActorName}</p>` : '';

      const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: #d97706; margin-top: 0;">📝 มีคำขอลาใหม่รออนุมัติ</h2>
          <p>เรียน คุณ ${escapedManagerName},</p>
          <p>มีคำขอลาพักงานใหม่ยื่นเข้าสู่ระบบรออนุมัติ:</p>
          <table style="border-collapse: collapse; margin: 15px 0; width: 100%; background: #f8fafc; border-radius: 8px;">
            <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0; width: 140px;">พนักงาน:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${escapedEmployeeName} (${escapedEmployeeDept})</td></tr>
            <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">ประเภทการลา:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${escapedLeaveType}</td></tr>
            <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">ช่วงวันที่:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${escapedStartText} ถึง ${escapedEndText} (${escapedDayCount} วัน)</td></tr>
            <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">สถานะ:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #d97706;">PENDING</td></tr>
            <tr><td style="padding: 10px; font-weight: bold;">เหตุผล:</td><td style="padding: 10px;">${escapedReason}</td></tr>
          </table>
          ${onBehalfText}
          ${linkHtml}
          <p style="color: #64748b; font-size: 13px; margin-bottom: 0;">ระบบ Security Management System v3</p>
        </div>
      `;

      await transporter.sendMail({
        from: env.otpFromEmail || env.smtpUsername,
        to: reviewer.email,
        subject,
        text: html.replace(/<[^>]+>/g, ''),
        html
      });

      await prisma.emailDeliveryReservation.update({
        where: { id: reservation.id },
        data: {
          status: 'SENT',
          sentAt: new Date()
        }
      });
      logger.info('Broadcast email sent to reviewer successfully', { eventKey: reservation.eventKey, reviewerUserId: reviewer.id });
    } catch (sendErr) {
      const { category, safeMessage } = mapSmtpError(sendErr);
      logger.error('Failed to send broadcast email to reviewer', { errorCategory: category, eventKey: reservation.eventKey, reviewerUserId: reviewer.id });
      try {
        await prisma.emailDeliveryReservation.update({
          where: { id: reservation.id },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
            lastErrorCategory: category,
            lastErrorSafe: safeMessage
          }
        });
      } catch (dbErr) {
        logger.error('Failed to update email reservation to FAILED status', { error: dbErr.message, eventKey: reservation.eventKey, reviewerUserId: reviewer.id });
      }
    }
  }
}

async function notifyEmployeeLeaveStatusChange(leaveRequest, eventType, actorUser, extraData) {
  if (!(await emailEventEnabled(prisma, eventType))) { logger.info('Employee leave email skipped by governed event policy', { leaveRequestId: leaveRequest?.id, eventType }); return; }
  const validEvents = ['LEAVE_CREATED', 'LEAVE_RESUBMITTED', 'LEAVE_RETURNED_FOR_CORRECTION', 'LEAVE_APPROVED', 'LEAVE_REJECTED', 'LEAVE_CANCELLED'];
  if (!validEvents.includes(eventType)) {
    logger.info('notifyEmployeeLeaveStatusChange skipped: unsupported event type', { eventType });
    return;
  }

  if (env.emailNotificationsEnabled !== true) {
    logger.info('Employee email status notification skipped (system disabled)', { leaveRequestId: leaveRequest.id, eventType });
    return;
  }

  if (env.otpDeliveryProvider !== 'gmail_smtp' || !env.smtpHost) {
    logger.warn('Employee email status notification skipped (SMTP transporter unavailable or not configured)', { leaveRequestId: leaveRequest.id, eventType });
    return;
  }

  let ownerUser = null;
  try {
    ownerUser = await prisma.user.findUnique({
      where: { employeeId: leaveRequest.employeeId },
      select: { id: true, email: true, isActive: true, accountStatus: true, displayName: true }
    });
  } catch (err) {
    logger.error('Failed to query owner user for status change notification', { error: err.message, employeeId: leaveRequest.employeeId });
  }

  if (!ownerUser) {
    logger.info('Employee email status notification skipped (no linked user)', { leaveRequestId: leaveRequest.id, eventType });
    return;
  }

  if (ownerUser.isActive !== true || ownerUser.accountStatus !== 'ACTIVE') {
    logger.info('Employee email status notification skipped (user inactive or suspended)', { leaveRequestId: leaveRequest.id, employeeUserId: ownerUser.id });
    return;
  }

  const rawEmail = (ownerUser.email || '').trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!rawEmail || !emailRegex.test(rawEmail)) {
    logger.warn('Employee email status notification skipped (missing or invalid email)', { leaveRequestId: leaveRequest.id, employeeUserId: ownerUser.id });
    return;
  }

  const eventKey = `leave:${leaveRequest.id}:${eventType}:employee:${ownerUser.id}`;

  let reservation;
  try {
    reservation = await prisma.emailDeliveryReservation.create({
      data: {
        eventKey,
        status: 'RESERVED',
        attemptCount: 1
      }
    });
  } catch (err) {
    if (err.code === 'P2002') {
      logger.info('Employee leave status email already processed (duplicate reservation ignored)', { eventKey });
      return;
    }
    logger.error('Failed to create email delivery reservation for employee status change', { error: err.message, eventKey });
    return;
  }

  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: { user: env.smtpUsername, pass: env.smtpPassword },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000
  });

  let employeeName = leaveRequest.employeeNameSnapshot || 'พนักงาน';
  let employeeDept = leaveRequest.departmentSnapshot || '-';
  try {
    const emp = await prisma.employee.findUnique({
      where: { id: leaveRequest.employeeId },
      select: { firstName: true, lastName: true, displayName: true, department: true }
    });
    if (emp) {
      employeeName = emp.displayName || `${emp.firstName} ${emp.lastName}`;
      employeeDept = emp.department || '-';
    }
  } catch (err) {
    logger.error('Failed to query employee details for status change notification', { error: err.message, employeeId: leaveRequest.employeeId });
  }

  let actorName = 'ระบบ';
  if (actorUser && actorUser.sub) {
    try {
      const actor = await prisma.user.findUnique({
        where: { id: actorUser.sub },
        select: { displayName: true }
      });
      if (actor) {
        actorName = actor.displayName || 'ผู้จัดการ';
      }
    } catch (err) {
      logger.error('Failed to query actor user details for employee status change', { error: err.message, userId: actorUser.sub });
    }
  } else if (leaveRequest.createdByUserId) {
    try {
      const creator = await prisma.user.findUnique({
        where: { id: leaveRequest.createdByUserId },
        select: { displayName: true }
      });
      if (creator) {
        actorName = creator.displayName || 'ผู้จัดการ';
      }
    } catch (err) {
      logger.error('Failed to query creator user details for employee status change', { error: err.message, userId: leaveRequest.createdByUserId });
    }
  }

  const startText = leaveRequest.startDate ? new Date(leaveRequest.startDate).toISOString().slice(0, 10) : '';
  const endText = leaveRequest.endDate ? new Date(leaveRequest.endDate).toISOString().slice(0, 10) : '';

  const escapedEmployeeName = escapeHtml(employeeName);
  const escapedEmployeeDept = escapeHtml(employeeDept);
  const escapedLeaveType = escapeHtml(leaveTypeDisplayName(leaveRequest.leaveType, leaveRequest.leaveTypeNameSnapshot));
  const escapedReason = escapeHtml(leaveRequest.reason || '-');
  const escapedActorName = escapeHtml(actorName);
  const escapedStartText = escapeHtml(startText);
  const escapedEndText = escapeHtml(endText);
  const escapedDayCount = escapeHtml(String(leaveRequest.dayCount || ''));

  const extraReason = extraData?.reason || extraData?.rejectionReason || extraData?.cancellationReason || '';
  const escapedExtraReason = escapeHtml(extraReason);

  const appUrl = getPublicAppUrl(env);
  let isValidHttpsUrl = false;
  if (appUrl) {
    try {
      const parsedUrl = new URL(appUrl);
      if (parsedUrl.protocol === 'https:') {
        isValidHttpsUrl = true;
      }
    } catch (err) {
      // ignore
    }
  }
  if (appUrl && !isValidHttpsUrl) {
    logger.warn('Public app URL is not a valid HTTPS URL; link omitted', { leaveRequestId: leaveRequest.id });
  }
  const linkHtml = (appUrl && isValidHttpsUrl) ? `<p>ท่านสามารถเข้าสู่ระบบเพื่อตรวจสอบได้ที่: <a href="${appUrl}">${appUrl}</a></p>` : '';

  let subject = '';
  let html = '';

  if (eventType === 'LEAVE_CREATED') {
    subject = 'SMS v3: บันทึกคำขอลาเรียบร้อยแล้ว — รออนุมัติ';
    html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: #0f766e; margin-top: 0;">📝 ยื่นคำขอลาเรียบร้อยแล้ว</h2>
        <p>เรียน คุณ ${escapedEmployeeName},</p>
        <p>ระบบได้บันทึกคำขอลาพักงานของท่านเรียบร้อยแล้ว โดยอยู่ระหว่างรอการอนุมัติ:</p>
        <table style="border-collapse: collapse; margin: 15px 0; width: 100%; background: #f8fafc; border-radius: 8px;">
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0; width: 140px;">ผู้ขอลา:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${escapedEmployeeName} (${escapedEmployeeDept})</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">ประเภทการลา:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${escapedLeaveType}</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">ช่วงวันที่:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${escapedStartText} ถึง ${escapedEndText} (${escapedDayCount} วัน)</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">สถานะ:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #d97706;">PENDING — รออนุมัติ</td></tr>
          <tr><td style="padding: 10px; font-weight: bold;">เหตุผล:</td><td style="padding: 10px;">${escapedReason}</td></tr>
        </table>
        ${(leaveRequest.createdByUserId && leaveRequest.createdByUserId !== ownerUser.id) ? `<p>บันทึกแทนโดย: ${escapedActorName}</p>` : ''}
        ${linkHtml}
        <p style="color: #64748b; font-size: 13px; margin-bottom: 0;">ระบบ Security Management System v3</p>
      </div>
    `;
  } else if (eventType === 'LEAVE_RESUBMITTED') {
    subject = 'SMS v3: ส่งคำขอลาตรวจสอบอีกครั้งแล้ว';
    html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: #2563eb; margin-top: 0;">ส่งคำขอลาตรวจสอบอีกครั้งแล้ว</h2>
        <p>เรียน คุณ ${escapedEmployeeName},</p>
        <p>คำขอลาของท่านถูกแก้ไขและส่งเข้าคิวตรวจสอบอีกครั้งเรียบร้อยแล้ว</p>
        <p><strong>สถานะ:</strong> PENDING · รอตรวจสอบ</p>
        ${linkHtml}
        <p style="color: #64748b; font-size: 13px; margin-bottom: 0;">ระบบ Security Management System v3</p>
      </div>
    `;
  } else if (eventType === 'LEAVE_RETURNED_FOR_CORRECTION') {
    subject = 'SMS v3: คำขอลาถูกส่งกลับไปแก้ไข';
    html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: #d97706; margin-top: 0;">คำขอลาถูกส่งกลับไปแก้ไข</h2>
        <p>เรียน คุณ ${escapedEmployeeName},</p>
        <p>ผู้ตรวจสอบส่งคำขอลาของท่านกลับเพื่อแก้ไขข้อมูลก่อนส่งตรวจสอบอีกครั้ง</p>
        <p><strong>ดำเนินการโดย:</strong> ${escapedActorName}</p>
        <p><strong>เหตุผล:</strong> ${escapedExtraReason || '-'}</p>
        <p><strong>สถานะ:</strong> RETURNED_FOR_CORRECTION</p>
        ${linkHtml}
        <p style="color: #64748b; font-size: 13px; margin-bottom: 0;">ระบบ Security Management System v3</p>
      </div>
    `;  } else if (eventType === 'LEAVE_APPROVED') {
    subject = 'SMS v3: ใบลาได้รับการอนุมัติแล้ว';
    html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: #15803d; margin-top: 0;">✅ ใบลาได้รับการอนุมัติแล้ว</h2>
        <p>เรียน คุณ ${escapedEmployeeName},</p>
        <p>คำขอลาพักงานของท่านได้รับการอนุมัติเรียบร้อยแล้ว:</p>
        <table style="border-collapse: collapse; margin: 15px 0; width: 100%; background: #f8fafc; border-radius: 8px;">
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0; width: 140px;">ประเภทการลา:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${escapedLeaveType}</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">ช่วงวันที่:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${escapedStartText} ถึง ${escapedEndText} (${escapedDayCount} วัน)</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">สถานะ:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #15803d;">APPROVED — อนุมัติแล้ว</td></tr>
          <tr><td style="padding: 10px; font-weight: bold;">ผู้อนุมัติ:</td><td style="padding: 10px;">${escapedActorName}</td></tr>
        </table>
        ${linkHtml}
        <p style="color: #64748b; font-size: 13px; margin-bottom: 0;">ระบบ Security Management System v3</p>
      </div>
    `;
  } else if (eventType === 'LEAVE_REJECTED') {
    subject = 'SMS v3: ใบลาไม่ได้รับการอนุมัติ';
    html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: #b91c1c; margin-top: 0;">❌ ใบลาไม่ได้รับการอนุมัติ</h2>
        <p>เรียน คุณ ${escapedEmployeeName},</p>
        <p>คำขอลาพักงานของท่านไม่ได้รับการอนุมัติ:</p>
        <table style="border-collapse: collapse; margin: 15px 0; width: 100%; background: #f8fafc; border-radius: 8px;">
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0; width: 140px;">ประเภทการลา:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${escapedLeaveType}</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">ช่วงวันที่:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${escapedStartText} ถึง ${escapedEndText} (${escapedDayCount} วัน)</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">สถานะ:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #b91c1c;">REJECTED — ไม่อนุมัติ</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">ผู้ดำเนินการ:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${escapedActorName}</td></tr>
          <tr><td style="padding: 10px; font-weight: bold;">เหตุผลการปฏิเสธ:</td><td style="padding: 10px;">${escapedExtraReason || '-'}</td></tr>
        </table>
        ${linkHtml}
        <p style="color: #64748b; font-size: 13px; margin-bottom: 0;">ระบบ Security Management System v3</p>
      </div>
    `;
  } else if (eventType === 'LEAVE_CANCELLED') {
    subject = 'SMS v3: ใบลาถูกยกเลิกแล้ว';
    html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: #475569; margin-top: 0;">🚫 ใบลาถูกยกเลิกแล้ว</h2>
        <p>เรียน คุณ ${escapedEmployeeName},</p>
        <p>คำขอลาพักงานของท่านที่เคยได้รับอนุมัติ ได้ถูกยกเลิกแล้ว:</p>
        <table style="border-collapse: collapse; margin: 15px 0; width: 100%; background: #f8fafc; border-radius: 8px;">
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0; width: 140px;">ประเภทการลา:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${escapedLeaveType}</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">ช่วงวันที่:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${escapedStartText} ถึง ${escapedEndText} (${escapedDayCount} วัน)</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">สถานะ:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #475569;">CANCELLED — ยกเลิกแล้ว</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">ผู้ดำเนินการ:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${escapedActorName}</td></tr>
          <tr><td style="padding: 10px; font-weight: bold;">เหตุผลการยกเลิก:</td><td style="padding: 10px;">${escapedExtraReason || '-'}</td></tr>
        </table>
        ${linkHtml}
        <p style="color: #64748b; font-size: 13px; margin-bottom: 0;">ระบบ Security Management System v3</p>
      </div>
    `;
  }

  try {
    await prisma.emailDeliveryReservation.update({
      where: { id: reservation.id },
      data: { attemptCount: { increment: 1 } }
    });

    await transporter.sendMail({
      from: env.otpFromEmail || env.smtpUsername,
      to: ownerUser.email,
      subject,
      text: html.replace(/<[^>]+>/g, ''),
      html
    });

    await prisma.emailDeliveryReservation.update({
      where: { id: reservation.id },
      data: {
        status: 'SENT',
        sentAt: new Date()
      }
    });
    logger.info('Employee status email sent successfully', { eventKey, employeeUserId: ownerUser.id });
  } catch (sendErr) {
    const { category, safeMessage } = mapSmtpError(sendErr);
    logger.error('Failed to send status email to employee', { errorCategory: category, eventKey, employeeUserId: ownerUser.id });
    try {
      await prisma.emailDeliveryReservation.update({
        where: { id: reservation.id },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          lastErrorCategory: category,
          lastErrorSafe: safeMessage
        }
      });
    } catch (dbErr) {
      logger.error('Failed to update email reservation to FAILED status for employee', { error: dbErr.message, eventKey, employeeUserId: ownerUser.id });
    }
  }
}

module.exports = {
  notifyScheduleApproved,
  notifyNewRegistration,
  notifyRegistrationDecision,
  notifyLeaveSubmitted,
  notifyLeaveProcessed,
  broadcastLeaveRequestEmail,
  notifyEmployeeLeaveStatusChange,
  sendNotification,
  createTransporter
};
