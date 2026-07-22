const dotenv = require('dotenv');
const { z } = require('zod');
const { logger } = require('../utils/logger');
dotenv.config();

const isTest = process.env.NODE_ENV === 'test';
const emptyToUndefined = (value) => value === '' ? undefined : value;
const optionalPositiveInteger = z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).optional());
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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
  ALERTING_ENABLED: z.enum(['true', 'false']).default('false'),
  ALERTING_PROVIDER: z.string().regex(/^[A-Za-z0-9_-]+$/).default('disabled'),
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
  if (value.RATE_LIMIT_STORE === 'postgres' && !value.RATE_LIMIT_HASH_SECRET) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['RATE_LIMIT_HASH_SECRET'], message: 'RATE_LIMIT_HASH_SECRET is required when RATE_LIMIT_STORE=postgres.' });
  }
  if (value.ALERTING_ENABLED === 'true' && !(value.NODE_ENV === 'test' && value.ALERTING_PROVIDER === 'memory')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['ALERTING_PROVIDER'], message: 'Enabled alert delivery is unsupported or incomplete.' });
  }
  if (value.ALERT_DEDUP_STORE === 'postgres' && !value.ALERT_DEDUP_HASH_SECRET) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['ALERT_DEDUP_HASH_SECRET'], message: 'ALERT_DEDUP_HASH_SECRET is required when ALERT_DEDUP_STORE=postgres.' });
  }
});

let parsed;
if (isTest) {
  parsed = schema.parse({
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/smsv3_test',
    JWT_SECRET: process.env.JWT_SECRET?.length >= 32 ? process.env.JWT_SECRET : 'test-secret-with-at-least-thirty-two-chars',
    RATE_LIMIT_STORE: process.env.RATE_LIMIT_STORE || 'memory',
    RATE_LIMIT_HASH_SECRET: process.env.RATE_LIMIT_HASH_SECRET?.length >= 32 ? process.env.RATE_LIMIT_HASH_SECRET : 'test-rate-limit-secret-with-at-least-thirty-two-chars'
  });
} else {
  if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
    logger.error('application_config_invalid', { errorCategory: 'environment_validation', issueCount: 1 });
    throw new Error('Invalid environment configuration: CORS_ORIGIN is required in production.');
  }
  const result = schema.safeParse(process.env);
  if (!result.success) {
    logger.error('application_config_invalid', { errorCategory: 'environment_validation', issueCount: result.error.issues.length });
    const message = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${message}`);
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
  alertingEnabled: parsed.ALERTING_ENABLED === 'true',
  alertingProvider: parsed.ALERTING_PROVIDER,
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
