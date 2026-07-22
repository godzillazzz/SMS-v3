const SENSITIVE_KEY_PARTS = [
  'password', 'passwd', 'token', 'secret', 'cookie', 'csrf', 'authorization',
  'databaseurl', 'connectionstring', 'keyhash', 'hmac', 'email', 'ipaddress',
  'rawip', 'account', 'hash', 'host', 'username', 'requestbody', 'responsebody', 'ip'
];
const DROP_KEYS = new Set(['headers', 'requestheaders', 'responseheaders', 'body', 'requestbody', 'responsebody']);
const SAFE_ERROR_CODES = {
  P1000: 'database_authentication', P1001: 'database_unreachable', P1017: 'database_connection_closed',
  P2002: 'database_unique_constraint', P2003: 'database_foreign_key', P2023: 'database_invalid_input',
  P2025: 'database_record_not_found'
};

function normalizedKey(key) { return String(key).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function isSensitiveKey(key) { const normalized = normalizedKey(key); return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part)); }
function errorCategory(error) {
  if (!error) return 'unknown_error';
  if (SAFE_ERROR_CODES[error.code]) return SAFE_ERROR_CODES[error.code];
  if (Number(error.statusCode) === 429) return 'rate_limited';
  if (Number(error.statusCode) === 401) return 'authentication_rejected';
  if (Number(error.statusCode) === 403) return 'authorization_rejected';
  if (error.name === 'ZodError') return 'validation_error';
  return 'internal_error';
}

function stringContainsProhibitedValue(value) {
  return /(?:postgres(?:ql)?:\/\/|eyJ[A-Za-z0-9_-]{20,}|[A-Fa-f0-9]{64}|(?:\d{1,3}\.){3}\d{1,3}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/.test(value);
}

function sanitize(value, key = '', depth = 0) {
  const normalized = normalizedKey(key);
  if (DROP_KEYS.has(normalized)) return undefined;
  if (isSensitiveKey(key)) return '[REDACTED]';
  if (depth > 5) return '[TRUNCATED]';
  if (value instanceof Error) return { name: value.name || 'Error', category: errorCategory(value) };
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return stringContainsProhibitedValue(value) ? '[REDACTED]' : value.slice(0, 500);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean' || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, '', depth + 1)).filter((item) => item !== undefined);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([nestedKey, nested]) => [nestedKey, sanitize(nested, nestedKey, depth + 1)]).filter(([, nested]) => nested !== undefined));
  }
  return String(value).slice(0, 100);
}

function defaultWriter(level, line) {
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

let operationalEventSink;
function setOperationalEventSink(sink) {
  operationalEventSink = typeof sink === 'function' ? sink : undefined;
}

function createLogger(options = {}) {
  const writer = options.writer || defaultWriter;
  const clock = options.clock || (() => new Date());
  const environment = options.environment || process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';
  const eventSink = options.eventSink;
  function write(level, event, fields = {}) {
    const safeFields = sanitize(fields) || {};
    const record = { timestamp: clock().toISOString(), level, event, deploymentEnvironment: environment, ...safeFields };
    writer(level, JSON.stringify(record));
    if (eventSink) {
      const writePolicyFailure = (error) => {
        writer('error', JSON.stringify({
          timestamp: clock().toISOString(), level: 'error', event: 'alert_policy_failure',
          deploymentEnvironment: environment, errorCategory: errorCategory(error)
        }));
      };
      try {
        const outcome = eventSink(record);
        if (outcome && typeof outcome.catch === 'function') outcome.catch(writePolicyFailure);
      } catch (error) {
        writePolicyFailure(error);
      }
    }
    return record;
  }
  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields)
  };
}

const logger = createLogger({ eventSink: (record) => operationalEventSink?.(record) });
module.exports = { logger, createLogger, sanitize, errorCategory, isSensitiveKey, setOperationalEventSink };
