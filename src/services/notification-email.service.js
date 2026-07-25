const nodemailer = require('nodemailer');
const prisma = require('../config/prisma');
const env = require('../config/env');
const logger = require('../utils/logger');

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

async function sendNotification({ to, subject, html, text }) {
  const recipients = Array.isArray(to) ? [...new Set(to.map((e) => String(e).trim().toLowerCase()).filter(Boolean))] : [String(to).trim().toLowerCase()];
  if (!recipients.length) return;

  const transporter = createTransporter();
  if (!transporter) {
    logger.info('Email notification skipped (SMTP disabled or not configured)', { subject, recipientCount: recipients.length });
    return;
  }

  try {
    await transporter.sendMail({
      from: env.otpFromEmail || env.smtpUsername,
      to: recipients.join(', '),
      subject,
      text: text || html.replace(/<[^>]+>/g, ''),
      html
    });
    logger.info('Notification email sent successfully', { subject, recipientCount: recipients.length });
  } catch (error) {
    logger.error('Failed to send notification email', { error: error.message, subject, recipientCount: recipients.length });
  }
}

/**
 * 1. Admin approves monthly schedule -> Notify Admin & Manager group
 */
async function notifyScheduleApproved({ month, approvedBy, revision }) {
  try {
    const adminManagerEmails = await getAdminAndManagerEmails();
    if (!adminManagerEmails.length) return;

    const [yearStr, monthStr] = month.split('-');
    const thaiMonth = new Intl.DateTimeFormat('th-TH', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1)));
    const thaiYear = Number(yearStr) + 543;
    const monthText = `${thaiMonth} ${thaiYear}`;

    const subject = `SMS v3: อนุมัติตารางกะประจำเดือน ${monthText}`;
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: #059669; margin-top: 0;">✓ อนุมัติตารางกะประจำเดือนเรียบร้อยแล้ว</h2>
        <p>เรียน ผู้ดูแลระบบและหัวหน้างาน (Admins & Managers),</p>
        <p>ตารางกะการทำงานประจำเดือน <strong>${monthText}</strong> ได้รับการอนุมัติอย่างเป็นทางการแล้ว</p>
        <table style="border-collapse: collapse; margin: 15px 0; width: 100%; background: #f8fafc; border-radius: 8px;">
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0; width: 140px;">เดือน:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${monthText} (${month})</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">ผู้อนุมัติ:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${approvedBy || 'Admin'}</td></tr>
          <tr><td style="padding: 10px; font-weight: bold;">Revision:</td><td style="padding: 10px;">Revision ${revision || 1}</td></tr>
        </table>
        <p style="color: #64748b; font-size: 13px; margin-bottom: 0;">ระบบ Security Management System v3</p>
      </div>
    `;
    await sendNotification({ to: adminManagerEmails, subject, html });
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

    const subject = `SMS v3: มีคำขอลงทะเบียนเข้าใช้งานระบบใหม่ (${displayName})`;
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: #2563eb; margin-top: 0;">👤 มีคำขอลงทะเบียนผู้ใช้งานใหม่</h2>
        <p>เรียน ผู้ดูแลระบบ (Admins & Managers),</p>
        <p>มีผู้ใช้งานใหม่ยืนยันตัวตนทางอีเมลเรียบร้อยแล้ว และรอการพิจารณากำหนดสิทธิ์เข้าใช้งาน:</p>
        <table style="border-collapse: collapse; margin: 15px 0; width: 100%; background: #f8fafc; border-radius: 8px;">
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0; width: 140px;">ชื่อ-นามสกุล:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${displayName}</td></tr>
          <tr><td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">อีเมล:</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${email}</td></tr>
          <tr><td style="padding: 10px; font-weight: bold;">แผนก:</td><td style="padding: 10px;">${department || '-'}</td></tr>
        </table>
        <p>กรุณาเข้าสู่ระบบเพื่ออนุมัติบัญชีผู้ใช้ในหน้า <strong>จัดการผู้ใช้งาน (User Management)</strong></p>
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

module.exports = {
  notifyScheduleApproved,
  notifyNewRegistration,
  notifyLeaveSubmitted,
  notifyLeaveProcessed
};
