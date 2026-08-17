'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({ log: [] });
const RECENT_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

function present(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function emailHash(email, secret) {
  return crypto.createHmac('sha256', secret).update(normalizeEmail(email)).digest('hex');
}

function loadRuntimeConfig() {
  const file = process.env.G04_RUNTIME_ENV_FILE;
  if (!file || !fs.existsSync(file)) throw new Error('G04_OTP_RUNTIME_ENV_FILE_MISSING');
  const raw = dotenv.parse(fs.readFileSync(file, 'utf8'));
  const provider = present(raw.OTP_DELIVERY_PROVIDER) ? raw.OTP_DELIVERY_PROVIDER.trim() : 'missing';
  const smtpSecure = present(raw.SMTP_SECURE) ? raw.SMTP_SECURE.trim().toLowerCase() === 'true' : true;
  const limit = present(raw.OTP_REQUEST_LIMIT_PER_HOUR) ? Number(raw.OTP_REQUEST_LIMIT_PER_HOUR) : 5;
  return {
    raw,
    provider,
    smtpSecure,
    requestLimit: Number.isFinite(limit) ? limit : 5,
    valid: provider === 'gmail_smtp'
      && present(raw.OTP_HASH_SECRET)
      && present(raw.OTP_FROM_EMAIL)
      && present(raw.SMTP_HOST)
      && present(raw.SMTP_PORT)
      && present(raw.SMTP_USERNAME)
      && present(raw.SMTP_PASSWORD)
  };
}

function printConfig(config) {
  const raw = config.raw;
  console.log(`OTP_DELIVERY_PROVIDER=${config.provider}`);
  console.log(`OTP_HASH_SECRET=${present(raw.OTP_HASH_SECRET) ? 'PRESENT' : 'MISSING'}`);
  console.log(`OTP_FROM_EMAIL=${present(raw.OTP_FROM_EMAIL) ? 'PRESENT' : 'MISSING'}`);
  console.log(`SMTP_HOST=${present(raw.SMTP_HOST) ? 'PRESENT' : 'MISSING'}`);
  console.log(`SMTP_PORT=${present(raw.SMTP_PORT) ? 'PRESENT' : 'MISSING'}`);
  console.log(`SMTP_USERNAME=${present(raw.SMTP_USERNAME) ? 'PRESENT' : 'MISSING'}`);
  console.log(`SMTP_PASSWORD=${present(raw.SMTP_PASSWORD) ? 'PRESENT' : 'MISSING'}`);
  console.log(`SMTP_SECURE=${config.smtpSecure ? 'true' : 'false'}`);
  console.log(`OTP_REQUEST_LIMIT_PER_HOUR=${config.requestLimit}`);
}

async function readProductionState(config) {
  const recentSince = new Date(Date.now() - RECENT_HOURS * HOUR_MS);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const readOnly = await tx.$queryRawUnsafe('SHOW transaction_read_only');
    const isolation = await tx.$queryRawUnsafe('SHOW transaction_isolation');
    if (String(readOnly[0]?.transaction_read_only).toLowerCase() !== 'on') throw new Error('G04_OTP_DIAG_NOT_READ_ONLY');

    const latestRequest = await tx.registrationRequest.findFirst({
      where: { createdAt: { gte: recentSince } },
      orderBy: { createdAt: 'desc' },
      select: { email: true, status: true, emailVerifiedAt: true, createdAt: true }
    });
    const latestChallenge = await tx.authOtpChallenge.findFirst({
      where: { purpose: 'REGISTRATION', createdAt: { gte: recentSince } },
      orderBy: { createdAt: 'desc' },
      select: { emailHash: true, deliveryState: true, createdAt: true, consumedAt: true }
    });

    let linkedRequest = null;
    let linkedUser = false;
    let latestHashRateCount = 0;
    if (latestChallenge && present(config.raw.OTP_HASH_SECRET)) {
      const [requests, users] = await Promise.all([
        tx.registrationRequest.findMany({ select: { email: true, status: true, emailVerifiedAt: true, createdAt: true } }),
        tx.user.findMany({ select: { email: true } })
      ]);
      linkedRequest = requests.find((row) => emailHash(row.email, config.raw.OTP_HASH_SECRET) === latestChallenge.emailHash) || null;
      linkedUser = users.some((row) => emailHash(row.email, config.raw.OTP_HASH_SECRET) === latestChallenge.emailHash);
      latestHashRateCount = await tx.authOtpChallenge.count({
        where: {
          emailHash: latestChallenge.emailHash,
          purpose: 'REGISTRATION',
          createdAt: { gte: new Date(Date.now() - HOUR_MS) }
        }
      });
    }

    const txid = await tx.$queryRawUnsafe('SELECT txid_current_if_assigned()::text AS txid');
    if (txid[0]?.txid !== null) throw new Error('G04_OTP_DIAG_TXID_ASSIGNED');

    return {
      readOnly: {
        transactionReadOnly: 'on',
        isolation: String(isolation[0]?.transaction_isolation || ''),
        transactionIdAssigned: null
      },
      recentRequest: Boolean(latestRequest),
      recentChallenge: Boolean(latestChallenge),
      latestDeliveryState: latestChallenge?.deliveryState || 'NONE',
      latestRequestVerified: latestRequest ? (latestRequest.emailVerifiedAt ? 'SET' : 'NULL') : 'N/A',
      latestRequestStatus: latestRequest?.status || 'N/A',
      latestChallengeLinkedRequest: Boolean(linkedRequest),
      latestChallengeLinkedUser: linkedUser,
      linkedRequestVerified: linkedRequest ? (linkedRequest.emailVerifiedAt ? 'SET' : 'NULL') : 'N/A',
      linkedRequestStatus: linkedRequest?.status || 'N/A',
      requestsForLatestEmailPurposeLastHour: latestHashRateCount
    };
  }, { maxWait: 10000, timeout: 90000 });
}

function classify(config, state) {
  if (!config.valid) return 'E. OTP_PROVIDER_DISABLED_OR_INVALID';
  if (state.requestsForLatestEmailPurposeLastHour >= config.requestLimit && state.recentChallenge) {
    // This indicates the next request would be rate-limited, but preserve a more direct delivery-state diagnosis below.
    if (!['SENT', 'FAILED', 'NOT_DELIVERED'].includes(state.latestDeliveryState)) return 'F. RATE_LIMITED';
  }
  if (state.latestDeliveryState === 'FAILED') return 'D. SMTP_DELIVERY_FAILED';
  if (state.latestDeliveryState === 'NOT_DELIVERED' && state.latestChallengeLinkedRequest) return 'B. EXISTING_REQUEST_NO_RESEND';
  if (state.latestDeliveryState === 'NOT_DELIVERED' && state.latestChallengeLinkedUser) return 'C. EXISTING_USER_NO_DELIVERY';
  if (state.latestDeliveryState === 'SENT') return 'A. NEW_REQUEST_SMTP_SEND_ATTEMPTED';
  return 'G. APPLICATION_OTHER';
}

async function main() {
  const config = loadRuntimeConfig();
  printConfig(config);
  const state = await readProductionState(config);
  console.log(`RECENT_WINDOW_HOURS=${RECENT_HOURS}`);
  console.log(`RECENT_REGISTRATION_REQUEST=${state.recentRequest ? 'YES' : 'NO'}`);
  console.log(`RECENT_REGISTRATION_AUTH_OTP_CHALLENGE=${state.recentChallenge ? 'YES' : 'NO'}`);
  console.log(`LATEST_RELEVANT_DELIVERY_STATE=${state.latestDeliveryState}`);
  console.log(`LATEST_REQUEST_EMAIL_VERIFIED_AT=${state.latestRequestVerified}`);
  console.log(`LATEST_REQUEST_STATUS=${state.latestRequestStatus}`);
  console.log(`LATEST_CHALLENGE_LINKED_REQUEST=${state.latestChallengeLinkedRequest ? 'YES' : 'NO'}`);
  console.log(`LATEST_CHALLENGE_LINKED_USER=${state.latestChallengeLinkedUser ? 'YES' : 'NO'}`);
  console.log(`LATEST_LINKED_REQUEST_EMAIL_VERIFIED_AT=${state.linkedRequestVerified}`);
  console.log(`LATEST_LINKED_REQUEST_STATUS=${state.linkedRequestStatus}`);
  console.log(`LATEST_EMAIL_PURPOSE_REQUESTS_LAST_HOUR=${state.requestsForLatestEmailPurposeLastHour}`);
  console.log(`SMTP_SUBMISSION=${state.latestDeliveryState === 'SENT' ? 'SMTP_ACCEPTED' : 'N/A'}`);
  console.log(`G04_OTP_RESEND_GAP=${state.latestDeliveryState === 'NOT_DELIVERED' && state.latestChallengeLinkedRequest ? 'CONFIRMED' : 'NOT_CONFIRMED_FROM_LATEST'}`);
  console.log(`G04_EXISTING_USER_SUPPRESSION=${state.latestDeliveryState === 'NOT_DELIVERED' && state.latestChallengeLinkedUser ? 'CONFIRMED' : 'NOT_CONFIRMED_FROM_LATEST'}`);
  console.log(`PRODUCTION_OTP_CLASSIFICATION=${classify(config, state)}`);
  console.log(`READ_ONLY_TRANSACTION=${state.readOnly.transactionReadOnly}/${state.readOnly.isolation}/txid-null`);
}

main()
  .catch((error) => {
    console.error(`G04_OTP_PRODUCTION_DIAGNOSIS_FAILED=${String(error?.message || 'UNKNOWN').replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 160)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
