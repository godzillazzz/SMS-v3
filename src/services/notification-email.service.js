const nodemailer = require('nodemailer');
const prisma = require('../config/prisma');
const env = require('../config/env');
const { logger, errorCategory } = require('../utils/logger');

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
  const recipients = Array.isArray(to) ? [...new Set(to.map((e) => String(e).trim().toLowerCase()).filter(Boolean))] : [String(to).trim().toLowerCase()];
  if (!recipients.length) return;

  const transporter = createConfiguredTransporter(configuration);
  if (!transporter) {
    log.info('Email notification skipped (SMTP disabled or not configured)', { subject, recipientCount: recipients.length });
    return;
  }

  try {
    await transporter.sendMail({
      from: configuration.otpFromEmail || configuration.smtpUsername,
      to: recipients.join(', '),
      subject,
      text: text || html.replace(/<[^>]+>/g, ''),
      html
    });
    log.info('Notification email sent successfully', { subject, recipientCount: recipients.length });
  } catch (error) {
    log.error('Failed to send notification email', { errorCategory: errorCategory(error), subject, recipientCount: recipients.length });
  }
}

async function getAllEmployeeAndUserEmails() {
  try {
    const [users, employees] = await Promise.all([
      prisma.user.findMany({
        where: { isActive: true, accountStatus: 'ACTIVE', email: { not: '' } },
        select: { email: true }
      }),
      prisma.employee.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          email: { not: null }
        },
        select: { email: true }
      })
    ]);
    const userEmails = users.map((u) => u.email.trim().toLowerCase());
    const empEmails = employees.map((e) => (e.email || '').trim().toLowerCase());
    return [...new Set([...userEmails, ...empEmails].filter(Boolean))];
  } catch (err) {
    logger.error('Failed to query all employee and user emails', { error: err.message });
    return [];
  }
}

/**
 * 1. Admin approves monthly schedule -> Notify ALL employees & users
 */
async function notifyScheduleApproved({ month, approvedBy, revision }) {
  try {
    const allRecipientEmails = await getAllEmployeeAndUserEmails();
    if (!allRecipientEmails.length) return;

    const [yearStr, monthStr] = month.split('-');
    const thaiMonth = new Intl.DateTimeFormat('th-TH', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1)));
    const thaiYear = Number(yearStr) + 543;
    const monthText = `${thaiMonth} ${thaiYear}`;

    const subject = `SMS v3: แจ้งเตือนอนุมัติตารางกะประจำเดือน ${monthText}`;
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: #059669; margin-top: 0;">✓ อนุมัติตารางกะประจำเดือนเรียบร้อยแล้ว</h2>
        <p>เรียน พนักงานและทีมผู้บริหารทุกท่าน (All Employees & Management Team),</p>
        <p>ตารางกะการทำงานประจำเดือน <strong>${monthText}</strong> ได้รับการตรวจสอบและอนุมัติอย่างเป็นทางการเรียบร้อยแล้ว</p>
        <table style="border-collapse: collapse; margin: 15px 0; width: 100%; background: #f8fafc; border-radius: 8px;">
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0; width: 140px;">ประจำเดือน:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${monthText} (${month})</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">ผู้อนุมัติ:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${approvedBy || 'Admin'}</td></tr>
          <tr><td style="padding: 10px; font-weight: bold;">สถานะตาราง:</td><td style="padding: 10px; color: #059669; font-weight: bold;">Approved (Revision ${revision || 1})</td></tr>
        </table>
        <p>ท่านสามารถเข้าสู่ระบบเพื่อตรวจสอบปฏิทินตารางกะการทำงานของตนเองได้ที่หน้า <strong>Schedule Calendar</strong></p>
        <p style="color: #64748b; font-size: 13px; margin-bottom: 0;">ระบบ Security Management System v3</p>
      </div>
    `;
    await sendNotification({ to: allRecipientEmails, subject, html });
  } catch (err) {
    logger.error('notifyScheduleApproved failed', { error: err.message });
  }
}

/**
 * 2. New user registration verified -> Notify Admin & Manager group
 */
async function notifyNewRegistration({ displayName, email, department }) {
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

/**
 * 3. Leave request submitted -> Notify Admin & Manager group
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
 * 4. Leave request approved/rejected -> Notify Requesting Employee AND Admin & Manager group
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

    const subject = `SMS v3: ผลการอนุมัติคำขอลา (${leave.employeeNameSnapshot} - ${leave.leaveType}: ${isApproved ? 'อนุมัติ' : 'ไม่อนุมัติ'})`;
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: ${statusColor}; margin-top: 0;">ผลการอนุมัติคำขอลา: ${statusText}</h2>
        <p>เรียน ${leave.employeeNameSnapshot} และ ทีมบริหาร,</p>
        <p>คำขอลาได้รับการพิจารณาเรียบร้อยแล้ว:</p>
        <table style="border-collapse: collapse; margin: 15px 0; width: 100%; background: #f8fafc; border-radius: 8px;">
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0; width: 140px;">พนักงาน:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${leave.employeeNameSnapshot} (${leave.departmentSnapshot || '-'})</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">ประเภทการลา:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${leave.leaveType}</td></tr>
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

async function broadcastLeaveRequestEmail(leaveRequest, requestUser) {
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

  // 4. Resolve active MANAGER recipients
  let managers = [];
  try {
    managers = await prisma.user.findMany({
      where: {
        role: 'MANAGER',
        isActive: true,
        accountStatus: 'ACTIVE',
        email: { not: '' }
      },
      select: {
        id: true,
        email: true,
        displayName: true
      }
    });
  } catch (err) {
    logger.error('Failed to query manager recipients for leave request broadcast', { error: err.message });
    return;
  }

  // 5. Normalize, validate and deduplicate email addresses
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const eligibleManagers = [];
  const seenUserIds = new Set();

  for (const mgr of managers) {
    if (!mgr.email || seenUserIds.has(mgr.id)) continue;
    const trimmed = mgr.email.trim();
    if (!trimmed) continue;
    const normalized = trimmed.toLowerCase();
    if (!emailRegex.test(normalized)) {
      logger.warn('Skipping invalid manager email address', { managerUserId: mgr.id });
      continue;
    }
    seenUserIds.add(mgr.id);
    eligibleManagers.push({
      id: mgr.id,
      email: normalized,
      displayName: mgr.displayName
    });
  }

  if (!eligibleManagers.length) {
    logger.info('No eligible managers found for leave request notification', { leaveRequestId: leaveRequest.id });
    return;
  }

  // 6. Create reservations outside of leave transaction (using individual inserts to capture duplicates per user safely)
  const reservationsToSend = [];
  for (const mgr of eligibleManagers) {
    const eventKey = `leave:${leaveRequest.id}:LEAVE_CREATED:manager:${mgr.id}`;
    try {
      const reservation = await prisma.emailDeliveryReservation.create({
        data: {
          eventKey,
          status: 'RESERVED'
        }
      });
      reservationsToSend.push({ manager: mgr, reservation });
    } catch (err) {
      if (err.code === 'P2002') {
        logger.info('Email delivery reservation already exists (ignoring duplicate)', { eventKey, managerUserId: mgr.id });
      } else {
        logger.error('Failed to create email delivery reservation', { error: err.message, eventKey, managerUserId: mgr.id });
      }
    }
  }

  // 7. Send emails sequentially (concurrency limit = 1, ensuring all settle before returning)
  for (const item of reservationsToSend) {
    const { manager, reservation } = item;
    try {
      // Increment attempt count on database first
      await prisma.emailDeliveryReservation.update({
        where: { id: reservation.id },
        data: { attemptCount: { increment: 1 } }
      });

      const escapedEmployeeName = escapeHtml(employeeName);
      const subject = `SMS v3: มีคำขอลาใหม่รออนุมัติ (${escapedEmployeeName})`;

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

      const escapedLeaveType = escapeHtml(leaveRequest.leaveType);
      const escapedReason = escapeHtml(leaveRequest.reason || '-');
      const escapedManagerName = escapeHtml(manager.displayName || 'ผู้จัดการ');
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
        to: manager.email,
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
      logger.info('Broadcast email sent to manager successfully', { eventKey: reservation.eventKey, managerUserId: manager.id });
    } catch (sendErr) {
      const { category, safeMessage } = mapSmtpError(sendErr);
      logger.error('Failed to send broadcast email to manager', { errorCategory: category, eventKey: reservation.eventKey, managerUserId: manager.id });
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
        logger.error('Failed to update email reservation to FAILED status', { error: dbErr.message, eventKey: reservation.eventKey, managerUserId: manager.id });
      }
    }
  }
}

async function notifyEmployeeLeaveStatusChange(leaveRequest, eventType, actorUser, extraData) {
  const validEvents = ['LEAVE_CREATED', 'LEAVE_APPROVED', 'LEAVE_REJECTED', 'LEAVE_CANCELLED'];
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
  const escapedLeaveType = escapeHtml(leaveRequest.leaveType);
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
  } else if (eventType === 'LEAVE_APPROVED') {
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
  notifyLeaveSubmitted,
  notifyLeaveProcessed,
  broadcastLeaveRequestEmail,
  notifyEmployeeLeaveStatusChange,
  sendNotification,
  createTransporter
};
