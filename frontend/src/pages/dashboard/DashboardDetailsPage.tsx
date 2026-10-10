import { useEffect, useState } from 'react';
import { api } from '../../api';
import { PageHeader, SectionCard } from '../../components/layout';

type DetailQuery = {
  [key: string]: string | number | undefined;
  metric: string;
  date?: string;
  month?: string;
  department?: string;
  status?: string;
  expiryBucket?: string;
  employeeStatus?: string;
  workforce?: string;
  shiftTypeCode?: string;
  shiftTypeName?: string;
  licenseId?: string;
  page?: number;
  pageSize?: number;
};
type DetailRecord = {
  id: string;
  title: string;
  subtitle?: string;
  status?: string;
  employeeCode?: string | null;
  department?: string | null;
  expiryDate?: string;
  startDate?: string;
  endDate?: string;
  shiftCode?: string | null;
};
type DetailResponse = {
  metric: string;
  date: string;
  month: string;
  department: string;
  status?: string;
  expiryBucket?: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  records: DetailRecord[];
};

const metricTitles: Record<string, string> = {
  activeEmployees: 'พนักงานที่ปฏิบัติงาน',
  totalEmployees: 'พนักงานทั้งหมด',
  schedule: 'กำลังพลตามตารางกะ',
  leaveToday: 'พนักงานที่ลาโดยได้รับอนุมัติ',
  pendingLeaves: 'คำขอลารออนุมัติ',
  leaveMonth: 'ประวัติการลาในเดือน',
  leaveMonthStatus: 'รายการลาแยกตามสถานะ',
  licenseStatus: 'เอกสารใบอนุญาต รปภ.',
  licenseExpiry: 'สถานะวันหมดอายุใบอนุญาต รปภ.',
  pendingUsers: 'บัญชีผู้ใช้รอตรวจสอบ',
  unmatchedQuota: 'โควต้าวันลาที่ยังไม่จับคู่'
};

function queryFromLocation(): DetailQuery {
  const params = new URLSearchParams(window.location.search);
  return {
    metric: params.get('metric') || '',
    date: params.get('date') || undefined,
    month: params.get('month') || undefined,
    department: params.get('department') || undefined,
    status: params.get('status') || undefined,
    expiryBucket: params.get('expiryBucket') || undefined,
    employeeStatus: params.get('employeeStatus') || undefined,
    workforce: params.get('workforce') || undefined,
    shiftTypeCode: params.get('shiftTypeCode') || undefined,
    shiftTypeName: params.get('shiftTypeName') || undefined,
    licenseId: params.get('licenseId') || undefined,
    page: Math.max(1, Number(params.get('page')) || 1),
    pageSize: Math.min(50, Math.max(1, Number(params.get('pageSize')) || 20))
  };
}

function contextText(result: DetailResponse | undefined, query: DetailQuery): string {
  const values = [
    result?.date || query.date ? 'วันที่ ' + (result?.date || query.date) : undefined,
    result?.month || query.month ? 'เดือน ' + (result?.month || query.month) : undefined,
    result?.department || query.department ? 'แผนก ' + (result?.department || query.department) : undefined,
    result?.status || query.status ? 'สถานะ ' + (result?.status || query.status) : undefined,
    result?.expiryBucket || query.expiryBucket
  ].filter(Boolean);
  return values.join(' · ');
}

export function DashboardDetailsPage({ token, onBack }: { token?: string; onBack(): void }) {
  const [query, setQuery] = useState<DetailQuery>(queryFromLocation);
  const [result, setResult] = useState<DetailResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token || !query.metric) {
      setResult(undefined);
      setError(query.metric ? '' : 'ลิงก์นี้ไม่มีตัวชี้วัดที่ต้องการ');
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    setError('');
    api.dashboardDetails(token, query)
      .then((response) => { if (current) setResult(response?.data); })
      .catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : 'ไม่สามารถอ่านรายการได้'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [token, query.metric, query.date, query.month, query.department, query.status, query.expiryBucket, query.employeeStatus, query.workforce, query.shiftTypeCode, query.shiftTypeName, query.licenseId, query.page, query.pageSize]);

  useEffect(() => {
    const syncPage = () => setQuery(queryFromLocation());
    window.addEventListener('popstate', syncPage);
    return () => window.removeEventListener('popstate', syncPage);
  }, []);

  const changePage = (page: number) => {
    const next = { ...query, page };
    const params = new URLSearchParams(window.location.search);
    params.set('page', String(page));
    window.history.pushState(window.history.state, '', window.location.pathname + '?' + params.toString());
    setQuery(next);
  };

  const title = metricTitles[query.metric] || 'รายการตัวชี้วัด';
  return <section className="view-pane layout-page-surface dashboard-details-page">
    <PageHeader kicker="รายละเอียดตัวชี้วัด" title={title} description={contextText(result, query) || 'รายการตามขอบเขตสิทธิ์และตัวกรองจากภาพรวม'} actions={<button type="button" className="btn-neutral small-action" onClick={onBack}>กลับไปภาพรวม</button>} />
    <SectionCard kicker="ข้อมูลจากระบบ" title="รายการที่ตรงกับตัวเลข" description="ระบบกรองข้อมูลและนับจำนวนก่อนแบ่งหน้า" aria-label="รายละเอียดตัวชี้วัด">
      {loading ? <div role="status">กำลังอ่านรายการ…</div> : error ? <div role="alert">{error}</div> : result && result.total > 0 ? <>
        <p className="dashboard-details-total" aria-live="polite">ทั้งหมด {new Intl.NumberFormat('th-TH').format(result.total)} รายการ</p>
        <div className="dashboard-details-list">
          {result.records.map((record) => <article className="dashboard-details-row" key={record.id}>
            <div><strong>{record.title || record.employeeCode || 'รายการ'}</strong><small>{[record.employeeCode, record.subtitle, record.department].filter(Boolean).join(' · ')}</small></div>
            <span>{record.status || ''}</span>
          </article>)}
        </div>
        {result.totalPages > 1 && <nav className="dashboard-details-pagination" aria-label="แบ่งหน้ารายการ">
          <button type="button" className="btn-neutral small-action" disabled={result.page <= 1} onClick={() => changePage(result.page - 1)}>ก่อนหน้า</button>
          <span>หน้า {result.page} จาก {result.totalPages}</span>
          <button type="button" className="btn-neutral small-action" disabled={result.page >= result.totalPages} onClick={() => changePage(result.page + 1)}>ถัดไป</button>
        </nav>}
      </> : !loading && !error ? <div className="dashboard-details-empty" role="status"><strong>ไม่พบรายการ</strong><span>ไม่มีข้อมูลที่ตรงกับตัวกรองนี้</span></div> : null}
    </SectionCard>
  </section>;
}
