import { useEffect, useState, type ReactNode } from 'react';
import { attendanceAuthenticatedRequest } from '../../attendance-auth-request';
import type { DashboardNavigate, DashboardPage } from './types';
import './operations-today.css';

export type OpsSite = { id: string | null; name: string; planned: number; checkedIn: number; late: number; status: 'URGENT' | 'WATCH' | 'NORMAL' };
export type OpsAction = { type: string; severity: 'URGENT' | 'WATCH' | 'INFO'; title: string; detail: string; count: number; unit: string; target: string };
export type OperationsToday = {
  date: string; planned: number | null; checkedIn: number | null; lateNotCheckedIn: number | null; assistOtherSite: number | null; onLeave: number | null; graceMinutes: number;
  patrol: { scanned: number; total: number; round: number; roundStart: string; roundEnd: string; incompleteDepartments: Array<{ department: string; missing: number }> } | null;
  pendingLeave: number | null; sites: OpsSite[]; actions: OpsAction[]; partialErrors: string[];
  siteId: string | null; siteOptions: Array<{ id: string; name: string }>; generatedAt: string;
};

const STATUS_LABEL: Record<OpsSite['status'], string> = { URGENT: 'เร่งด่วน', WATCH: 'เฝ้าระวัง', NORMAL: 'ปกติ' };
const STATUS_CLASS: Record<string, string> = { URGENT: 'is-red', WATCH: 'is-amber', NORMAL: 'is-green', INFO: '' };
const n = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('th-TH').format(value);
const time = (iso: string) => new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' }).format(new Date(iso));

export async function fetchOperationsToday(token: string, siteId?: string): Promise<OperationsToday> {
  const response = await attendanceAuthenticatedRequest(`/dashboard/operations-today${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`, token, { method: 'GET', credentials: 'include' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || 'OPERATIONS_TODAY_FAILED');
  return payload.data as OperationsToday;
}

function siteLine(site: OpsSite) {
  const parts = [`เข้างาน ${n(site.checkedIn)}/${n(site.planned)}`];
  if (site.late > 0) parts.push(`รอติดตาม ${n(site.late)} คน`);
  else if (site.status === 'NORMAL') parts.push('ครบตามแผน');
  else parts.push('ยังเข้างานไม่ครบ');
  return parts.join(' · ');
}

export function OperationsTodayPanel({ data, loading, error, siteId, onSiteChange, onNavigate, announcements }: { data?: OperationsToday; loading: boolean; error?: boolean; siteId: string; onSiteChange(siteId: string): void; onNavigate: DashboardNavigate; announcements?: ReactNode }) {
  const siteCount = data?.sites.filter((site) => site.id).length ?? 0;
  const partial = Boolean(data?.partialErrors?.length);
  return <section className="ops-today" aria-label="ภาพรวมวันนี้">
    <div className="ops-today__head">
      <div>
        <h2>ภาพรวมวันนี้</h2>
        <p className="ops-sub">{loading ? 'กำลังอ่านข้อมูลปฏิบัติงาน…' : data ? `วันนี้มีพนักงานตามแผน ${n(data.planned)} คน ใน ${n(siteCount)} จุดปฏิบัติงาน · อัปเดตล่าสุด ${time(data.generatedAt)} น.` : 'สถานการณ์ปฏิบัติงาน ณ ขณะนี้'}</p>
      </div>
      <label className="ops-filter">จุดปฏิบัติงาน
        <select aria-label="จุดปฏิบัติงาน" value={siteId} onChange={(event) => onSiteChange(event.target.value)}>
          <option value="">ทุกจุดปฏิบัติงาน</option>
          {(data?.siteOptions || []).map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
        </select>
      </label>
    </div>
    {error ? <div className="ops-alert" role="alert">โหลดภาพรวมวันนี้ไม่สำเร็จ ระบบไม่สร้างตัวเลขแทน</div> : partial ? <div className="ops-alert is-warning" role="status">ข้อมูลบางส่วนไม่พร้อม · ช่องที่ไม่มีข้อมูลแสดงเป็น —</div> : null}
    <div className="ops-kpis">
      <button type="button" className="ops-kpi" onClick={() => onNavigate('attendanceSupervisor')}><span>เข้างานแล้ว</span><strong>{n(data?.checkedIn)} <small>/ {n(data?.planned)} คน</small></strong><em>ตามแผนวันนี้</em></button>
      <button type="button" className="ops-kpi" onClick={() => onNavigate('attendanceSupervisor')}><span>ยังไม่เช็กอินเลยเวลา</span><strong className={data?.lateNotCheckedIn ? 'is-red' : ''}>{n(data?.lateNotCheckedIn)} <small>คน</small></strong><em className={data?.lateNotCheckedIn ? 'is-red' : ''}>{data?.lateNotCheckedIn ? 'ต้องติดตาม' : `เกินเวลาเริ่มกะ ${data?.graceMinutes ?? 15} นาที`}</em></button>
      <button type="button" className="ops-kpi" onClick={() => onNavigate('patrolCenter')}><span>รอบตรวจปัจจุบัน</span><strong>{n(data?.patrol?.scanned)} <small>/ {n(data?.patrol?.total)} จุด</small></strong><em>{data?.patrol ? `รอบ ${time(data.patrol.roundStart)}–${time(data.patrol.roundEnd)} น.` : '—'}</em></button>
      <button type="button" className="ops-kpi" onClick={() => onNavigate('attendanceSupervisor')}><span>ช่วยต่าง Site วันนี้</span><strong>{n(data?.assistOtherSite)} <small>คน</small></strong><em>เช็กอินข้ามจุด</em></button>
    </div>
    <div className="ops-columns">
      <section className="ops-card ops-actions" id="ops-actions" aria-labelledby="ops-actions-title">
        <header><h3 id="ops-actions-title">ต้องจัดการตอนนี้</h3><span className={`ops-badge ${data?.actions.length ? 'is-red' : 'is-green'}`}>{n(data?.actions.length ?? 0)} เรื่อง</span></header>
        {loading ? <p className="ops-empty" role="status">กำลังอ่านข้อมูล…</p> : !data?.actions.length ? <p className="ops-empty">ไม่มีเรื่องเร่งด่วนในตอนนี้</p>
          : <div className="ops-rows">{data.actions.map((action) => <button type="button" key={action.type} className="ops-action-row" onClick={() => onNavigate(action.target as DashboardPage)}>
            <span><strong>{action.title}</strong><small>{action.detail}</small></span>
            <span className={`ops-badge ${STATUS_CLASS[action.severity]}`}>{action.severity === 'URGENT' ? `เร่งด่วน · ${n(action.count)} ${action.unit}` : action.severity === 'WATCH' ? 'ติดตาม' : `${n(action.count)} ${action.unit}`}</span>
          </button>)}</div>}
      </section>
      {announcements}
    </div>
    <section className="ops-card" id="ops-sites" aria-labelledby="ops-sites-title">
      <header><h3 id="ops-sites-title">สถานะราย Site</h3><span className="ops-sub">เร่งด่วน = มีคนเลยเวลาไม่เช็กอิน · เฝ้าระวัง = ยังเข้างานไม่ครบ</span></header>
      {!data?.sites.length ? <p className="ops-empty">{loading ? 'กำลังอ่านข้อมูล…' : 'ไม่มีกะตามแผนวันนี้'}</p>
        : <div className="ops-sites">{data.sites.map((site) => <div className="ops-site" key={site.id || 'none'}><div><strong>{site.name}</strong> <span className={`ops-badge ${STATUS_CLASS[site.status]}`}>{STATUS_LABEL[site.status]}</span></div><p>{siteLine(site)}</p></div>)}</div>}
    </section>
  </section>;
}

export function OperationsTodaySection({ token, onNavigate, announcements }: { token: string; onNavigate: DashboardNavigate; announcements?: ReactNode }) {
  const [siteId, setSiteId] = useState('');
  const [data, setData] = useState<OperationsToday>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(false);
    fetchOperationsToday(token, siteId || undefined).then((value) => { if (alive) setData(value); }).catch(() => { if (alive) { setError(true); setData(undefined); } }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token, siteId]);
  return <OperationsTodayPanel data={data} loading={loading} error={error} siteId={siteId} onSiteChange={setSiteId} onNavigate={onNavigate} announcements={announcements} />;
}
