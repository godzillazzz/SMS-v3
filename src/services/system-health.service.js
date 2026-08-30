const { performance } = require('node:perf_hooks');
const { snapshotRuntimeTelemetry } = require('./runtime-telemetry.service');

function safeCommitSha(value) {
  const sha = String(value || '').trim();
  return /^[0-9a-f]{40}$/i.test(sha) ? sha.toLowerCase() : null;
}

function safeDeploymentHost(value) {
  const host = String(value || '').trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(host) ? host : null;
}

function applicationIdentity(environment = process.env) {
  return {
    environment: ['production', 'preview', 'development'].includes(environment.VERCEL_ENV)
      ? environment.VERCEL_ENV
      : String(environment.NODE_ENV || 'unknown'),
    commitSha: safeCommitSha(environment.VERCEL_GIT_COMMIT_SHA),
    deploymentHost: safeDeploymentHost(environment.VERCEL_URL)
  };
}

function buildWarnings({ telemetry, database, application = {} }) {
  const warnings = [];
  if (!telemetry.requestCount) {
    warnings.push({
      code: 'INSUFFICIENT_RUNTIME_SAMPLES',
      severity: 'INFO',
      message: 'Runtime นี้ยังไม่มี request samples เพียงพอสำหรับสรุป latency.'
    });
  }
  if (telemetry.droppedSamples > 0) {
    warnings.push({
      code: 'BOUNDED_SAMPLE_WINDOW',
      severity: 'INFO',
      message: 'ตัวเลข latency แสดงเฉพาะ rolling samples ล่าสุดของ runtime instance นี้.'
    });
  }
  if (telemetry.p95Ms != null && telemetry.p95Ms >= 2000) {
    warnings.push({
      code: 'HIGH_RUNTIME_P95',
      severity: 'WARNING',
      message: 'API p95 ของ runtime instance นี้สูงกว่า 2,000 ms.'
    });
  }
  if (telemetry.serverErrorRatePct >= 5 && telemetry.requestCount >= 20) {
    warnings.push({
      code: 'HIGH_SERVER_ERROR_RATE',
      severity: 'WARNING',
      message: 'อัตรา HTTP 5xx ของ rolling runtime samples อยู่ที่อย่างน้อย 5%.'
    });
  }
  if (database.status !== 'ok') {
    warnings.push({
      code: 'DATABASE_NOT_READY',
      severity: 'CRITICAL',
      message: 'Database readiness check ไม่ผ่านในรอบตรวจนี้.'
    });
  }
  if (!application.commitSha) {
    warnings.push({
      code: 'APPLICATION_SHA_UNAVAILABLE',
      severity: 'INFO',
      message: 'Runtime นี้ไม่มี exact Vercel Git commit SHA 40 ตัวให้ยืนยัน จึงไม่แสดงค่า SHA ที่คาดเดา.'
    });
  }
  return warnings;
}

async function getSystemHealth({
  prismaClient,
  environment = process.env,
  clock = () => new Date(),
  timer = () => performance.now()
}) {
  const telemetry = snapshotRuntimeTelemetry();
  const dbStartedAt = timer();
  let database;
  try {
    await prismaClient.$queryRaw`SELECT 1`;
    database = {
      status: 'ok',
      latencyMs: Math.round(Math.max(0, timer() - dbStartedAt) * 100) / 100
    };
  } catch {
    database = {
      status: 'unavailable',
      latencyMs: Math.round(Math.max(0, timer() - dbStartedAt) * 100) / 100
    };
  }

  const application = applicationIdentity(environment);
  const warnings = buildWarnings({ telemetry, database, application });
  return {
    data: {
      generatedAt: clock().toISOString(),
      overallStatus: database.status === 'ok' ? 'ready' : 'degraded',
      scope: {
        kind: 'CURRENT_RUNTIME_INSTANCE',
        aggregation: 'BOUNDED_IN_MEMORY_ROLLING_SAMPLES',
        globalMetrics: false,
        note: 'Latency และ request/error counts เป็นข้อมูลของ runtime instance ปัจจุบันเท่านั้น ไม่ใช่ global SLA หรือค่ารวมทุก Vercel instance.'
      },
      application,
      database,
      requests: telemetry,
      warnings
    }
  };
}

module.exports = {
  applicationIdentity,
  buildWarnings,
  getSystemHealth
};
