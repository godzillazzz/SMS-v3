import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { formatRequestErrorMessage } from '../../request-error';
import { PersonnelDetailDrawer } from '../../components/personnel/PersonnelDetailDrawer';
import { PersonnelDirectoryHeader } from '../../components/personnel/PersonnelDirectoryHeader';
import { PersonnelMetricCard } from '../../components/personnel/PersonnelMetricCard';
import { PersonnelPagination } from '../../components/personnel/PersonnelPagination';
import { PersonnelSearchToolbar } from '../../components/personnel/PersonnelSearchToolbar';
import { PersonnelTable } from '../../components/personnel/PersonnelTable';
import { AttendanceReadinessCenter } from '../../components/personnel/AttendanceReadinessCenter';
import { SmsIcon } from '../../components/SmsIcon';
import type { PersonnelRecord, PersonnelRole } from '../../components/personnel/types';
import '../../styles/personnel-directory.css';

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
};

const pageSize = 10;

export function PersonnelDirectoryPage({ token, refreshKey, canManage, role, searchValue, onSearchValueChange, onAdd, onReviewChanges, onEdit }: Props) {
  const [employees, setEmployees] = useState<PersonnelRecord[]>([]);
  const [meta, setMeta] = useState<DirectoryMeta>({ page: 1, pageSize, total: 0, totalPages: 1, departments: [], summary: { total: 0, active: 0, incomplete: 0 } });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState(searchValue || '');
  const [debouncedSearch, setDebouncedSearch] = useState(searchValue || '');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const [selected, setSelected] = useState<PersonnelRecord>();
  const lastSelectedId = useRef<string>();

  useEffect(() => {
    const next = searchValue || '';
    if (next !== search) {
      setSearch(next);
      setPage(1);
    }
  }, [searchValue]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!token) {
      setEmployees([]);
      setMeta({ page: 1, pageSize, total: 0, totalPages: 1, departments: [], summary: { total: 0, active: 0, incomplete: 0 } });
      return;
    }
    let active = true;
    setLoading(true);
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
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [token, page, debouncedSearch, department, status, refreshKey, localRefreshKey]);

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
  const totalCount = Number(meta.summary?.total ?? meta.total);
  const activeCount = Number(meta.summary?.active ?? 0);
  const incompleteCount = Number(meta.summary?.incomplete ?? 0);
  const permissionDenied = error === 'PERMISSION_DENIED';
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

  return <section className="personnel-directory-page data-surface-page" aria-label="Personnel Directory">
    <PersonnelDirectoryHeader canManage={canManage} canReviewChanges={role === 'ADMIN'} totalCount={totalCount} onAdd={onAdd} onReviewChanges={onReviewChanges} onRefresh={() => setLocalRefreshKey((value) => value + 1)} />
    <AttendanceReadinessCenter token={token} />
    <PersonnelSearchToolbar search={search} department={department} status={status} departments={meta.departments || []} onSearch={changeFilter(setSearch)} onDepartment={changeFilter(setDepartment)} onStatus={changeFilter(setStatus)} onClear={clear} />
    <div className="personnel-summary-grid"><PersonnelMetricCard icon="users" label="บุคลากรทั้งหมด" value={totalCount} context="รายการที่เข้าถึงได้" tone="indigo" /><PersonnelMetricCard icon="check" label="บุคลากรที่ใช้งาน" value={activeCount} context="จากข้อมูลทั้งหมด" tone="green" /><PersonnelMetricCard icon="quality" label="โปรไฟล์ไม่สมบูรณ์" value={incompleteCount} context={incompleteCount ? 'ต้องตรวจสอบข้อมูล' : 'ข้อมูลครบถ้วน'} tone="amber" /></div>
    {permissionDenied ? <div className="personnel-empty-state data-state data-state--permission"><span aria-hidden="true"><SmsIcon name="shield" size={24} /></span><h2>ไม่มีสิทธิ์เข้าถึงข้อมูล</h2><p>บัญชีนี้ไม่ได้รับอนุญาตให้ดู Personnel Directory</p></div>
      : <>{!loading && !error && <div className="personnel-result-line data-result-count">แสดง {employees.length} จาก {meta.total} รายการ{hasActiveFilters ? ' · กรองจากข้อมูลทั้งหมด' : ''}</div>}<PersonnelTable rows={employees} canManage={canManage} selectedId={selected?.id} onSelect={(employee) => { lastSelectedId.current = employee.id; setSelected(employee); }} onEdit={onEdit} loading={loading} error={Boolean(error)} onRetry={() => setLocalRefreshKey((value) => value + 1)} hasActiveFilters={hasActiveFilters} emptyAction={meta.total === 0 && hasActiveFilters ? { label: 'ล้างตัวกรอง', onClick: clear } : { label: 'รีเฟรช', onClick: () => setLocalRefreshKey((value) => value + 1) }} />{!loading && !error && <PersonnelPagination page={page} totalPages={meta.totalPages} onChange={setPage} />}</>}
    <PersonnelDetailDrawer employee={selected} token={token} canManage={canManage} onClose={closeDrawer} onEdit={() => { if (selected) onEdit(selected); closeDrawer(); }} />
  </section>;
}
