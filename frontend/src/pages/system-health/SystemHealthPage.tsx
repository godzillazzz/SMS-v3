import { useEffect, useState } from 'react';
import { formatRequestErrorMessage } from '../../request-error';
import { getSystemHealth } from '../../system-health-client';
import { DataTableSkeletonCards, DataTableSkeletonRows, DataTableState, ResponsiveDataTable } from '../../components/ResponsiveDataTable';
import { SmsIcon } from '../../components/SmsIcon';
import { formatThaiDateTime } from '../../thai-date-time';
import { MetricCard, PageHeader, SectionCard } from '../../components/layout';

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
  return formatThaiDateTime(parsed, { dateStyle: 'medium', timeStyle: 'medium' });
}

function shortSha(value: string | null | undefined) {
  return value ? value.slice(0, 12) : 'ไม่พร้อมใช้งาน';
}

function SystemHealthRouteCards({ routes, loading, error, onRetry }: { routes: SlowRoute[]; loading: boolean; error: boolean; onRetry(): void }) {
  if (loading) return <div className="system-health-route-cards"><DataTableSkeletonCards count={3} cardClassName="data-mobile-card system-health-route-skeleton" /></div>;
  if (error) return <DataTableState variant="error" title="ไม่สามารถอ่าน route samples ได้" description="ลองอ่าน snapshot ใหม่ได้โดยไม่เปลี่ยนข้อมูลระบบ" action={{ label: 'ลองใหม่', onClick: onRetry }} />;
  if (!routes.length) return <DataTableState variant="empty" title="ยังไม่มี request samples ใน runtime นี้" description="route metrics จะแสดงเมื่อ runtime มี request ที่เก็บใน rolling window" />;
  return <div className="system-health-route-cards">{routes.map((route) => {
    const hasServerErrors = route.serverErrorCount > 0;
    return <article className="data-mobile-card system-health-route-card" key={`${route.method}:${route.route}`}>
      <header>
        <div><small>วิธีการ</small><code>{route.method}</code></div>
        <span className={`status-badge ${hasServerErrors ? 'status-badge--danger' : 'status-badge--success'}`}>{hasServerErrors ? `${route.serverErrorCount} 5xx` : '0 5xx'}</span>
      </header>
      <h3><code>{route.route}</code></h3>
      <dl>
        <div><dt>ตัวอย่าง</dt><dd>{route.requestCount}</dd></div>
        <div><dt>p50</dt><dd>{formatMs(route.p50Ms)}</dd></div>
        <div><dt>p95</dt><dd>{formatMs(route.p95Ms)}</dd></div>
        <div><dt>สูงสุด</dt><dd>{formatMs(route.maxMs)}</dd></div>
      </dl>
    </article>;
  })}</div>;
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
        if (active) setError(formatRequestErrorMessage(cause, 'ไม่สามารถอ่านสถานะระบบได้'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [token, refreshKey]);

  const requests = data?.requests;
  const serverErrorRate = requests ? `${requests.serverErrorRatePct.toFixed(2)}%` : '—';
  const routeRows = requests?.slowRoutes ?? [];
  const retry = () => setRefreshKey((value) => value + 1);
  const routeDesktop = <div className="data-table-scroll"><table className="data-surface-table system-health-route-table" aria-label="เวลา API แยกตาม Route"><thead><tr><th scope="col" className="ds-table-header">วิธีการ</th><th scope="col" className="ds-table-header">แม่แบบเส้นทาง</th><th scope="col" className="ds-table-header">ตัวอย่าง</th><th scope="col" className="ds-table-header">p50</th><th scope="col" className="ds-table-header">p95</th><th scope="col" className="ds-table-header">สูงสุด</th><th scope="col" className="ds-table-header">5xx</th></tr></thead><tbody>
    {loading ? <DataTableSkeletonRows columnCount={7} rowCount={5} /> : error ? <tr><td colSpan={7} className="data-table-empty-cell"><DataTableState variant="error" title="ไม่สามารถอ่าน route samples ได้" description="ลองอ่าน snapshot ใหม่ได้โดยไม่เปลี่ยนข้อมูลระบบ" action={{ label: 'ลองใหม่', onClick: retry }} announce={false} /></td></tr> : routeRows.length ? routeRows.map((route) => <tr key={`${route.method}:${route.route}`}>
      <td><code>{route.method}</code></td>
      <td className="system-health-route-template"><code>{route.route}</code></td>
      <td>{route.requestCount}</td>
      <td>{formatMs(route.p50Ms)}</td>
      <td>{formatMs(route.p95Ms)}</td>
      <td>{formatMs(route.maxMs)}</td>
      <td>{route.serverErrorCount}</td>
    </tr>) : <tr><td colSpan={7} className="data-table-empty-cell"><DataTableState variant="empty" title="ยังไม่มี request samples ใน runtime นี้" description="route metrics จะแสดงเมื่อ runtime มี request ที่เก็บใน rolling window" announce={false} /></td></tr>}
  </tbody></table></div>;
  const routeMobile = <SystemHealthRouteCards routes={routeRows} loading={loading} error={Boolean(error)} onRetry={retry} />;

  return <section className="system-health-page data-surface-page layout-page-surface" aria-label="ประสิทธิภาพและสถานะระบบ">
    <PageHeader kicker="ผู้ดูแลระบบ · อ่านอย่างเดียว" title="ประสิทธิภาพและสถานะระบบ" description="ตรวจ runtime, เวลา API, ข้อผิดพลาด HTTP และความพร้อมของฐานข้อมูล โดยไม่เปิดเผย secret หรือเปลี่ยนค่าระบบ" actions={<div className="heading-actions">
        <span className={`status-badge ds-status ${data?.overallStatus === 'ready' ? 'active' : 'inactive'}`}>
          {data?.overallStatus === 'ready' ? 'READY' : data ? 'DEGRADED' : 'UNKNOWN'}
        </span>
        <button className="btn-neutral small-action" type="button" disabled={loading} onClick={() => setRefreshKey((value) => value + 1)}>
          <SmsIcon name="refresh" size={16} />{loading ? 'กำลังตรวจ…' : 'รีเฟรช'}
        </button>
      </div>} className="system-health-heading" />

    <SectionCard kicker="ขอบเขตการวัด" title="ตัวอย่างจาก runtime ปัจจุบัน" description="ข้อมูลนี้เป็น rolling sample ของ runtime instance นี้ ไม่ใช่ SLA รวมทั้งระบบ" className="system-health-scope-card" role="note">
      <p className="system-health-scope ds-body-secondary">{data?.scope.note || 'Latency และจำนวนคำขอแสดงเฉพาะ runtime instance ปัจจุบัน ไม่ใช่ค่า SLA รวม'}</p>
    </SectionCard>

    {error && <div className="data-state data-state--error" role="alert">
      <strong>ไม่สามารถอ่านสถานะระบบได้</strong>
      <span>{error}</span>
    </div>}

    <div className="system-health-kpis" aria-busy={loading}>
      <MetricCard label="ค่ากลาง API p50" value={formatMs(requests?.p50Ms)} description="ตัวอย่างคำขอใน runtime ปัจจุบัน" loading={loading} />
      <MetricCard label="เวลา API p95" value={formatMs(requests?.p95Ms)} description="ตัวอย่างคำขอใน runtime ปัจจุบัน" loading={loading} />
      <MetricCard label="จำนวนคำขอ" value={requests?.requestCount ?? '—'} description={`เก็บไว้ไม่เกิน ${requests?.maxRetainedSamples ?? 500} รายการ`} loading={loading} />
      <MetricCard label="อัตราข้อผิดพลาด HTTP 5xx" value={serverErrorRate} description={`${requests?.serverErrorCount ?? '—'} ข้อผิดพลาดฝั่งเซิร์ฟเวอร์`} loading={loading} />
      <MetricCard label="ฐานข้อมูล" value={data?.database.status === 'ok' ? 'พร้อมใช้งาน' : data ? 'ไม่พร้อมใช้งาน' : '—'} description={`เวลาตอบสนอง ${formatMs(data?.database.latencyMs)}`} loading={loading} />
    </div>

    <div className="system-health-grid">
      <SectionCard kicker="แอปพลิเคชันปัจจุบัน" title="ข้อมูล Deployment" description="ข้อมูลระบุตัวแอปและช่วงเวลาของ runtime ที่กำลังอ่าน" className="table-card system-health-card">
        <dl className="system-health-details">
          <div><dt>สภาพแวดล้อม</dt><dd>{data?.application.environment || '—'}</dd></div>
          <div><dt>Commit SHA</dt><dd><code title={data?.application.commitSha || undefined}>{shortSha(data?.application.commitSha)}</code></dd></div>
          <div><dt>Deployment host</dt><dd>{data?.application.deploymentHost || 'ไม่พร้อมใช้งาน'}</dd></div>
          <div><dt>เริ่ม Runtime</dt><dd>{formatDate(requests?.instanceStartedAt)}</dd></div>
          <div><dt>ช่วงตัวอย่าง</dt><dd>{formatDate(requests?.windowStartedAt)} → {formatDate(requests?.windowEndedAt)}</dd></div>
          <div><dt>ตัวอย่างที่ตกหล่น</dt><dd>{requests?.droppedSamples ?? '—'}</dd></div>
        </dl>
      </SectionCard>

      <SectionCard kicker="สิ่งที่ควรติดตาม" title="คำเตือนปัจจุบัน" description="สถานะที่ API รายงานจาก runtime snapshot นี้" className="table-card system-health-card">
        <div className="system-health-warning-list">
          {data?.warnings.length ? data.warnings.map((warning) =>
            <div className={`system-health-warning system-health-warning--${warning.severity.toLowerCase()}`} key={warning.code}>
              <span>{warning.severity}</span>
              <div><strong>{warning.code}</strong><p>{warning.message}</p></div>
            </div>
          ) : <div className="system-health-empty">ไม่พบ operational warning ใน snapshot ปัจจุบัน</div>}
        </div>
      </SectionCard>
    </div>

    <SectionCard kicker="เส้นทาง API" title="เวลาให้บริการตาม Route" description="แสดงเฉพาะ route template ไม่มี query string, payload, request ID หรือข้อมูลผู้ใช้" className="table-card system-health-routes">
      <ResponsiveDataTable ariaLabel="เวลา API แยกตาม Route" loading={loading} error={Boolean(error)} loadingLabel="กำลังอ่านตัวอย่าง Runtime…" errorLabel="ไม่สามารถอ่านตัวอย่าง Route ได้" hasRows={routeRows.length > 0} className="system-health-route-surface" desktop={routeDesktop} mobile={routeMobile} />
    </SectionCard>

    <p className="system-health-generated">Snapshot: {formatDate(data?.generatedAt)} · Endpoint นี้เป็น read-only และไม่มีปุ่ม deploy, migration หรือ environment mutation.</p>
  </section>;
}
