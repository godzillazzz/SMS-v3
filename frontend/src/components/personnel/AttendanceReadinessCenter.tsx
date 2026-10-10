import { SectionCard } from '../layout';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';

export type EmployeeReadinessStatus = 'READY' | 'NOT_READY';
export type EmployeeReadinessViewState = 'loading' | 'ready' | 'error';

type Row = {
  employee: {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    department?: string | null;
    jobTitle?: string | null;
  };
  status: EmployeeReadinessStatus;
  blockers: Array<{ code: string; label: string; detail: string }>;
  checks: Record<string, { ready: boolean; [key: string]: unknown }>;
};

type Response = {
  data: Row[];
  summary: { total: number; ready: number; notReady: number; blockerCounts: Record<string, number> };
  limitedTo: number;
};

type Props = {
  token?: string;
  enabled: boolean;
  onReadinessChange(state: {
    token?: string;
    state: EmployeeReadinessViewState;
    byEmployeeId: Record<string, EmployeeReadinessStatus>;
  }): void;
};

export function AttendanceReadinessCenter({ token, enabled, onReadinessChange }: Props) {
  const [data, setData] = useState<Response>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<'ALL' | EmployeeReadinessStatus>('ALL');

  useEffect(() => {
    if (!enabled || !token) {
      setData(undefined);
      setLoading(false);
      setError(false);
      onReadinessChange({ token, state: 'error', byEmployeeId: {} });
      return;
    }

    let active = true;
    setData(undefined);
    setLoading(true);
    setError(false);
    onReadinessChange({ token, state: 'loading', byEmployeeId: {} });

    api.employeeReadinessCenter(token, '', 50).then((result) => {
      if (!active) return;
      const response = result as Response;
      setData(response);
      onReadinessChange({
        token,
        state: 'ready',
        byEmployeeId: Object.fromEntries(response.data.map((row) => [row.employee.id, row.status]))
      });
    }).catch(() => {
      if (!active) return;
      setError(true);
      onReadinessChange({ token, state: 'error', byEmployeeId: {} });
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [enabled, token, onReadinessChange]);

  const rows = useMemo(() => {
    if (!data) return [];
    return filter === 'ALL' ? data.data : data.data.filter((row) => row.status === filter);
  }, [data, filter]);

  if (!enabled) return null;

  return <SectionCard className="attendance-readiness-center" kicker="ข้อมูลจากระบบ" title="ความพร้อมก่อนเริ่มลงเวลา" description="ตรวจข้อมูลตามข้อกำหนดก่อนใช้งาน ไม่แทนผลตรวจบนอุปกรณ์จริง">
    <div className="attendance-readiness-center__heading">
      <div>
        {loading ? <p className="attendance-readiness-center__summary" role="status">กำลังตรวจความพร้อม…</p>
          : error ? <p className="attendance-readiness-center__summary" role="status">ตรวจสอบความพร้อมไม่ได้</p>
            : data ? <><p className="attendance-readiness-center__summary" data-testid="readiness-summary">พร้อม {data.summary.ready} · ไม่พร้อม {data.summary.notReady}</p><small className="attendance-readiness-center__coverage">ผลตรวจที่ระบบส่ง {data.summary.total} รายการ{data.summary.total === data.limitedTo ? ` · สูงสุด ${data.limitedTo} รายการต่อครั้ง` : ''}</small></>
              : null}
      </div>
      {data && <button
        type="button"
        className="attendance-readiness-center__toggle"
        aria-expanded={expanded}
        aria-controls="attendance-readiness-center-details"
        onClick={() => setExpanded((value) => !value)}
      >{expanded ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'}</button>}
    </div>

    <div id="attendance-readiness-center-details" className="attendance-readiness-center__details" hidden={!expanded}>
      {loading ? <div className="personnel-loading" role="status">กำลังตรวจความพร้อม…</div>
        : error ? <div className="personnel-360-data-note" role="status">ไม่สามารถอ่านข้อมูลความพร้อมจากระบบได้ จึงไม่สรุปสถานะ</div>
          : data ? <>
            <div className="attendance-readiness-center__filters" role="group" aria-label="กรองความพร้อม">
              <button type="button" aria-pressed={filter === 'ALL'} className={filter === 'ALL' ? 'is-active' : ''} onClick={() => setFilter('ALL')}>ทั้งหมด</button>
              <button type="button" aria-pressed={filter === 'READY'} className={filter === 'READY' ? 'is-active' : ''} onClick={() => setFilter('READY')}>พร้อม</button>
              <button type="button" aria-pressed={filter === 'NOT_READY'} className={filter === 'NOT_READY' ? 'is-active' : ''} onClick={() => setFilter('NOT_READY')}>ไม่พร้อม</button>
            </div>
            <div className="attendance-readiness-center__list">
              {rows.map((row) => <article key={row.employee.id} className="attendance-readiness-row">
                <div><strong>{row.employee.firstName} {row.employee.lastName}</strong><small>{row.employee.employeeCode} · {row.employee.department || 'ไม่ระบุหน่วยงาน'} · {row.employee.jobTitle || 'ไม่ระบุตำแหน่ง'}</small></div>
                <span className={row.status === 'READY' ? 'status-badge status-badge--success' : 'status-badge status-badge--warning'}>{row.status === 'READY' ? 'พร้อม' : 'ไม่พร้อม'}</span>
                <p>{row.status === 'READY' ? 'ผ่าน prerequisite ที่บังคับทั้งหมด' : row.blockers.map((item) => item.label).join(' · ')}</p>
              </article>)}
            </div>
            {data.summary.total === data.limitedTo && <small className="attendance-readiness-center__limit">ระบบส่งผลตรวจสูงสุด {data.limitedTo} รายการต่อครั้ง</small>}
          </> : null}
    </div>
  </SectionCard>;
}
