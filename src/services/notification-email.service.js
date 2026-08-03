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
  const eventKey = options.eventKey ? String(options.eventKey) : null;
  const eventPrisma = options.prismaClient || prisma;
  if (configuration.emailNotificationsEnabled !== true) {
    log.info('Email notification skipped (system disabled)', { subject });
    return;
  }
  const recipients = Array.isArray(to) ? [...new Set(to.map((e) => String(e).trim().toLowerCase()).filter(Boolean))] : [String(to).trim().toLowerCase()];
  if (!recipients.length) return;

  if (eventKey && eventPrisma?.auditLog?.findFirst) {
    const delivered = await eventPrisma.auditLog.findFirst({ where: { entityType: 'NotificationEmail', entityId: eventKey }, select: { id: true } }).catch(() => null);
    if (delivered) {
      log.info('Email notification skipped (duplicate event)', { eventKey });
      return;
    }
  }

  const transporter = createConfiguredTransporter(configuration);
  if (!transporter) {
    log.info('Email notification skipped (SMTP disabled or not configured)', { subject, recipientCount: recipients.length });
    return;
  }

  try {
    const outboundSubject = subject.startsWith('[STAGING]') ? subject : `[STAGING] ${subject}`;
    await transporter.sendMail({
      from: configuration.otpFromEmail || configuration.smtpUsername,
      to: recipients.join(', '),
      subject: outboundSubject,
      text: text || html.replace(/<[^>]+>/g, ''),
      html
    });
    if (eventKey && eventPrisma?.auditLog?.create) {
      await eventPrisma.auditLog.create({ data: { action: 'CREATE', entityType: 'NotificationEmail', entityId: eventKey, metadata: { recipientCount: recipients.length, subject: outboundSubject } } }).catch((error) => {
        log.error('Notification idempotency record failed', { errorCategory: errorCategory(error) });
      });
    }
    log.info('Notification email sent successfully', { subject: outboundSubject, recipientCount: recipients.length });
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
    const managers = await prisma.user.findMany({ where: { role: 'MANAGER', department: department || '__NO_DEPARTMENT__', isActive: true, accountStatus: 'ACTIVE', email: { not: '' } }, select: { email: true } });
    const managerEmails = [...new Set(managers.map((user) => user.email.trim().toLowerCase()).filter(Boolean))];
    if (!managerEmails.length) {
      logger.warn('notification_missing_manager', { event: 'REGISTRATION_PENDING', department: department || null });
      return;
    }

    const subject = `SMS v3: มีคำขอลงทะเบียนเข้าใช้งานระบบใหม่ (${displayName})`;
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: #2563eb; margin-top: 0;">👤 มีคำขอลงทะเบียนผู้ใช้งานใหม่</h2>
        <p>เรียน ผู้จัดการที่รับผิดชอบ,</p>
        <p>มีผู้ใช้งานใหม่ยืนยันตัวตนทางอีเมลเรียบร้อยแล้ว และรอการพิจารณากำหนดสิทธิ์เข้าใช้งาน:</p>
        <table style="border-collapse: collapse; margin: 15px 0; width: 100%; background: #f8fafc; border-radius: 8px;">
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0; width: 140px;">ชื่อ-นามสกุล:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${displayName}</td></tr>
          <tr><td style="padding: 10px; font-weight: bold;">แผนก:</td><td style="padding: 10px;">${department || '-'}</td></tr>
        </table>
        <p>กรุณาเข้าสู่ระบบเพื่ออนุมัติบัญชีผู้ใช้ในหน้า <strong>จัดการผู้ใช้งาน (User Management)</strong></p>
        <p style="color: #64748b; font-size: 13px; margin-bottom: 0;">ระบบ Security Management System v3</p>
      </div>
    `;
    await sendNotification({ to: managerEmails, subject, html }, { eventKey: `registration:${displayName}:${department || 'none'}:pending` });
  } catch (err) {
    logger.error('notifyNewRegistration failed', { error: err.message });
  }
}

/**
 * 3. Leave request submitted -> Notify Admin & Manager group
 */
async function notifyLeaveSubmitted({ leaveId, employeeName, leaveType, startDate, endDate, dayCount, reason, substitute, department }) {
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
    await sendNotification({ to: adminManagerEmails, subject, html }, { eventKey: leaveId ? `leave:${leaveId}:SUBMITTED` : undefined });
  } catch (err) {
    logger.error('notifyLeaveSubmitted failed', { error: err.message });
  }
}

/**
 * 4. Leave request approved/rejected -> Notify Requesting Employee AND Admin & Manager group
 */
async function notifyLeaveProcessed({ leave, status, approverName, reason }) {
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
    const isCancelled = status === 'CANCELLED';
    const isReturned = status === 'RETURNED_FOR_CORRECTION';
    const statusText = isApproved ? 'อนุมัติแล้ว ✅' : isCancelled ? 'ยกเลิกแล้ว' : isReturned ? 'ส่งกลับแก้ไข' : 'ไม่อนุมัติ ❌';
    const statusColor = isApproved ? '#059669' : isCancelled ? '#d97706' : isReturned ? '#2563eb' : '#dc2626';

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
        ${reason ? `<p>เหตุผล: ${reason}</p>` : ''}
        <p style="color: #64748b; font-size: 13px; margin-bottom: 0;">ระบบ Security Management System v3</p>
      </div>
    `;
    await sendNotification({ to: recipients, subject, html }, { eventKey: leave?.id ? `leave:${leave.id}:${status}` : undefined });
  } catch (err) {
    logger.error('notifyLeaveProcessed failed', { error: err.message });
  }
}

async function notifyLeaveReturned({ leave, reason, approverName }) {
  return notifyLeaveProcessed({ leave, status: 'RETURNED_FOR_CORRECTION', reason, approverName });
}

module.exports = {
  notifyScheduleApproved,
  notifyNewRegistration,
  notifyLeaveSubmitted,
  notifyLeaveProcessed,
  notifyLeaveReturned,
  sendNotification,
  createTransporter
};
