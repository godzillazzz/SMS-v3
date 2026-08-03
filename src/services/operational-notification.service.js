const prisma = require('../config/prisma');
const { sendNotification } = require('./notification-email.service');
const { logger, errorCategory } = require('../utils/logger');

const EXPIRY_THRESHOLDS = [90, 60, 30, 7, 0];
const LOGIN_PATH = '/';

function escapeHtml(value) {
  return String(value ?? '-').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function normalizeEmail(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

function dateText(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : '-';
}

function daysUntil(value, now = new Date()) {
  const expiry = new Date(value);
  const today = new Date(now);
  const expiryUtc = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.floor((expiryUtc - todayUtc) / 86400000);
}

function summaryTable(rows) {
  return `<table>${rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}</table>`;
}

async function activeUsers(client, where = {}) {
  return client.user.findMany({ where: { isActive: true, accountStatus: 'ACTIVE', email: { not: '' }, ...where }, select: { id: true, email: true, displayName: true, role: true, department: true, employeeId: true } });
}

async function adminEmails(client) {
  const users = await activeUsers(client, { role: 'ADMIN' });
  return [...new Set(users.map((user) => normalizeEmail(user.email)).filter(Boolean))];
}

async function managerEmails(client, department) {
  if (!department) return [];
  const users = await activeUsers(client, { role: 'MANAGER', department });
  return [...new Set(users.map((user) => normalizeEmail(user.email)).filter(Boolean))];
}

async function employeeEmails(client, employeeId) {
  const employee = await client.employee.findUnique({ where: { id: employeeId }, select: { email: true, department: true, displayName: true, firstName: true, lastName: true, user: { select: { email: true } } } });
  return { employee, emails: [...new Set([normalizeEmail(employee?.email), normalizeEmail(employee?.user?.email)].filter(Boolean))] };
}

async function recordAnomaly({ type, entityId, details }, client = prisma) {
  const eventKey = `anomaly:${type}:${entityId || 'system'}`;
  try {
    const existing = await client.auditLog.findFirst({ where: { entityType: 'NotificationAnomaly', entityId: eventKey }, select: { id: true } });
    if (!existing) await client.auditLog.create({ data: { action: 'CREATE', entityType: 'NotificationAnomaly', entityId: eventKey, metadata: { type, ...details } } });
    if (client === prisma) {
      const { reportOperationalAnomaly } = require('./operational-anomaly.service');
      await reportOperationalAnomaly({ type: type === 'MISSING_MANAGER' ? 'missing_manager' : 'missing_recipient', entityId, safeMessage: type });
    }
  } catch (error) {
    logger.error('notification_anomaly_record_failed', { errorCategory: errorCategory(error), type });
  }
}

async function sendOperationalEmail({ eventKey, recipients, subject, title, rows, body, client = prisma }) {
  const uniqueRecipients = [...new Set((recipients || []).map(normalizeEmail).filter(Boolean))];
  if (!uniqueRecipients.length) return false;
  const html = `<div style="font-family:Arial,sans-serif;color:#1e293b;max-width:640px"><h2>${escapeHtml(title)}</h2>${body ? `<p>${escapeHtml(body)}</p>` : ''}${rows?.length ? summaryTable(rows) : ''}<p>เข้าสู่ระบบเพื่อดำเนินการ: <a href="${LOGIN_PATH}">Security Management System V3</a></p></div>`;
  await sendNotification({ to: uniqueRecipients, subject, html }, { eventKey, prismaClient: client });
  return true;
}

async function notifyNewRegistrationForManagers({ displayName, department, userId }, client = prisma) {
  const recipients = await managerEmails(client, department);
  if (!recipients.length) {
    await recordAnomaly({ type: 'MISSING_MANAGER', entityId: userId, details: { department: department || null } }, client);
    return false;
  }
  return sendOperationalEmail({ eventKey: `registration:${userId}:pending`, recipients, subject: 'มีผู้ลงทะเบียนใหม่รออนุมัติ', title: 'ผู้ลงทะเบียนใหม่รออนุมัติ', rows: [['ชื่อผู้สมัคร', displayName], ['หน่วยงาน', department || '-'], ['สถานะ', 'PENDING']], client });
}

async function notifyLicenseDocumentEvent({ event, documentId, reason, actorUserId, snapshot, client = prisma }) {
  const document = snapshot || await client.employeeLicenseDocument.findUnique({ where: { id: documentId }, select: { id: true, status: true, proposedLicenseNumber: true, proposedStartDate: true, proposedExpiryDate: true, uploadedById: true, employeeId: true, licenseId: true, employee: { select: { firstName: true, lastName: true, displayName: true, department: true, email: true, user: { select: { email: true } } } }, uploadedBy: { select: { email: true, displayName: true } } } });
  if (!document) return false;
  const employeeName = document.employee?.displayName || `${document.employee?.firstName || ''} ${document.employee?.lastName || ''}`.trim() || '-';
  let recipients = [];
  if (event === 'SUBMITTED' || event === 'RESUBMITTED') recipients = await adminEmails(client);
  else if (event === 'HARD_DELETED') {
    const actor = actorUserId ? await client.user.findUnique({ where: { id: actorUserId }, select: { email: true } }).catch(() => null) : null;
    recipients = [...(await adminEmails(client)), normalizeEmail(document.actorEmail), normalizeEmail(actor?.email)];
  }
  else {
    const ownerEmails = [normalizeEmail(document.uploadedBy?.email), normalizeEmail(document.employee?.email), normalizeEmail(document.employee?.user?.email)].filter(Boolean);
    if (!ownerEmails.length) await recordAnomaly({ type: 'MISSING_LICENSE_OWNER_EMAIL', entityId: document.id, details: { event } }, client);
    recipients = [...(await managerEmails(client, document.employee?.department)), ...ownerEmails];
  }
  recipients = [...new Set(recipients.filter(Boolean))];
  if (!recipients.length) {
    await recordAnomaly({ type: 'MISSING_LICENSE_RECIPIENT', entityId: document.id, details: { event, employeeId: document.employeeId } }, client);
    return false;
  }
  const eventKey = `license:${document.id}:${event}`;
  return sendOperationalEmail({ eventKey, recipients, subject: `ใบอนุญาต: ${event}`, title: `การดำเนินการใบอนุญาต ${event}`, rows: [['พนักงาน', employeeName], ['เลขใบอนุญาต', document.proposedLicenseNumber || '-'], ['สถานะ', document.status], ['วันที่เริ่มต้น', dateText(document.proposedStartDate)], ['วันหมดอายุ', dateText(document.proposedExpiryDate)], ...(reason ? [['เหตุผล', reason]] : [])], client });
}

async function notifyLicenseExpiry({ now = new Date(), client = prisma } = {}) {
  const documents = await client.employeeLicenseDocument.findMany({ where: { status: 'APPROVED', isCurrent: true }, select: { id: true, employeeId: true, proposedLicenseNumber: true, proposedExpiryDate: true, employee: { select: { firstName: true, lastName: true, displayName: true, department: true, email: true, user: { select: { email: true } } } } } });
  let sent = 0;
  for (const document of documents) {
    const days = daysUntil(document.proposedExpiryDate, now);
    if (!EXPIRY_THRESHOLDS.includes(days)) continue;
    const ownerEmails = [normalizeEmail(document.employee?.email), normalizeEmail(document.employee?.user?.email)].filter(Boolean);
    if (!ownerEmails.length) await recordAnomaly({ type: 'MISSING_LICENSE_OWNER_EMAIL', entityId: document.id, details: { threshold: days } }, client);
    const recipients = [...(await adminEmails(client)), ...(await managerEmails(client, document.employee?.department)), ...ownerEmails];
    if (!recipients.filter(Boolean).length) continue;
    await sendOperationalEmail({ eventKey: `license:${document.id}:expiry:${days}`, recipients, subject: `ใบอนุญาตใกล้หมดอายุ (${days} วัน)`, title: days < 0 ? 'ใบอนุญาตหมดอายุแล้ว' : 'ใบอนุญาตใกล้หมดอายุ', rows: [['เลขใบอนุญาต', document.proposedLicenseNumber || '-'], ['พนักงาน', document.employee?.displayName || `${document.employee?.firstName || ''} ${document.employee?.lastName || ''}`], ['วันหมดอายุ', dateText(document.proposedExpiryDate)], ['จำนวนวันที่เหลือ', days < 0 ? `หมดอายุแล้ว ${Math.abs(days)} วัน` : `${days} วัน`]], client });
    sent += 1;
  }
  return sent;
}

async function sendDailyApprovalDigest({ now = new Date(), client = prisma } = {}) {
  const recipients = await activeUsers(client, { role: { in: ['ADMIN', 'MANAGER'] } });
  const [pendingUsers, pendingLeaves, licenseDocuments, quotaAnomalies] = await Promise.all([
    client.user.findMany({ where: { accountStatus: 'PENDING' }, select: { id: true, displayName: true, department: true } }),
    client.leaveRequest.findMany({ where: { status: 'PENDING' }, select: { id: true, employeeNameSnapshot: true, departmentSnapshot: true, leaveType: true } }),
    client.employeeLicenseDocument.findMany({ where: { status: { in: ['PENDING', 'RETURNED_FOR_CORRECTION', 'APPROVED', 'SUPERSEDED', 'EXPIRED'] } }, select: { id: true, licenseId: true, version: true, status: true, resubmittedAt: true, isCurrent: true, employee: { select: { displayName: true, department: true } } } }),
    client.leaveQuota.findMany({ where: { OR: [{ employeeId: null }, { matchStatus: { not: 'MATCHED' } }] }, select: { id: true, employeeNameSnapshot: true } })
  ]);
  const pendingLicenses = licenseDocuments.filter((item) => item.status === 'PENDING');
  const returnedLicenses = licenseDocuments.filter((item) => item.status === 'RETURNED_FOR_CORRECTION' && !item.resubmittedAt && !item.isCurrent && !licenseDocuments.some((newer) => newer.licenseId === item.licenseId && (Number(newer.version) > Number(item.version) || (Number(newer.version) === Number(item.version) && newer.id !== item.id)) && ['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'EXPIRED'].includes(newer.status)));
  let sent = 0;
  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now);
  for (const recipient of recipients) {
    const scope = recipient.role === 'ADMIN' ? () => true : (department) => department === recipient.department;
    const items = [
      ...pendingUsers.filter((item) => scope(item.department)).map((item) => `ผู้ลงทะเบียน: ${item.displayName}`),
      ...pendingLeaves.filter((item) => scope(item.departmentSnapshot)).map((item) => `คำขอลา: ${item.employeeNameSnapshot}`),
      ...pendingLicenses.filter((item) => scope(item.employee?.department)).map((item) => `ใบอนุญาตรอตรวจ: ${item.employee?.displayName || '-'}`),
      ...returnedLicenses.filter((item) => scope(item.employee?.department)).map((item) => `ใบอนุญาตส่งกลับแก้ไข: ${item.employee?.displayName || '-'}`),
      ...(recipient.role === 'ADMIN' ? quotaAnomalies.map((item) => `โควต้าวันลาไม่จับคู่: ${item.employeeNameSnapshot}`) : [])
    ];
    if (!items.length) continue;
    await sendOperationalEmail({ eventKey: `digest:${normalizeEmail(recipient.email)}:${dateKey}`, recipients: [recipient.email], subject: 'สรุปงานรออนุมัติประจำวัน', title: 'งานรออนุมัติที่ต้องดำเนินการ', body: items.join(' · '), client });
    sent += 1;
  }
  return sent;
}

async function runDailyOperationalNotifications(options = {}) {
  const expiry = await notifyLicenseExpiry(options);
  const digest = await sendDailyApprovalDigest(options);
  return { expiry, digest };
}

const { reportOperationalAnomaly } = require('./operational-anomaly.service');

module.exports = { EXPIRY_THRESHOLDS, escapeHtml, daysUntil, notifyNewRegistrationForManagers, notifyLicenseDocumentEvent, notifyLicenseExpiry, sendDailyApprovalDigest, runDailyOperationalNotifications, recordAnomaly, reportOperationalAnomaly };
