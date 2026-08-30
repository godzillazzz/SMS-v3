import { useEffect, useState } from 'react';
import { getSystemHealth } from '../../system-health-client';

type SlowRoute = {
  method: string;
  route: string;
  requestCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  serverErrorCount: number;
};

type HealthWarning = {
  code: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
};

type SystemHealth = {
  generatedAt: string;
  overallStatus: 'ready' | 'degraded';
  scope: {
    kind: 'CURRENT_RUNTIME_INSTANCE';
    aggregation: 'BOUNDED_IN_MEMORY_ROLLING_SAMPLES';
    globalMetrics: false;
    note: string;
  };
  application: {
    environment: string;
    commitSha: string | null;
    deploymentHost: string | null;
  };
  database: {
    status: 'ok' | 'unavailable';
    latencyMs: number;
  };
  requests: {
    scope: 'CURRENT_RUNTIME_INSTANCE';
    instanceStartedAt: string;
    maxRetainedSamples: number;
    retainedSamples: number;
    droppedSamples: number;
    windowStartedAt: string | null;
    windowEndedAt: string | null;
    requestCount: number;
    serverErrorCount: number;
    clientErrorCount: number;
    serverErrorRatePct: number;
    p50Ms: number | null;
    p95Ms: number | null;
    maxMs: number | null;
    slowRoutes: SlowRoute[];
  };
  warnings: HealthWarning[];
};

function formatMs(value: number | null | undefined) {
  return value == null ? '—' : `${Math.round(value * 100) / 100} ms`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Bangkok'
  }).format(parsed);
}

function shortSha(value: string | null | undefined) {
  return value ? value.slice(0, 12) : 'ไม่พร้อมใช้งาน';
}

export function SystemHealthPage({ token }: { token: string }) {
  const [data, setData] = useState<SystemHealth>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getSystemHealth(token)
      .then((response) => {
        if (active) setData(response?.data as SystemHealth);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'ไม่สามารถอ่านสถานะระบบได้');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [token, refreshKey]);

  const requests = data?.requests;
  const serverErrorRate = requests ? `${requests.serverErrorRatePct.toFixed(2)}%` : '—';

  return <section className="system-health-page data-surface-page" aria-label="Performance and System Health">
    <div className="page-heading system-health-heading">
      <div>
        <p className="eyebrow">ADMIN · READ ONLY</p>
        <h1>Performance &amp; System Health</h1>
        <p>ตรวจสถานะ runtime, API latency, HTTP errors และ Database readiness โดยไม่เปิดเผย secret หรือสร้างช่องทาง deploy.</p>
      </div>
      <div className="heading-actions">
        <span className={`status-badge ${data?.overallStatus === 'ready' ? 'active' : 'inactive'}`}>
          {data?.overallStatus === 'ready' ? 'READY' : data ? 'DEGRADED' : 'UNKNOWN'}
        </span>
        <button className="btn-neutral small-action" type="button" disabled={loading} onClick={() => setRefreshKey((value) => value + 1)}>
          {loading ? 'กำลังตรวจ…' : '↻ Refresh'}
        </button>
      </div>
    </div>

    <div className="system-health-scope" role="note">
      <strong>ขอบเขตข้อมูล:</strong> {data?.scope.note || 'Latency และ request counts จะแสดงเฉพาะ runtime instance ปัจจุบัน ไม่ใช่ global SLA.'}
    </div>

    {error && <div className="data-state data-state--error" role="alert">
      <strong>ไม่สามารถอ่านสถานะระบบได้</strong>
      <span>{error}</span>
    </div>}

    <div className="system-health-kpis" aria-busy={loading}>
      <article className="system-health-kpi"><span>API p50</span><strong>{formatMs(requests?.p50Ms)}</strong><small>rolling runtime samples</small></article>
      <article className="system-health-kpi"><span>API p95</span><strong>{formatMs(requests?.p95Ms)}</strong><small>rolling runtime samples</small></article>
      <article className="system-health-kpi"><span>Requests</span><strong>{requests?.requestCount ?? '—'}</strong><small>retained ≤ {requests?.maxRetainedSamples ?? 500}</small></article>
      <article className="system-health-kpi"><span>HTTP 5xx</span><strong>{serverErrorRate}</strong><small>{requests?.serverErrorCount ?? '—'} server errors</small></article>
      <article className="system-health-kpi"><span>Database</span><strong>{data?.database.status === 'ok' ? 'READY' : data ? 'UNAVAILABLE' : '—'}</strong><small>{formatMs(data?.database.latencyMs)}</small></article>
    </div>

    <div className="system-health-grid">
      <article className="table-card system-health-card">
        <div className="system-health-card-title">
          <div><p className="eyebrow">CURRENT APPLICATION</p><h2>Application identity</h2></div>
        </div>
        <dl className="system-health-details">
          <div><dt>Environment</dt><dd>{data?.application.environment || '—'}</dd></div>
          <div><dt>Commit SHA</dt><dd><code title={data?.application.commitSha || undefined}>{shortSha(data?.application.commitSha)}</code></dd></div>
          <div><dt>Deployment host</dt><dd>{data?.application.deploymentHost || 'ไม่พร้อมใช้งาน'}</dd></div>
          <div><dt>Runtime started</dt><dd>{formatDate(requests?.instanceStartedAt)}</dd></div>
          <div><dt>Sample window</dt><dd>{formatDate(requests?.windowStartedAt)} → {formatDate(requests?.windowEndedAt)}</dd></div>
          <div><dt>Dropped samples</dt><dd>{requests?.droppedSamples ?? '—'}</dd></div>
        </dl>
      </article>

      <article className="table-card system-health-card">
        <div className="system-health-card-title">
          <div><p className="eyebrow">ACTIONABLE WARNINGS</p><h2>Current warnings</h2></div>
          <span className="record-chip">{data?.warnings.length ?? 0}</span>
        </div>
        <div className="system-health-warning-list">
          {data?.warnings.length ? data.warnings.map((warning) =>
            <div className={`system-health-warning system-health-warning--${warning.severity.toLowerCase()}`} key={warning.code}>
              <span>{warning.severity}</span>
              <div><strong>{warning.code}</strong><p>{warning.message}</p></div>
            </div>
          ) : <div className="system-health-empty">ไม่พบ operational warning ใน snapshot ปัจจุบัน</div>}
        </div>
      </article>
    </div>

    <article className="table-card system-health-routes">
      <div className="system-health-card-title">
        <div><p className="eyebrow">SLOW ROUTES</p><h2>API latency by route template</h2><p>ไม่มี query string, payload, request ID หรือข้อมูลผู้ใช้ในตารางนี้</p></div>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Method</th><th>Route template</th><th>Samples</th><th>p50</th><th>p95</th><th>Max</th><th>5xx</th></tr></thead>
          <tbody>
            {requests?.slowRoutes.length ? requests.slowRoutes.map((route) => <tr key={`${route.method}:${route.route}`}>
              <td><code>{route.method}</code></td>
              <td><code>{route.route}</code></td>
              <td>{route.requestCount}</td>
              <td>{formatMs(route.p50Ms)}</td>
              <td>{formatMs(route.p95Ms)}</td>
              <td>{formatMs(route.maxMs)}</td>
              <td>{route.serverErrorCount}</td>
            </tr>) : <tr><td colSpan={7} className="no-rows">{loading ? 'กำลังอ่าน runtime samples…' : 'ยังไม่มี request samples ใน runtime นี้'}</td></tr>}
          </tbody>
        </table>
      </div>
    </article>

    <p className="system-health-generated">Snapshot: {formatDate(data?.generatedAt)} · Endpoint นี้เป็น read-only และไม่มีปุ่ม deploy, migration หรือ environment mutation.</p>
  </section>;
}
