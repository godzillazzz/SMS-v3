const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const prisma = require('../config/prisma');
const env = require('../config/env');
const audit = require('./audit.service');
const HttpError = require('../utils/http-error');

const HOUR_MS = 60 * 60 * 1000;
const normalizeEmail = (email) => email.trim().toLowerCase();
const emailHash = (email, secret = env.otpHashSecret) => crypto.createHmac('sha256', secret).update(normalizeEmail(email)).digest('hex');
const codeHash = (purpose, email, code, secret = env.otpHashSecret) => crypto.createHmac('sha256', secret).update(`${purpose}:${normalizeEmail(email)}:${code}`).digest('hex');
const sameHash = (left, right) => left.length === right.length && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
const genericSuccess = { message: 'If the request can be processed, a verification code has been sent.' };

function createMailer(configuration = env) {
  if (configuration.otpDeliveryProvider !== 'gmail_smtp') {
    return { send: async () => { throw new HttpError(503, 'Verification email delivery is unavailable.'); } };
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

function createOtpService({ prismaClient = prisma, auditService = audit, mailer = createMailer(), configuration = env } = {}) {
  if (!configuration.otpHashSecret && configuration.otpDeliveryProvider !== 'disabled') throw new Error('OTP_HASH_SECRET is required for OTP delivery.');
  const key = (email) => emailHash(email, configuration.otpHashSecret);
  const hashCode = (purpose, email, code) => codeHash(purpose, email, code, configuration.otpHashSecret);

  async function createChallenge({ userId, email, purpose, deliver }) {
    const normalizedEmail = normalizeEmail(email);
    const hashedEmail = key(normalizedEmail);
    const code = String(crypto.randomInt(100000, 1000000));
    const created = await prismaClient.$transaction(async (tx) => {
      const createdSince = new Date(Date.now() - HOUR_MS);
      const count = await tx.authOtpChallenge.count({ where: { emailHash: hashedEmail, purpose, createdAt: { gte: createdSince } } });
      if (count >= configuration.otpRequestLimitPerHour) throw new HttpError(429, 'Too many verification requests. Please try again later.');
      const challenge = await tx.authOtpChallenge.create({ data: {
        userId, emailHash: hashedEmail, purpose, codeHash: hashCode(purpose, normalizedEmail, code),
        expiresAt: new Date(Date.now() + configuration.otpCodeExpiresMinutes * 60 * 1000), maxAttempts: configuration.otpMaxAttempts,
        deliveryState: deliver ? 'PENDING' : 'NOT_DELIVERED'
      } });
      await auditService.log({ actorUserId: null, action: 'CREATE', entityType: 'AuthOtpChallenge', entityId: challenge.id, metadata: { purpose, deliveryState: challenge.deliveryState } }, tx);
      return challenge;
    });
    if (!deliver) return genericSuccess;
    try {
      await mailer.send({ to: normalizedEmail, code, purpose });
      await prismaClient.authOtpChallenge.update({ where: { id: created.id }, data: { deliveryState: 'SENT' } });
      return genericSuccess;
    } catch (error) {
      await prismaClient.authOtpChallenge.update({ where: { id: created.id }, data: { deliveryState: 'FAILED' } }).catch(() => undefined);
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, 'Verification email delivery is unavailable.');
    }
  }

  async function requestRegistration({ displayName, email, password, department }) {
    const normalizedEmail = normalizeEmail(email);
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prismaClient.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: normalizedEmail } });
      if (existing && existing.accountStatus !== 'PENDING') return null;
      if (existing) return tx.user.update({ where: { id: existing.id }, data: { displayName, passwordHash, department: department || null, requestedAt: new Date(), isActive: false } });
      const pending = await tx.user.create({ data: { email: normalizedEmail, displayName, passwordHash, department: department || null, role: 'USER', accountStatus: 'PENDING', isActive: false, requestedAt: new Date() } });
      await auditService.log({ actorUserId: null, action: 'CREATE', entityType: 'RegistrationRequest', entityId: pending.id, metadata: { accountStatus: 'PENDING' } }, tx);
      return pending;
    });
    return createChallenge({ userId: user?.id || null, email: normalizedEmail, purpose: 'REGISTRATION', deliver: Boolean(user) });
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
      const challenge = await tx.authOtpChallenge.findFirst({ where: { emailHash: hashedEmail, purpose, consumedAt: null }, orderBy: { createdAt: 'desc' } });
      if (!challenge || challenge.expiresAt <= new Date() || challenge.attempts >= challenge.maxAttempts || challenge.deliveryState !== 'SENT' || !sameHash(challenge.codeHash, hashCode(purpose, normalizedEmail, code))) {
        if (challenge && challenge.attempts < challenge.maxAttempts) await tx.authOtpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
        throw new HttpError(400, 'Invalid or expired verification code.');
      }
      return tx.authOtpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    };
    return client === prismaClient
      ? prismaClient.$transaction(consumeInTransaction)
      : consumeInTransaction(client);
  }

  async function verifyRegistration({ email, code }) {
    const challenge = await consume({ email, code, purpose: 'REGISTRATION' });
    if (!challenge.userId) throw new HttpError(400, 'Invalid or expired verification code.');
    await prismaClient.$transaction(async (tx) => {
      await auditService.log({ actorUserId: null, action: 'UPDATE', entityType: 'RegistrationRequest', entityId: challenge.userId, metadata: { emailVerified: true, accountStatus: 'PENDING' } }, tx);
    });
    return { message: 'Email verified. Your account is awaiting administrator approval.' };
  }

  async function completePasswordReset({ email, code, newPassword }) {
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prismaClient.$transaction(async (tx) => {
      const challenge = await consume({ email, code, purpose: 'PASSWORD_RESET', client: tx });
      if (!challenge.userId) throw new HttpError(400, 'Invalid or expired verification code.');
      await tx.user.update({ where: { id: challenge.userId }, data: { passwordHash, passwordResetRequired: false, failedLoginCount: 0, tokenVersion: { increment: 1 } } });
      await tx.refreshSession.updateMany({ where: { userId: challenge.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await auditService.log({ actorUserId: challenge.userId, action: 'UPDATE', entityType: 'UserCredential', entityId: challenge.userId, metadata: { passwordResetByOtp: true, sessionsRevoked: true } }, tx);
    });
    return { message: 'Password reset successfully. Please sign in with your new password.' };
  }

  return { requestRegistration, requestPasswordReset, verifyRegistration, completePasswordReset };
}

module.exports = { createOtpService, createMailer, normalizeEmail, emailHash, codeHash };
