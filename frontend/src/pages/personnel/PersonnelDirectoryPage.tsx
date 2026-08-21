import { useEffect, useMemo, useRef, useState } from 'react';
import { PersonnelDetailDrawer } from '../../components/personnel/PersonnelDetailDrawer';
import { PersonnelDirectoryHeader } from '../../components/personnel/PersonnelDirectoryHeader';
import { PersonnelMetricCard } from '../../components/personnel/PersonnelMetricCard';
import { PersonnelPagination } from '../../components/personnel/PersonnelPagination';
import { PersonnelSearchToolbar } from '../../components/personnel/PersonnelSearchToolbar';
import { PersonnelTable } from '../../components/personnel/PersonnelTable';
import type { PersonnelRecord, PersonnelRole } from '../../components/personnel/types';
import '../../styles/personnel-directory.css';

type Props = {
  employees: PersonnelRecord[];
  totalCount: number;
  loading: boolean;
  error?: string;
  canManage: boolean;
  role: PersonnelRole;
  searchValue?: string;
  onSearchValueChange?(value: string): void;
  onAdd(): void;
  onReviewChanges?(): void;
  onEdit(employee: PersonnelRecord): void;
  onLifecycle(employee: PersonnelRecord): void;
  onRefresh(): void;
};

export function PersonnelDirectoryPage({ employees, totalCount, loading, error, canManage, role, searchValue, onSearchValueChange, onAdd, onReviewChanges, onEdit, onLifecycle, onRefresh }: Props) {
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PersonnelRecord>();
  const lastSelectedId = useRef<string>();
  useEffect(() => { if (searchValue !== undefined && searchValue !== search) setSearch(searchValue); }, [searchValue]);
  const departments = useMemo(() => Array.from(new Set(employees.map((employee) => employee.department).filter(Boolean) as string[])).sort(), [employees]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return employees.filter((employee) => {
      const matchesTerm = !term || [employee.employeeCode, employee.firstName, employee.lastName, employee.department, employee.jobTitle].filter(Boolean).join(' ').toLowerCase().includes(term);
      const matchesDepartment = !department || employee.department === department;
      const matchesStatus = !status || (status === 'active' ? employee.isActive : !employee.isActive);
      return matchesTerm && matchesDepartment && matchesStatus;
    });
  }, [employees, search, department, status]);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const changeFilter = (fn: (value: string) => void) => (value: string) => { fn(value); if (fn === setSearch) onSearchValueChange?.(value); setPage(1); };
  const clear = () => { setSearch(''); onSearchValueChange?.(''); setDepartment(''); setStatus(''); setPage(1); };
  const incomplete = employees.filter((employee) => !employee.department || !employee.jobTitle).length;
  const permissionDenied = error === 'PERMISSION_DENIED';
  const closeDrawer = () => { const id = lastSelectedId.current; setSelected(undefined); if (id) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-personnel-id="${id}"]`)?.focus()); };

  return <section className="personnel-directory-page data-surface-page" aria-label="Personnel Directory">
    <PersonnelDirectoryHeader canManage={canManage} canReviewChanges={role === 'ADMIN'} totalCount={totalCount} onAdd={onAdd} onReviewChanges={onReviewChanges} onRefresh={onRefresh} />
    <PersonnelSearchToolbar search={search} department={department} status={status} departments={departments} onSearch={changeFilter(setSearch)} onDepartment={changeFilter(setDepartment)} onStatus={changeFilter(setStatus)} onClear={clear} />
    <div className="personnel-summary-grid"><PersonnelMetricCard icon="users" label="บุคลากรทั้งหมด" value={totalCount} context="รายการที่เข้าถึงได้" tone="indigo" /><PersonnelMetricCard icon="check" label="บุคลากรที่ใช้งาน" value={employees.filter((employee) => employee.isActive).length} context="กำลังปฏิบัติงาน" tone="green" /><PersonnelMetricCard icon="quality" label="โปรไฟล์ไม่สมบูรณ์" value={incomplete} context={incomplete ? 'ต้องตรวจสอบข้อมูล' : 'ข้อมูลครบถ้วน'} tone="amber" /></div>
    {permissionDenied ? <div className="personnel-empty-state data-state data-state--permission"><span>⛨</span><h2>ไม่มีสิทธิ์เข้าถึงข้อมูล</h2><p>บัญชีนี้ไม่ได้รับอนุญาตให้ดู Personnel Directory</p></div>
      : error ? <div className="personnel-empty-state data-state data-state--error"><span>!</span><h2>ไม่สามารถโหลดข้อมูลบุคลากร</h2><p>ระบบไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง</p><button type="button" className="btn-neutral small-action" onClick={onRefresh}>ลองใหม่</button></div>
        : loading ? <div className="personnel-loading data-state data-state--loading" role="status">กำลังอ่านข้อมูลพนักงาน…</div>
          : <><div className="personnel-result-line data-result-count">แสดง {visible.length} จาก {filtered.length} รายการ{search || department || status ? ' · กรองแล้ว' : ''}</div><PersonnelTable rows={visible} canManage={canManage} role={role} selectedId={selected?.id} onSelect={(employee) => { lastSelectedId.current = employee.id; setSelected(employee); }} onEdit={onEdit} onLifecycle={onLifecycle} /><PersonnelPagination page={page} totalPages={totalPages} onChange={setPage} /></>}
    {!loading && !error && employees.length === 0 && <div className="personnel-empty-state data-state data-state--empty"><span>♙</span><h2>ยังไม่พบข้อมูลบุคลากร</h2><p>ระบบยังไม่พบข้อมูลที่สามารถแสดงภายใต้หน่วยงานและสิทธิ์ของบัญชีนี้</p><button type="button" className="btn-neutral small-action" onClick={onRefresh}>รีเฟรช</button></div>}
    {!loading && !error && employees.length > 0 && filtered.length === 0 && <div className="personnel-empty-state personnel-empty-state--search data-state data-state--empty"><span>⌕</span><h2>ไม่พบผลการค้นหา</h2><p>ลองล้างตัวกรองหรือใช้คำค้นหาอื่น</p><button type="button" className="btn-neutral small-action" onClick={clear}>ล้างตัวกรอง</button></div>}
    <PersonnelDetailDrawer employee={selected} canManage={canManage} role={role} onClose={closeDrawer} onEdit={() => { if (selected) onEdit(selected); closeDrawer(); }} onLifecycle={() => { if (selected) onLifecycle(selected); closeDrawer(); }} />
  </section>;
}
