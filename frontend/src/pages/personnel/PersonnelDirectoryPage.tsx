import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { api } from '../../api';
import { printDocument } from '../../schedule-print';
import { EmployeeRegisterPrint } from '../../components/personnel/PersonnelPrintForms';
import { formatRequestErrorMessage } from '../../request-error';
import { PersonnelDetailDrawer } from '../../components/personnel/PersonnelDetailDrawer';
import { PersonnelDirectoryHeader } from '../../components/personnel/PersonnelDirectoryHeader';
import { PersonnelMetricCard } from '../../components/personnel/PersonnelMetricCard';
import { PersonnelPagination } from '../../components/personnel/PersonnelPagination';
import { PersonnelSearchToolbar } from '../../components/personnel/PersonnelSearchToolbar';
import { PersonnelTable } from '../../components/personnel/PersonnelTable';
import { SectionCard } from '../../components/layout';
import '../../styles/personnel-layout.css';
import { SmsIcon } from '../../components/SmsIcon';
import type { PersonnelRecord, PersonnelRole } from '../../components/personnel/types';
import '../../styles/personnel-directory.css';
import './personnel-redesign.css';

type DirectoryMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  departments?: string[];
  summary?: { total?: number; active?: number; incomplete?: number };
};

type Props = {
  token?: string;
  refreshKey: number;
  canManage: boolean;
  role: PersonnelRole;
  searchValue?: string;
  onSearchValueChange?(value: string): void;
  onAdd(): void;
  onReviewChanges?(): void;
  onEdit(employee: PersonnelRecord): void;
  initialEmployeeId?: string;
  onInitialTargetHandled?(): void;
  onPrintAttendance?(employee: PersonnelRecord): void;
};

const pageSize = 10;
const ATTENDANCE_OFFICIAL_REPORT_ENABLED = import.meta.env.VITE_ATTENDANCE_GOVERNANCE_REPORT_ENABLED === 'true';

export function PersonnelDirectoryPage({ token, refreshKey, canManage, role, searchValue, onSearchValueChange, onAdd, onReviewChanges, onEdit, initialEmployeeId, onInitialTargetHandled, onPrintAttendance }: Props) {
  const [printRows, setPrintRows] = useState<PersonnelRecord[]>([]);
  const [printing, setPrinting] = useState(false);
  const [employees, setEmployees] = useState<PersonnelRecord[]>([]);
  const [meta, setMeta] = useState<DirectoryMeta>({ page: 1, pageSize, total: 0, totalPages: 1, departments: [], summary: { total: 0, active: 0, incomplete: 0 } });
  const [requestLoading, setRequestLoading] = useState(false);
  const [responseKey, setResponseKey] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState(searchValue || '');
  const [debouncedSearch, setDebouncedSearch] = useState(searchValue || '');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const [selected, setSelected] = useState<PersonnelRecord>();
  const lastSelectedId = useRef<string>();

  const canPrintAttendance = ATTENDANCE_OFFICIAL_REPORT_ENABLED && (role === 'ADMIN' || role === 'SUPERVISOR');

  const currentQueryKey = JSON.stringify({ token: token || '', role, page, search: search.trim(), debouncedSearch: debouncedSearch.trim(), department, status, refreshKey, localRefreshKey });
  const responseMatches = responseKey === currentQueryKey;
  const loading = Boolean(token) && (!responseMatches || requestLoading);
  const visibleEmployees = responseMatches ? employees : [];
  const visibleMeta = responseMatches ? meta : { page: 1, pageSize, total: 0, totalPages: 1, departments: [], summary: { total: 0, active: 0, incomplete: 0 } };
  const visibleError = responseMatches ? error : '';

  useEffect(() => {
    const next = searchValue || '';
    if (next !== search) {
      setSearch(next);
      setPage(1);
    }
  }, [searchValue]);

  useEffect(() => {
    if (!initialEmployeeId) return;
    const employee = employees.find((row) => String(row.id) === String(initialEmployeeId));
    if (employee) {
      lastSelectedId.current = employee.id;
      setSelected(employee);
      onInitialTargetHandled?.();
    }
  }, [employees, initialEmployeeId]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!token) {
      setEmployees([]);
      setMeta({ page: 1, pageSize, total: 0, totalPages: 1, departments: [], summary: { total: 0, active: 0, incomplete: 0 } });
      setResponseKey(currentQueryKey);
      setRequestLoading(false);
      return;
    }
    let active = true;
    setRequestLoading(true);
    setError('');
    api.employees(token, {
      page,
      pageSize,
      search: debouncedSearch || undefined,
      department: department || undefined,
      isActive: status ? status === 'active' : undefined,
      directoryMeta: true
    }).then((result) => {
      if (!active) return;
      const rows = Array.isArray(result?.data) ? result.data as PersonnelRecord[] : [];
      const nextMeta = (result?.meta || {}) as Partial<DirectoryMeta>;
      const totalPages = Math.max(1, Number(nextMeta.totalPages || 1));
      if (page > totalPages) {
        setPage(totalPages);
        return;
      }
      setEmployees(rows);
      setMeta({
        page: Number(nextMeta.page || page),
        pageSize: Number(nextMeta.pageSize || pageSize),
        total: Number(nextMeta.total || 0),
        totalPages,
        departments: Array.isArray(nextMeta.departments) ? nextMeta.departments.map(String) : [],
        summary: nextMeta.summary || {}
      });
    }).catch((reason) => {
      if (!active) return;
      setEmployees([]);
      setError(formatRequestErrorMessage(reason, 'ไม่สามารถอ่านข้อมูลพนักงานได้'));
    }).finally(() => {
      if (active) {
        setResponseKey(currentQueryKey);
        setRequestLoading(false);
      }
    });
    return () => { active = false; };
  }, [token, role, page, debouncedSearch, department, status, refreshKey, localRefreshKey]);

  const changeFilter = (fn: (value: string) => void) => (value: string) => {
    fn(value);
    if (fn === setSearch) onSearchValueChange?.(value);
    setPage(1);
  };
  const clear = () => {
    setSearch('');
    setDebouncedSearch('');
    onSearchValueChange?.('');
    setDepartment('');
    setStatus('');
    setPage(1);
  };
  const totalCount = Number(visibleMeta.summary?.total ?? visibleMeta.total);
  const activeCount = Number(visibleMeta.summary?.active ?? 0);
  const incompleteCount = Number(visibleMeta.summary?.incomplete ?? 0);
  const permissionDenied = visibleError === 'PERMISSION_DENIED';
  const hasActiveFilters = Boolean(search || department || status);
  const closeDrawer = () => {
    const id = lastSelectedId.current;
    setSelected(undefined);
    if (id) requestAnimationFrame(() => {
      const desktop = document.querySelector<HTMLElement>(`[data-personnel-id="${id}"] .personnel-name-button`);
      const mobile = document.querySelector<HTMLElement>(`button[data-personnel-id="${id}"]`);
      (desktop || mobile)?.focus();
    });
  };

  return <section className="personnel-directory-page data-surface-page layout-personnel-page layout-page-surface" aria-label="Personnel Directory">
    <div className="personnel-print-source"><EmployeeRegisterPrint rows={printRows} /></div>
    <PersonnelDirectoryHeader onPrint={() => { void (async () => {
      if (!token) return;
      setPrinting(true);
      try {
        const rows: PersonnelRecord[] = [];
        let totalPages = 1;
        for (let n = 1; n <= totalPages; n++) {
          const result = await api.employees(token, { page: n, pageSize: 100, search: debouncedSearch || undefined, department: department || undefined, isActive: status ? status === 'active' : undefined });
          if (!Array.isArray(result?.data) || !result?.meta || !Number.isInteger(Number(result.meta.totalPages))) throw new Error('invalid pagination');
          rows.push(...result.data as PersonnelRecord[]);
          totalPages = Math.max(1, Number(result.meta.totalPages));
        }
        flushSync(() => setPrintRows(rows));
        await printDocument('#personnel-register-print', 'ทะเบียนรายชื่อพนักงาน', { orientation: 'landscape', margin: '10mm' });
      } catch { window.alert('ไม่สามารถโหลดหรือพิมพ์ทะเบียนได้'); } finally { setPrinting(false); }
    })(); }} printDisabled={loading || printing || Boolean(visibleError) || !token} canManage={canManage} canReviewChanges={role === 'ADMIN'} totalCount={loading ? undefined : totalCount} onAdd={onAdd} onReviewChanges={onReviewChanges} onRefresh={() => setLocalRefreshKey((value) => value + 1)} />
    <div className="personnel-summary-grid"><PersonnelMetricCard icon="users" label="บุคลากรทั้งหมด" value={loading ? undefined : totalCount} context="รายการที่เข้าถึงได้" loading={loading} tone="indigo" /><PersonnelMetricCard icon="check" label="บุคลากรที่ใช้งาน" value={loading ? undefined : activeCount} context="จากข้อมูลทั้งหมด" loading={loading} tone="green" /><PersonnelMetricCard icon="quality" label="โปรไฟล์ไม่สมบูรณ์" value={loading ? undefined : incompleteCount} context={incompleteCount ? 'ต้องตรวจสอบข้อมูล' : 'ข้อมูลครบถ้วน'} loading={loading} tone="amber" /></div>
    <PersonnelSearchToolbar search={search} department={department} status={status} departments={visibleMeta.departments || []} onSearch={changeFilter(setSearch)} onDepartment={changeFilter(setDepartment)} onStatus={changeFilter(setStatus)} onClear={clear} />
    {permissionDenied ? <div className="personnel-empty-state data-state data-state--permission"><span aria-hidden="true"><SmsIcon name="shield" size={24} /></span><h2>ไม่มีสิทธิ์เข้าถึงข้อมูล</h2><p>บัญชีนี้ไม่ได้รับอนุญาตให้ดู Personnel Directory</p></div>
      : <>{!loading && !visibleError && <div className="personnel-result-line data-result-count">แสดง {visibleEmployees.length} จาก {visibleMeta.total} รายการ{hasActiveFilters ? ' · กรองจากข้อมูลทั้งหมด' : ''}</div>}<SectionCard kicker="ทะเบียนบุคลากร" title="รายชื่อพนักงาน" description="แสดงข้อมูลตามตัวกรองและสิทธิ์ที่ได้รับ"><PersonnelTable rows={visibleEmployees} canManage={canManage} canPrintAttendance={canPrintAttendance} onPrintAttendance={(employee) => onPrintAttendance?.(employee)} selectedId={selected?.id} onSelect={(employee) => { lastSelectedId.current = employee.id; setSelected(employee); }} onEdit={onEdit} loading={loading} error={Boolean(visibleError)} onRetry={() => setLocalRefreshKey((value) => value + 1)} hasActiveFilters={hasActiveFilters} emptyAction={visibleMeta.total === 0 && hasActiveFilters ? { label: 'ล้างตัวกรอง', onClick: clear } : { label: 'รีเฟรช', onClick: () => setLocalRefreshKey((value) => value + 1) }} /></SectionCard>{!loading && !visibleError && <PersonnelPagination page={page} totalPages={visibleMeta.totalPages} onChange={setPage} />}</>}
    <PersonnelDetailDrawer employee={selected} token={token} canManage={canManage} role={role} onClose={closeDrawer} onEdit={() => { if (selected) onEdit(selected); closeDrawer(); }} />
  </section>;
}
