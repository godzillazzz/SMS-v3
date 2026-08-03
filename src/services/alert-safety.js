const APPROVED_ALERT_EVENT_CATEGORIES = new Set([
  'readiness_failure', 'unexpected_http_5xx', 'rate_limit_store_unavailable',
  'rate_limit_cleanup_failure', 'application_config_invalid', 'startup_dependency_failure',
  'authentication_failure', 'refresh_failure', 'rate_limit_denied',
  'database_latency', 'function_timeout',
  'operational_email_delivery_failure', 'operational_daily_digest_failure',
  'operational_expiry_cron_failure', 'operational_storage_failure',
  'operational_readiness_failure', 'operational_workflow_status_mismatch',
  'operational_missing_recipient', 'operational_missing_manager'
]);

function safeTimestamp(value, fallback) {
  const parsed = value ? new Date(value) : fallback;
  return Number.isNaN(parsed.getTime()) ? fallback.toISOString() : parsed.toISOString();
}

function safeEnvironment(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : 'unknown';
}

function safeRequestId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value) ? value : undefined;
}

function safeRoute(value) {
  return typeof value === 'string' && /^\/[A-Za-z0-9_/:.-]{0,199}$/.test(value) && !value.includes('//') ? value : undefined;
}

module.exports = {
  APPROVED_ALERT_EVENT_CATEGORIES, safeTimestamp, safeEnvironment, safeRequestId, safeRoute
};
