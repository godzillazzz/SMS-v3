'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const prisma = require('../config/prisma');
const env = require('../config/env');
const audit = require('./audit.service');
const HttpError = require('../utils/http-error');

const HOUR_MS = 60 * 60 * 1000;
const AUTO_DUPLICATE_ACCOUNT_REASON = 'SYSTEM_DUPLICATE_ACCOUNT';
const normalizeEmail = (email) => email.trim().toLowerCase();
const normalizePersonName = (value) => String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
const emailHash = (email, secret = env.otpHashSecret) => crypto.createHmac('sha256', secret).update(normalizeEmail(email)).digest('hex');
const codeHash = (purpose, email, code, secret = env.otpHashSecret) => crypto.createHmac('sha256', secret).update(`${purpose}:${normalizeEmail(email)}:${code}`).digest('hex');
const sameHash = (left, right) => left.length === right.length && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
const genericSuccess = { message: 'หากอีเมลสามารถดำเนินการได้ ระบบได้ส่งรหัสยืนยันแล้ว' };
const genericRegistrationSuccess = {
  message: 'ระบบได้ส่งรหัสยืนยัน 6 หลักไปยังอีเมลที่ระบุ',
  verificationRequired: true
};
const registrationResponses = Object.freeze({
  REQUEST_SUBMITTED: Object.freeze({ registrationState: 'REQUEST_SUBMITTED', message: 'ยืนยันอีเมลสำเร็จ\nคำขอลงทะเบียนของคุณถูกส่งให้ผู้ดูแลตรวจสอบแล้ว' }),
  REQUEST_PENDING: Object.freeze({ registrationState: 'REQUEST_PENDING', message: 'มีคำขอลงทะเบียนอยู่ระหว่างการตรวจสอบแล้ว\nไม่จำเป็นต้องส่งคำขอใหม่' }),
  EXISTING_ACCOUNT: Object.freeze({ registrationState: 'EXISTING_ACCOUNT', message: 'อีเมลนี้มีบัญชีผู้ใช้งานในระบบแล้ว' }),
  EMPLOYEE_ALREADY_HAS_ACCOUNT: Object.freeze({ registrationState: 'EMPLOYEE_ALREADY_HAS_ACCOUNT', message: 'ข้อมูลนี้มีบัญชีผู้ใช้งานในระบบแล้ว\nหากเปลี่ยนอีเมลหรือไม่สามารถเข้าใช้งานบัญชีเดิม\nกรุณาใช้เมนูลืมรหัสผ่านหรือติดต่อผู้ดูแลระบบ' }),
  REQUEST_REJECTED: Object.freeze({ registrationState: 'REQUEST_REJECTED', message: 'คำขอลงทะเบียนนี้ไม่สามารถดำเนินการต่อได้\nกรุณาติดต่อผู้ดูแลระบบ' }),
  REGISTRATION_SUPPORT_REQUIRED: Object.freeze({ registrationState: 'REGISTRATION_SUPPORT_REQUIRED', message: 'ไม่สามารถดำเนินการลงทะเบียนได้ในขณะนี้\nกรุณาติดต่อผู้ดูแลระบบ' })
});

function createMailer(configuration = env) {
  if (configuration.otpDeliveryProvider !== 'gmail_smtp') {
    return { send: async () => { throw new HttpError(503, 'ไม่สามารถส่งรหัสยืนยันได้ในขณะนี้ กรุณาลองใหม่ภายหลัง'); } };
  }
  const transporter = nodemailer.createTransport({
    host: configuration.smtpHost,
    port: configuration.smtpPort,
    secure: configuration.smtpSecure,
    auth: { user: configuration.smtpUsername, pass: configuration.smtpPassword }
  });
  return {
    send: async ({ to, code, purpose }) => transporter.sendMail({
      from: configuration.otpFromEmail,
      to,
      subject: purpose === 'REGISTRATION' ? 'SMS v3: รหัสยืนยันการลงทะเบียน' : 'SMS v3: รหัสรีเซ็ตรหัสผ่าน',
      text: `รหัสยืนยัน SMS v3 ของคุณคือ ${code}\nรหัสนี้มีอายุ ${configuration.otpCodeExpiresMinutes} นาที\nห้ามเปิดเผยรหัสนี้แก่ผู้อื่น`,
      html: `<p>รหัสยืนยัน SMS v3 ของคุณคือ</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p><p>รหัสนี้มีอายุ ${configuration.otpCodeExpiresMinutes} นาที ห้ามเปิดเผยรหัสนี้แก่ผู้อื่น</p>`
    })
  };
}

function otpLockKey(hashedEmail, purpose) {
  const digest = crypto.createHash('sha256').update(`${purpose}:${hashedEmail}`).digest();
  return digest.readBigInt64BE(0);
}

async function lockOtpScope(tx, hashedEmail, purpose) {
  if (typeof tx.$executeRaw !== 'function') return;
  const lockKey = otpLockKey(hashedEmail, purpose);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;
}

async function defaultDuplicatePersonLookup(tx, submittedName) {
  const normalizedName = normalizePersonName(submittedName);
  if (!normalizedName) return [];
  const rows = await tx.$queryRaw`
    SELECT e."id" AS "id", (u."id" IS NOT NULL) AS "hasUser"
      FROM "employees" e
      LEFT JOIN "users" u ON u."employee_id" = e."id"
     WHERE e."is_active" = true
       AND e."deleted_at" IS NULL
       AND normalize(
             lower(
               regexp_replace(
                 btrim(concat_ws(' ', e."first_name", e."last_name")),
                 '[[:space:]]+', ' ', 'g'
               )
             ),
             NFKC
           ) = ${normalizedName}
     ORDER BY e."id" ASC
     LIMIT 3
  `;
  return rows.map((row) => ({ id: row.id, hasUser: Boolean(row.hasUser) }));
}

function responseFor(state) {
  return { ...registrationResponses[state] };
}

function createOtpService({
  prismaClient = prisma,
  auditService = audit,
  mailer = createMailer(),
  configuration = env,
  registrationNotifier = (payload) => require('./notification-email.service').notifyNewRegistration(payload),
  duplicatePersonLookup = defaultDuplicatePersonLookup
} = {}) {
  if (!configuration.otpHashSecret && configuration.otpDeliveryProvider !== 'disabled') throw new Error('OTP_HASH_SECRET is required for OTP delivery.');
  const key = (email) => emailHash(email, configuration.otpHashSecret);
  const hashCode = (purpose, email, code) => codeHash(purpose, email, code, configuration.otpHashSecret);

  async function runSerializableWithRetry(operation, maxAttempts = 3) {
    let attempt = 0;
    while (true) {
      try {
        return await prismaClient.$transaction(operation, { isolationLevel: 'Serializable' });
      } catch (error) {
        attempt += 1;
        if (error?.code !== 'P2034' || attempt >= maxAttempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 10));
      }
    }
  }

  async function createChallenge({ userId, email, purpose, deliver, successResponse = genericSuccess, registrationRequestId = null, resend = false }) {
    const normalizedEmail = normalizeEmail(email);
    const hashedEmail = key(normalizedEmail);
    const code = String(crypto.randomInt(100000, 1000000));
    const created = await runSerializableWithRetry(async (tx) => {
      await lockOtpScope(tx, hashedEmail, purpose);
      const createdSince = new Date(Date.now() - HOUR_MS);
      const count = await tx.authOtpChallenge.count({ where: { emailHash: hashedEmail, purpose, createdAt: { gte: createdSince } } });
      if (count >= configuration.otpRequestLimitPerHour) throw new HttpError(429, 'ส่งรหัสยืนยันบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');

      const now = new Date();
      const superseded = await tx.authOtpChallenge.updateMany({
        where: { emailHash: hashedEmail, purpose, consumedAt: null, expiresAt: { gt: now } },
        data: { expiresAt: now }
      });
      const challenge = await tx.authOtpChallenge.create({ data: {
        userId, emailHash: hashedEmail, purpose, codeHash: hashCode(purpose, normalizedEmail, code),
        expiresAt: new Date(Date.now() + configuration.otpCodeExpiresMinutes * 60 * 1000), maxAttempts: configuration.otpMaxAttempts,
        deliveryState: deliver ? 'PENDING' : 'NOT_DELIVERED'
      } });
      await auditService.log({
        actorUserId: null,
        action: 'CREATE',
        entityType: 'AuthOtpChallenge',
        entityId: challenge.id,
        metadata: { event: 'OTP_CHALLENGE_CREATED', purpose, deliveryState: challenge.deliveryState }
      }, tx);
      if (superseded.count > 0) {
        await auditService.log({
          actorUserId: null,
          action: 'UPDATE',
          entityType: 'AuthOtpChallenge',
          entityId: challenge.id,
          metadata: { event: 'OTP_CHALLENGE_SUPERSEDED', purpose, supersededCount: superseded.count }
        }, tx);
      }
      if (resend && registrationRequestId) {
        await auditService.log({
          actorUserId: null,
          action: 'UPDATE',
          entityType: 'RegistrationRequest',
          entityId: registrationRequestId,
          metadata: { event: 'REGISTRATION_OTP_RESENT' }
        }, tx);
      }
      return challenge;
    });

    if (!deliver) return successResponse;
    try {
      await mailer.send({ to: normalizedEmail, code, purpose });
      await prismaClient.authOtpChallenge.update({ where: { id: created.id }, data: { deliveryState: 'SENT' } });
      return successResponse;
    } catch (error) {
      await prismaClient.authOtpChallenge.update({ where: { id: created.id }, data: { deliveryState: 'FAILED' } }).catch(() => undefined);
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, 'ไม่สามารถส่งรหัสยืนยันได้ในขณะนี้ กรุณาลองใหม่ภายหลัง');
    }
  }

  async function registrationTarget({ submittedName, normalizedEmail, password, departmentHint }) {
    const [initialUser, initialRequest] = await Promise.all([
      prismaClient.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } }),
      prismaClient.registrationRequest.findUnique({ where: { email: normalizedEmail }, select: { id: true } })
    ]);
    if (initialUser) return { userId: initialUser.id, requestId: null, resend: false };
    if (initialRequest) return { userId: null, requestId: initialRequest.id, resend: true };

    const passwordHash = await bcrypt.hash(password, 12);
    try {
      return await prismaClient.$transaction(async (tx) => {
        const [existingUser, existingRequest] = await Promise.all([
          tx.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } }),
          tx.registrationRequest.findUnique({ where: { email: normalizedEmail }, select: { id: true } })
        ]);
        if (existingUser) return { userId: existingUser.id, requestId: null, resend: false };
        if (existingRequest) return { userId: null, requestId: existingRequest.id, resend: true };
        const request = await tx.registrationRequest.create({ data: {
          submittedName: submittedName.trim(),
          email: normalizedEmail,
          passwordHash,
          departmentHint: departmentHint?.trim() || null,
          status: 'PENDING'
        } });
        await auditService.log({
          actorUserId: null,
          action: 'CREATE',
          entityType: 'RegistrationRequest',
          entityId: request.id,
          metadata: { event: 'REGISTRATION_REQUEST_SUBMITTED', emailVerified: false, employeeLinked: false, roleAssigned: false }
        }, tx);
        return { userId: null, requestId: request.id, resend: false };
      });
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
      const [existingUser, existingRequest] = await Promise.all([
        prismaClient.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } }),
        prismaClient.registrationRequest.findUnique({ where: { email: normalizedEmail }, select: { id: true } })
      ]);
      if (!existingUser && !existingRequest) throw error;
      return existingUser
        ? { userId: existingUser.id, requestId: null, resend: false }
        : { userId: null, requestId: existingRequest.id, resend: true };
    }
  }

  async function requestRegistration({ submittedName, email, password, departmentHint }) {
    const normalizedEmail = normalizeEmail(email);
    const target = await registrationTarget({ submittedName, normalizedEmail, password, departmentHint });
    return createChallenge({
      userId: target.userId,
      email: normalizedEmail,
      purpose: 'REGISTRATION',
      deliver: true,
      successResponse: genericRegistrationSuccess,
      registrationRequestId: target.requestId,
      resend: target.resend
    });
  }

  async function requestPasswordReset({ email }) {
    const normalizedEmail = normalizeEmail(email);
    const user = await prismaClient.user.findUnique({ where: { email: normalizedEmail }, select: { id: true, isActive: true, accountStatus: true } });
    return createChallenge({ userId: user?.isActive && user.accountStatus === 'ACTIVE' ? user.id : null, email: normalizedEmail, purpose: 'PASSWORD_RESET', deliver: Boolean(user?.isActive && user.accountStatus === 'ACTIVE') });
  }

  async function consume({ email, purpose, code, client = prismaClient }) {
    const normalizedEmail = normalizeEmail(email);
    const hashedEmail = key(normalizedEmail);
    const consumeInTransaction = async (tx) => {
      await lockOtpScope(tx, hashedEmail, purpose);
      const challenge = await tx.authOtpChallenge.findFirst({ where: { emailHash: hashedEmail, purpose, consumedAt: null }, orderBy: { createdAt: 'desc' } });
      if (!challenge || challenge.expiresAt <= new Date() || challenge.attempts >= challenge.maxAttempts || challenge.deliveryState !== 'SENT' || !sameHash(challenge.codeHash, hashCode(purpose, normalizedEmail, code))) {
        if (challenge && challenge.attempts < challenge.maxAttempts) await tx.authOtpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
        throw new HttpError(400, 'Invalid or expired verification code.');
      }
      return tx.authOtpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    };
    return client === prismaClient ? prismaClient.$transaction(consumeInTransaction, { isolationLevel: 'Serializable' }) : consumeInTransaction(client);
  }

  async function blockExistingAccountRequest(tx, request, state = 'EXISTING_ACCOUNT') {
    if (request && ['PENDING', 'MATCHED'].includes(request.status)) {
      await tx.registrationRequest.update({
        where: { id: request.id },
        data: {
          emailVerifiedAt: request.emailVerifiedAt || new Date(),
          status: 'REJECTED',
          passwordHash: null,
          rejectedAt: new Date(),
          rejectionReason: AUTO_DUPLICATE_ACCOUNT_REASON
        }
      });
      await auditService.log({
        actorUserId: null,
        action: 'UPDATE',
        entityType: 'RegistrationRequest',
        entityId: request.id,
        metadata: { event: 'REGISTRATION_DUPLICATE_ACCOUNT_BLOCKED', automated: true, blockType: state }
      }, tx);
    }
  }

  async function verifyRegistration({ email, code }) {
    const normalizedEmail = normalizeEmail(email);
    const outcome = await prismaClient.$transaction(async (tx) => {
      await consume({ email: normalizedEmail, code, purpose: 'REGISTRATION', client: tx });
      const [existingUser, current] = await Promise.all([
        tx.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } }),
        tx.registrationRequest.findUnique({ where: { email: normalizedEmail } })
      ]);

      if (existingUser) {
        await blockExistingAccountRequest(tx, current, 'same_email');
        return { state: 'EXISTING_ACCOUNT', notify: null };
      }
      if (!current) return { state: 'REGISTRATION_SUPPORT_REQUIRED', notify: null };
      if (current.status === 'REJECTED') return { state: 'REQUEST_REJECTED', notify: null };
      if (current.status === 'APPROVED') {
        const linked = current.matchedEmployeeId
          ? await tx.employee.findUnique({ where: { id: current.matchedEmployeeId }, select: { user: { select: { id: true } } } })
          : null;
        return { state: linked?.user ? 'EXISTING_ACCOUNT' : 'REGISTRATION_SUPPORT_REQUIRED', notify: null };
      }
      if (!['PENDING', 'MATCHED'].includes(current.status)) return { state: 'REGISTRATION_SUPPORT_REQUIRED', notify: null };
      if (current.emailVerifiedAt) return { state: 'REQUEST_PENDING', notify: null };

      const exactMatches = await duplicatePersonLookup(tx, current.submittedName);
      if (exactMatches.length === 1 && exactMatches[0].hasUser) {
        const now = new Date();
        await tx.registrationRequest.update({
          where: { id: current.id },
          data: {
            emailVerifiedAt: now,
            status: 'REJECTED',
            passwordHash: null,
            rejectedAt: now,
            rejectionReason: AUTO_DUPLICATE_ACCOUNT_REASON
          }
        });
        await auditService.log({
          actorUserId: null,
          action: 'UPDATE',
          entityType: 'RegistrationRequest',
          entityId: current.id,
          metadata: { event: 'REGISTRATION_REQUEST_EMAIL_VERIFIED', emailVerified: true, accountApproved: false }
        }, tx);
        await auditService.log({
          actorUserId: null,
          action: 'UPDATE',
          entityType: 'RegistrationRequest',
          entityId: current.id,
          metadata: { event: 'REGISTRATION_DUPLICATE_ACCOUNT_BLOCKED', automated: true, matchType: 'exact_normalized_full_name' }
        }, tx);
        return { state: 'EMPLOYEE_ALREADY_HAS_ACCOUNT', notify: null };
      }

      const after = await tx.registrationRequest.update({ where: { id: current.id }, data: { emailVerifiedAt: new Date() } });
      await auditService.log({
        actorUserId: null,
        action: 'UPDATE',
        entityType: 'RegistrationRequest',
        entityId: current.id,
        metadata: { event: 'REGISTRATION_REQUEST_EMAIL_VERIFIED', emailVerified: true, accountApproved: false }
      }, tx);
      return {
        state: 'REQUEST_SUBMITTED',
        notify: { displayName: after.submittedName, email: after.email, department: after.departmentHint }
      };
    }, { isolationLevel: 'Serializable' });

    if (outcome.notify) Promise.resolve(registrationNotifier(outcome.notify)).catch(() => undefined);
    return responseFor(outcome.state);
  }

  async function completePasswordReset({ email, code, newPassword }) {
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prismaClient.$transaction(async (tx) => {
      const challenge = await consume({ email, code, purpose: 'PASSWORD_RESET', client: tx });
      if (!challenge.userId) throw new HttpError(400, 'Invalid or expired verification code.');
      await tx.user.update({ where: { id: challenge.userId }, data: { passwordHash, passwordResetRequired: false, failedLoginCount: 0, tokenVersion: { increment: 1 } } });
      await tx.refreshSession.updateMany({ where: { userId: challenge.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await auditService.log({ actorUserId: challenge.userId, action: 'UPDATE', entityType: 'UserCredential', entityId: challenge.userId, metadata: { passwordResetByOtp: true, sessionsRevoked: true } }, tx);
    }, { isolationLevel: 'Serializable' });
    return { message: 'Password reset successfully. Please sign in with your new password.' };
  }

  return { requestRegistration, requestPasswordReset, verifyRegistration, completePasswordReset };
}

module.exports = {
  AUTO_DUPLICATE_ACCOUNT_REASON,
  createOtpService,
  createMailer,
  normalizeEmail,
  normalizePersonName,
  emailHash,
  codeHash,
  genericRegistrationSuccess,
  registrationResponses,
  defaultDuplicatePersonLookup
};
