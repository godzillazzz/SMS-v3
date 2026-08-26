const dotenv = require('dotenv');
const { z } = require('zod');
const { logger } = require('../utils/logger');

const isTest = process.env.NODE_ENV === 'test';
const isHostedVercel = ['preview', 'production'].includes(process.env.VERCEL_ENV);
const allowLocalTestDefaults = isTest && !isHostedVercel;
if (!isTest && !isHostedVercel) dotenv.config();
const emptyToUndefined = (value) => value === '' ? undefined : value;
const optionalPositiveInteger = z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).optional());
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  VERCEL_ENV: z.enum(['development', 'preview', 'production']).optional(),
  DATABASE_URL: z.string().url().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters.'),
  JWT_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/, 'JWT_EXPIRES_IN must use forms such as 30m or 1h.').default('30m'),
  JWT_ALGORITHM: z.literal('HS256').default('HS256'),
  JWT_ISSUER: z.string().min(1).default('smsv3-api'),
  JWT_AUDIENCE: z.string().min(1).default('smsv3-clients'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGIN: z.string().min(1).refine((value) => !value.split(',').map((origin) => origin.trim()).includes('*'), 'CORS_ORIGIN cannot contain a wildcard when credentials are enabled.').default('http://localhost:5173'),
  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(10),
  RATE_LIMIT_STORE: z.enum(['memory', 'postgres']).default('memory'),
  RATE_LIMIT_HASH_SECRET: z.preprocess(emptyToUndefined, z.string().min(32, 'RATE_LIMIT_HASH_SECRET must be at least 32 characters.').optional()),
  REFRESH_TOKEN_EXPIRES_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  AUTH_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/).default('smsv3_refresh'),
  CSRF_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/).default('smsv3_csrf'),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  REFRESH_TOKEN_EXPIRES_IN: z.string().regex(/^\d+d$/).optional(),
  DISABLE_EMAIL_NOTIFICATIONS: z.enum(['true', 'false']).default('true'),
  OTP_DELIVERY_PROVIDER: z.enum(['disabled', 'gmail_smtp']).default('disabled'),
  OTP_HASH_SECRET: z.preprocess(emptyToUndefined, z.string().min(32, 'OTP_HASH_SECRET must be at least 32 characters.').optional()),
  OTP_FROM_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
  SMTP_HOST: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  SMTP_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535).optional()),
  SMTP_SECURE: z.enum(['true', 'false']).default('true'),
  SMTP_USERNAME: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  SMTP_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  SUPABASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  SUPABASE_SERVICE_ROLE_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  LICENSE_DOCUMENTS_BUCKET: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(100).optional()),
  EMPLOYEE_REFERENCE_PHOTOS_BUCKET: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(100).optional()),
  OTP_CODE_EXPIRES_MINUTES: z.coerce.number().int().min(5).max(30).default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(10).default(5),
  OTP_REQUEST_LIMIT_PER_HOUR: z.coerce.number().int().min(1).max(20).default(5),
  WEBAUTHN_ENABLED: z.enum(['true', 'false']).default('false'),
  WEBAUTHN_RP_NAME: z.preprocess(emptyToUndefined, z.string().min(1).max(100).optional()),
  WEBAUTHN_RP_ID: z.preprocess(emptyToUndefined, z.string().min(1).max(253).regex(/^(localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/i, 'WEBAUTHN_RP_ID must be a valid hostname.').optional()),
  WEBAUTHN_ORIGIN: z.preprocess(emptyToUndefined, z.string().url().optional()),
  WEBAUTHN_CHALLENGE_TTL_SECONDS: z.coerce.number().int().min(60).max(600).default(300),
  FACE_VERIFICATION_POC_API_ENABLED: z.enum(['true', 'false']).default('false'),
  FACE_VERIFICATION_PROVIDER: z.preprocess(emptyToUndefined, z.enum(['AWS_REKOGNITION_POC']).optional()),
  FACE_VERIFICATION_AWS_REGION: z.preprocess(emptyToUndefined, z.literal('ap-southeast-7').optional()),
  FACE_LIVENESS_CHALLENGE_TYPE: z.preprocess(emptyToUndefined, z.enum(['FaceMovementAndLightChallenge', 'FaceMovementChallenge']).optional()),
  FACE_LIVENESS_MIN_CONFIDENCE: z.preprocess(emptyToUndefined, z.coerce.number().positive().max(100).optional()),
  FACE_MATCH_MIN_SIMILARITY: z.preprocess(emptyToUndefined, z.coerce.number().positive().max(100).optional()),
  FACE_VERIFICATION_IN_PROCESS_ENABLED: z.enum(['true', 'false']).default('false'),
  FACE_MATCH_SIMILARITY_THRESHOLD: z.preprocess(emptyToUndefined, z.coerce.number().min(0.55).max(0.90).optional()),
  FACE_CHALLENGE_MOVEMENT_RADIANS: z.preprocess(emptyToUndefined, z.coerce.number().min(0.10).max(0.50).optional()),
  FACE_CHALLENGE_NEUTRAL_MAX_RADIANS: z.preprocess(emptyToUndefined, z.coerce.number().min(0.10).max(0.50).optional()),
  ALERTING_ENABLED: z.enum(['true', 'false']).default('false'),
  ALERTING_PROVIDER: z.string().regex(/^[A-Za-z0-9_-]+$/).default('disabled'),
  ALERTING_API_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),
  ALERTING_DESTINATION_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  ALERTING_TIMEOUT_MS: optionalPositiveInteger,
  ALERT_COOLDOWN_SECONDS: z.coerce.number().int().min(1).max(86400).default(300),
  ALERT_DEDUP_STORE: z.enum(['memory', 'postgres']).default('memory'),
  ALERT_DEDUP_HASH_SECRET: z.preprocess(emptyToUndefined, z.string().min(32, 'ALERT_DEDUP_HASH_SECRET must be at least 32 characters.').optional()),
  ALERT_DEDUP_RETENTION_SECONDS: z.coerce.number().int().min(300).max(90 * 24 * 60 * 60).default(7 * 24 * 60 * 60),
  ALERT_LOGIN_FAILURE_THRESHOLD: optionalPositiveInteger,
  ALERT_REFRESH_FAILURE_THRESHOLD: optionalPositiveInteger,
  ALERT_HTTP_429_THRESHOLD: optionalPositiveInteger,
  ALERT_DATABASE_LATENCY_MS: optionalPositiveInteger,
  ALERT_FUNCTION_TIMEOUT_THRESHOLD: optionalPositiveInteger
}).superRefine((value, context) => {
  if (['preview', 'production'].includes(value.VERCEL_ENV)) {
    let databaseUrl;
    try {
      databaseUrl = new URL(value.DATABASE_URL);
    } catch {
      return;
    }
    const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, '')).toLowerCase();
    const hostname = databaseUrl.hostname.toLowerCase();
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    const isLocalDatabase = ['sms_v3_dev', 'sms_v3_test', 'smsv3_test'].includes(databaseName);
    if (isLocalHost || isLocalDatabase) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['DATABASE_URL'], message: 'DATABASE_URL must use a non-local, non-test database in Vercel environments.' });
    }
  }
  if (value.VERCEL_ENV === 'production') {
    for (const field of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'LICENSE_DOCUMENTS_BUCKET', 'EMPLOYEE_REFERENCE_PHOTOS_BUCKET']) {
      if (!value[field]) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is required in Production for private document/reference-photo storage.` });
    }
  }
  if (value.RATE_LIMIT_STORE === 'postgres' && !value.RATE_LIMIT_HASH_SECRET) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['RATE_LIMIT_HASH_SECRET'], message: 'RATE_LIMIT_HASH_SECRET is required when RATE_LIMIT_STORE=postgres.' });
  }
  if (value.OTP_DELIVERY_PROVIDER === 'gmail_smtp') {
    for (const field of ['OTP_HASH_SECRET', 'OTP_FROM_EMAIL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD']) {
      if (!value[field]) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is required when OTP_DELIVERY_PROVIDER=gmail_smtp.` });
    }
  }  if (value.FACE_VERIFICATION_POC_API_ENABLED === 'true') {
    if (value.VERCEL_ENV !== 'preview') {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['FACE_VERIFICATION_POC_API_ENABLED'], message: 'Face Verification PoC API may be enabled only in Vercel Preview.' });
    }
    for (const field of ['FACE_VERIFICATION_PROVIDER', 'FACE_VERIFICATION_AWS_REGION', 'FACE_LIVENESS_MIN_CONFIDENCE', 'FACE_MATCH_MIN_SIMILARITY']) {
      if (value[field] == null) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is required when FACE_VERIFICATION_POC_API_ENABLED=true.` });
    }
  }

  if (value.WEBAUTHN_ENABLED === 'true') {
    for (const field of ['WEBAUTHN_RP_NAME', 'WEBAUTHN_RP_ID', 'WEBAUTHN_ORIGIN']) {
      if (!value[field]) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is required when WEBAUTHN_ENABLED=true.` });
    }
  }
  if (value.ALERTING_ENABLED === 'true') {
    if (value.ALERTING_PROVIDER === 'enterprise_chat') {
      if (!value.ALERTING_API_TOKEN) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['ALERTING_API_TOKEN'], message: 'ALERTING_API_TOKEN is required when ALERTING_PROVIDER=enterprise_chat.' });
      }
      if (!value.ALERTING_DESTINATION_ID) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['ALERTING_DESTINATION_ID'], message: 'ALERTING_DESTINATION_ID is required when ALERTING_PROVIDER=enterprise_chat.' });
      }
    } else if (!(value.NODE_ENV === 'test' && value.ALERTING_PROVIDER === 'memory')) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['ALERTING_PROVIDER'], message: 'Enabled alert delivery is unsupported or incomplete.' });
    }
  }
  if (value.ALERT_DEDUP_STORE === 'postgres' && !value.ALERT_DEDUP_HASH_SECRET) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['ALERT_DEDUP_HASH_SECRET'], message: 'ALERT_DEDUP_HASH_SECRET is required when ALERT_DEDUP_STORE=postgres.' });
  }
});

let parsed;
if (allowLocalTestDefaults) {
  parsed = schema.parse({
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/smsv3_test',
    JWT_SECRET: process.env.JWT_SECRET?.length >= 32 ? process.env.JWT_SECRET : 'test-secret-with-at-least-thirty-two-chars',
    RATE_LIMIT_STORE: process.env.RATE_LIMIT_STORE || 'memory',
    RATE_LIMIT_HASH_SECRET: process.env.RATE_LIMIT_HASH_SECRET?.length >= 32 ? process.env.RATE_LIMIT_HASH_SECRET : 'test-rate-limit-secret-with-at-least-thirty-two-chars'
  });
} else {
  const normalizeVercelPreviewOrigin = (value) => {
    const hostname = String(value || '').trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(hostname)) return null;
    return `https://${hostname}`;
  };
  const configuredCorsOrigins = String(process.env.CORS_ORIGIN || 'https://sms-v3-staging-ten.vercel.app,http://localhost:5173')
    .split(',').map((origin) => origin.trim()).filter(Boolean);
  const previewVercelOrigins = process.env.VERCEL_ENV === 'preview'
    ? [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL].map(normalizeVercelPreviewOrigin).filter(Boolean)
    : [];
  const effectiveCorsOrigin = [...new Set([...configuredCorsOrigins, ...previewVercelOrigins])].join(',');
  const envToParse = {
    ...process.env,
    CORS_ORIGIN: effectiveCorsOrigin
  };
  const result = schema.safeParse(envToParse);
  if (!result.success) {
    logger.error('application_config_invalid', { errorCategory: 'environment_validation', issueCount: result.error.issues.length });
    const invalidVariables = [...new Set(result.error.issues.map((issue) => issue.path[0] || 'environment'))];
    throw new Error(`Invalid environment configuration: ${invalidVariables.join(', ')}`);
  }
  parsed = result.data;
}

module.exports = {
  port: parsed.PORT, nodeEnv: parsed.NODE_ENV, jwtSecret: parsed.JWT_SECRET,
  jwtExpiresIn: parsed.JWT_EXPIRES_IN, jwtAlgorithm: parsed.JWT_ALGORITHM,
  jwtIssuer: parsed.JWT_ISSUER, jwtAudience: parsed.JWT_AUDIENCE,
  corsOrigins: parsed.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean),
  loginRateLimitWindowMs: parsed.LOGIN_RATE_LIMIT_WINDOW_MS, loginRateLimitMax: parsed.LOGIN_RATE_LIMIT_MAX,
  rateLimitStore: parsed.RATE_LIMIT_STORE, rateLimitHashSecret: parsed.RATE_LIMIT_HASH_SECRET,
  refreshTokenExpiresDays: parsed.REFRESH_TOKEN_EXPIRES_IN ? Number(parsed.REFRESH_TOKEN_EXPIRES_IN.slice(0, -1)) : parsed.REFRESH_TOKEN_EXPIRES_DAYS,
  authCookieName: parsed.AUTH_COOKIE_NAME,
  csrfCookieName: parsed.CSRF_COOKIE_NAME, cookieSameSite: parsed.COOKIE_SAME_SITE,
  cookieDomain: parsed.COOKIE_DOMAIN,
  // A production browser session must never be downgraded to an insecure cookie.
  cookieSecure: parsed.NODE_ENV === 'production' || parsed.COOKIE_SECURE === 'true',
  emailNotificationsEnabled: parsed.DISABLE_EMAIL_NOTIFICATIONS === 'false',
  otpDeliveryProvider: parsed.OTP_DELIVERY_PROVIDER,
  otpHashSecret: parsed.OTP_HASH_SECRET,
  otpFromEmail: parsed.OTP_FROM_EMAIL,
  smtpHost: parsed.SMTP_HOST,
  smtpPort: parsed.SMTP_PORT,
  smtpSecure: parsed.SMTP_SECURE === 'true',
  smtpUsername: parsed.SMTP_USERNAME,
  smtpPassword: parsed.SMTP_PASSWORD,
  otpCodeExpiresMinutes: parsed.OTP_CODE_EXPIRES_MINUTES,
  otpMaxAttempts: parsed.OTP_MAX_ATTEMPTS,
  otpRequestLimitPerHour: parsed.OTP_REQUEST_LIMIT_PER_HOUR,
  webAuthnEnabled: parsed.WEBAUTHN_ENABLED === 'true',
  webAuthnRpName: parsed.WEBAUTHN_RP_NAME,
  webAuthnRpId: parsed.WEBAUTHN_RP_ID,
  webAuthnOrigin: parsed.WEBAUTHN_ORIGIN,
  webAuthnChallengeTtlSeconds: parsed.WEBAUTHN_CHALLENGE_TTL_SECONDS,
  faceVerificationPocApiEnabled: parsed.FACE_VERIFICATION_POC_API_ENABLED === 'true',
  faceVerificationProvider: parsed.FACE_VERIFICATION_PROVIDER,
  faceVerificationAwsRegion: parsed.FACE_VERIFICATION_AWS_REGION,
  faceLivenessChallengeType: parsed.FACE_LIVENESS_CHALLENGE_TYPE,
  faceLivenessMinConfidence: parsed.FACE_LIVENESS_MIN_CONFIDENCE,
  faceMatchMinSimilarity: parsed.FACE_MATCH_MIN_SIMILARITY,
  faceVerificationInProcessEnabled: parsed.FACE_VERIFICATION_IN_PROCESS_ENABLED === 'true',
  faceMatchSimilarityThreshold: parsed.FACE_MATCH_SIMILARITY_THRESHOLD,
  faceChallengeMovementRadians: parsed.FACE_CHALLENGE_MOVEMENT_RADIANS,
  faceChallengeNeutralMaxRadians: parsed.FACE_CHALLENGE_NEUTRAL_MAX_RADIANS,
  alertingEnabled: parsed.ALERTING_ENABLED === 'true',
  alertingProvider: parsed.ALERTING_PROVIDER,
  alertingApiToken: parsed.ALERTING_API_TOKEN,
  alertingDestinationId: parsed.ALERTING_DESTINATION_ID,
  alertingTimeoutMs: parsed.ALERTING_TIMEOUT_MS,
  alertCooldownSeconds: parsed.ALERT_COOLDOWN_SECONDS,
  alertDedupStore: parsed.ALERT_DEDUP_STORE,
  alertDedupHashSecret: parsed.ALERT_DEDUP_HASH_SECRET,
  alertDedupRetentionSeconds: parsed.ALERT_DEDUP_RETENTION_SECONDS,
  alertThresholds: {
    loginFailureSpike: parsed.ALERT_LOGIN_FAILURE_THRESHOLD,
    refreshFailureSpike: parsed.ALERT_REFRESH_FAILURE_THRESHOLD,
    http429Spike: parsed.ALERT_HTTP_429_THRESHOLD,
    databaseLatencyMs: parsed.ALERT_DATABASE_LATENCY_MS,
    functionTimeoutCount: parsed.ALERT_FUNCTION_TIMEOUT_THRESHOLD
  }
};
