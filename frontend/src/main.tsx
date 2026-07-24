import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api';
import './styles.css';

type User = { id: string; email: string; displayName: string; role: string };
type Employee = { id: string; employeeCode: string; firstName: string; lastName: string; department?: string; jobTitle?: string; isActive: boolean };
type Page = 'dashboard' | 'employees' | 'licenses' | 'schedule' | 'approvals' | 'rules' | 'leave' | 'quota' | 'users' | 'audit' | 'reports';
type Auth = { token?: string; user?: User; loading: boolean; error?: string; login(email: string, password: string): Promise<void>; logout(): Promise<void> };
type DataRow = Record<string, unknown>;
type DataResponse = { data?: DataRow[] | DataRow; meta?: { total?: number; page?: number; totalPages?: number } };
type FormField = { name: string; label: string; type?: 'text' | 'email' | 'password' | 'date' | 'number' | 'select' | 'textarea'; required?: boolean; options?: Array<{ value: string; label: string }> };
type Editor = { title: string; submitLabel: string; fields: FormField[]; values: Record<string, string>; submit(values: Record<string, string>): Promise<void> };

const AuthContext = createContext<Auth | undefined>(undefined);

const navigation: Array<{ label: string; items: Array<{ id: Page; icon: string; label: string }> }> = [
  { label: 'ภาพรวม', items: [{ id: 'dashboard', icon: '▦', label: 'Dashboard' }] },
  { label: 'จัดการบุคลากร', items: [
    { id: 'employees', icon: '♙', label: 'พนักงาน' },
    { id: 'licenses', icon: '▣', label: 'ใบอนุญาตพนักงาน' }
  ] },
  { label: 'ตารางและกฎการทำงาน', items: [
    { id: 'schedule', icon: '▤', label: 'ตารางกะ' },
    { id: 'approvals', icon: '✓', label: 'อนุมัติตารางกะ' },
    { id: 'rules', icon: '⚙', label: 'กฎการทำงาน' }
  ] },
  { label: 'การลา', items: [
    { id: 'leave', icon: '◷', label: 'คำขอลา' },
    { id: 'quota', icon: '◫', label: 'โควตาวันลา' }
  ] },
  { label: 'ผู้ดูแลระบบ', items: [
    { id: 'users', icon: '♧', label: 'ผู้ใช้และสิทธิ์' },
    { id: 'audit', icon: '◉', label: 'ประวัติการทำรายการ' },
    { id: 'reports', icon: '↗', label: 'รายงานและส่งออก' }
  ] }
];

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string>();
  const [user, setUser] = useState<User>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = async () => {
    const result = await api.refresh();
    setToken(result.accessToken);
    setUser(result.user);
  };

  useEffect(() => {
    refresh().catch(() => undefined).finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    setError(undefined);
    try {
      const result = await api.login(email, password);
      setToken(result.accessToken);
      setUser(result.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ไม่สามารถเข้าสู่ระบบได้');
      throw reason;
    }
  };

  const logout = async () => {
    await api.logout();
    setToken(undefined);
    setUser(undefined);
  };

  return <AuthContext.Provider value={{ token, user, loading, error, login, logout }}>{children}</AuthContext.Provider>;
}

function Logo() {
  return <span className="brand-mark" aria-label="SMS">SMS</span>;
}

function Login() {
  const auth = useContext(AuthContext)!;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try { await auth.login(email, password); } catch { /* Public error is supplied by the API. */ } finally { setBusy(false); }
  };

  return (
    <main className="login-page">
      <section className="login-shell" aria-label="เข้าสู่ระบบ Security Management System">
        <aside className="login-intro">
          <div className="intro-brand"><Logo /><strong>Security Management System</strong></div>
          <div className="intro-copy">
            <h1>ระบบบริหาร<br />งานรักษาความปลอดภัย</h1>
            <p>บริหารพนักงาน ตารางกะ และกฎการทำงาน ในพื้นที่เดียว</p>
            <span className="intro-check">✓ <span>ข้อมูลและสิทธิ์ผู้ใช้ถูกปกป้องตามนโยบายระบบ</span></span>
          </div>
        </aside>
        <section className="login-form-panel">
          <form className="login-form" onSubmit={submit}>
            <h2>ยินดีต้อนรับ</h2>
            <p className="form-lead">เข้าสู่ระบบเพื่อเปิด Dashboard</p>
            {auth.error && <div className="alert alert-error" role="alert">{auth.error}</div>}
            <label className="field-group" htmlFor="email">
              <span>อีเมล</span>
              <input id="email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="name@company.com" required autoComplete="username" />
            </label>
            <label className="field-group" htmlFor="password">
              <span>รหัสผ่าน</span>
              <span className="password-field">
                <input id="password" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} placeholder="กรอกรหัสผ่าน" required autoComplete="current-password" />
                <button className="password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? 'ซ่อน' : 'แสดง'}</button>
              </span>
            </label>
            <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
            <div className="login-links">
              <span>ยังไม่มีบัญชี? <b>ติดต่อผู้ดูแลระบบ</b></span>
              <span>ลืมรหัสผ่าน? <b>ระบบรีเซ็ตรหัสผ่านกำลังเปิดใช้งาน</b></span>
            </div>
            <p className="login-help">พบปัญหาการใช้งาน: ติดต่อผู้ดูแลระบบของหน่วยงาน</p>
          </form>
        </section>
      </section>
    </main>
  );
}

const text = (value: unknown) => value === null || value === undefined || value === '' ? '-' : String(value);
const date = (value: unknown) => value ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' }).format(new Date(String(value))) : '-';
const inputDate = (value: unknown) => value ? new Date(String(value)).toISOString().slice(0, 10) : '';
const nested = (value: unknown): DataRow => value && typeof value === 'object' ? value as DataRow : {};
const formPayload = (values: Record<string, string>, nullable: string[] = []) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, nullable.includes(key) && value === '' ? null : value]));
const csvValue = (value: unknown) => `"${(value && typeof value === 'object' ? JSON.stringify(value) : text(value)).replace(/"/g, '""')}"`;
function downloadCsv(rows: DataRow[], filename: string) {
  if (!rows.length) return;
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const csv = [`\uFEFF${headers.map(csvValue).join(',')}`, ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${filename}.csv`; anchor.click(); URL.revokeObjectURL(url);
}

function EditDialog({ editor, busy, error, onClose }: { editor: Editor; busy: boolean; error?: string; onClose(): void }) {
  const [values, setValues] = useState(editor.values);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await editor.submit(values);
  };
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-dialog-title">
      <div className="dialog-heading"><div><p className="eyebrow">SMS v3 staging</p><h2 id="edit-dialog-title">{editor.title}</h2></div><button type="button" aria-label="ปิด" disabled={busy} onClick={onClose}>×</button></div>
      {error && <div className="alert alert-error">{error}</div>}
      <form onSubmit={submit}>
        <div className="dialog-grid">{editor.fields.map((field) => <label className={field.type === 'textarea' ? 'field-group full' : 'field-group'} key={field.name}><span>{field.label}</span>
          {field.type === 'select' ? <select required={field.required} value={values[field.name] || ''} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}><option value="">— เลือก —</option>{field.options?.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
            : field.type === 'textarea' ? <textarea required={field.required} value={values[field.name] || ''} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} />
              : <input required={field.required} type={field.type || 'text'} step={field.type === 'number' ? '0.01' : undefined} value={values[field.name] || ''} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} />}
        </label>)}</div>
        <div className="dialog-actions"><button className="btn-secondary" type="button" disabled={busy} onClick={onClose}>ยกเลิก</button><button className="btn-primary compact" type="submit" disabled={busy}>{busy ? 'กำลังบันทึก…' : editor.submitLabel}</button></div>
      </form>
    </section>
  </div>;
}

const tablePages: Record<Exclude<Page, 'dashboard' | 'employees' | 'reports'>, { title: string; eyebrow: string; description: string; columns: Array<{ label: string; value: (row: DataRow) => React.ReactNode }> }> = {
  licenses: { title: 'ใบอนุญาตพนักงาน', eyebrow: 'จัดการบุคลากร', description: 'ตรวจสอบประเภท เลขที่ สถานะ และวันหมดอายุใบอนุญาต', columns: [
    { label: 'พนักงาน', value: (row) => { const employee = nested(row.employee); return `${text(employee.firstName)} ${text(employee.lastName)}`; } },
    { label: 'รหัส', value: (row) => text(nested(row.employee).employeeCode) }, { label: 'ประเภท', value: (row) => text(row.licenseType) },
    { label: 'เลขที่ใบอนุญาต', value: (row) => text(row.licenseNumber) }, { label: 'วันหมดอายุ', value: (row) => date(row.expiryDate) },
    { label: 'สถานะ', value: (row) => <span className="status-badge active">{text(row.status)}</span> }
  ] },
  schedule: { title: 'ตารางกะ', eyebrow: 'ตารางและกฎการทำงาน', description: 'ตารางกะย้อนหลังเรียงจากวันที่ล่าสุด', columns: [
    { label: 'วันที่', value: (row) => date(row.workDate) }, { label: 'พนักงาน', value: (row) => text(row.employeeNameSnapshot) },
    { label: 'หน่วยงาน', value: (row) => text(row.departmentSnapshot) }, { label: 'กะ', value: (row) => text(nested(row.shiftType).code) },
    { label: 'เวลา', value: (row) => `${text(row.startTime)}–${text(row.endTime)}` }, { label: 'ชั่วโมง', value: (row) => text(row.hours) }
  ] },
  approvals: { title: 'อนุมัติตารางกะ', eyebrow: 'ตารางและกฎการทำงาน', description: 'ประวัติสถานะและ revision การอนุมัติตาราง', columns: [
    { label: 'เดือน', value: (row) => date(row.month) }, { label: 'Revision', value: (row) => text(row.revision) },
    { label: 'สถานะ', value: (row) => <span className="status-badge active">{text(row.status)}</span> },
    { label: 'ประเภทการเปลี่ยน', value: (row) => text(row.changeType) }, { label: 'อนุมัติเมื่อ', value: (row) => date(row.approvedAt) }, { label: 'หมายเหตุ', value: (row) => text(row.approvalNote) }
  ] },
  rules: { title: 'กฎการทำงาน', eyebrow: 'ตารางและกฎการทำงาน', description: 'กฎที่ใช้ตรวจสอบและจัดตารางกำลังคน', columns: [
    { label: 'รหัสกฎ', value: (row) => text(row.ruleId) }, { label: 'ชื่อกฎ', value: (row) => text(row.name) },
    { label: 'ค่า', value: (row) => text(row.value) }, { label: 'หน่วย', value: (row) => text(row.unit) },
    { label: 'สถานะ', value: (row) => <span className={row.enabled ? 'status-badge active' : 'status-badge inactive'}>{row.enabled ? 'เปิดใช้' : 'ปิดใช้'}</span> }
  ] },
  leave: { title: 'คำขอลา', eyebrow: 'การลา', description: 'ประวัติคำขอลาและสถานะการอนุมัติ', columns: [
    { label: 'พนักงาน', value: (row) => text(row.employeeNameSnapshot) }, { label: 'ประเภท', value: (row) => text(row.leaveType) },
    { label: 'วันที่เริ่ม', value: (row) => date(row.startDate) }, { label: 'วันที่สิ้นสุด', value: (row) => date(row.endDate) },
    { label: 'จำนวนวัน', value: (row) => text(row.dayCount) }, { label: 'สถานะ', value: (row) => <span className="status-badge active">{text(row.status)}</span> }
  ] },
  quota: { title: 'โควตาวันลา', eyebrow: 'การลา', description: 'สิทธิ์วันลาที่นำเข้าจากระบบเดิม', columns: [
    { label: 'พนักงาน', value: (row) => text(row.employeeNameSnapshot) }, { label: 'ลาป่วย', value: (row) => text(row.sickLeave) },
    { label: 'ลากิจ', value: (row) => text(row.personalLeave) }, { label: 'ลาพักร้อน', value: (row) => text(row.vacationLeave) },
    { label: 'การจับคู่ข้อมูล', value: (row) => text(row.matchStatus) }
  ] },
  users: { title: 'ผู้ใช้และสิทธิ์', eyebrow: 'ผู้ดูแลระบบ', description: 'บัญชี บทบาท สถานะ และข้อกำหนดเปลี่ยนรหัสผ่าน', columns: [
    { label: 'ชื่อผู้ใช้', value: (row) => text(row.displayName) }, { label: 'อีเมล', value: (row) => text(row.email) },
    { label: 'บทบาท', value: (row) => text(row.role) }, { label: 'สถานะบัญชี', value: (row) => text(row.accountStatus) },
    { label: 'เปลี่ยนรหัสผ่าน', value: (row) => row.passwordResetRequired ? 'จำเป็น' : 'ไม่จำเป็น' }
  ] },
  audit: { title: 'ประวัติการทำรายการ', eyebrow: 'ผู้ดูแลระบบ', description: 'เหตุการณ์สำคัญของระบบโดยไม่แสดง payload ที่อ่อนไหว', columns: [
    { label: 'เวลา', value: (row) => date(row.createdAt) }, { label: 'เหตุการณ์', value: (row) => text(row.action) },
    { label: 'ประเภทข้อมูล', value: (row) => text(row.entityType) }, { label: 'ผู้ดำเนินการ', value: (row) => text(nested(row.actor).displayName) }
  ] }
};

function OperationalTable({ page, response, loading, error, onPageChange, onAction, onCreate, canManage }: { page: Exclude<Page, 'dashboard' | 'employees' | 'reports'>; response: DataResponse; loading: boolean; error?: string; onPageChange(page: number): void; onAction(row: DataRow, action: string): void; onCreate(): void; canManage: boolean }) {
  const config = tablePages[page];
  const rows = Array.isArray(response.data) ? response.data : [];
  const actionPages = ['licenses', 'schedule', 'approvals', 'rules', 'leave', 'quota', 'users'];
  const rowActions = (row: DataRow) => {
    if (!canManage || !actionPages.includes(page)) return null;
    if (page === 'approvals') return <><button onClick={() => onAction(row, 'approve')}>อนุมัติ</button><button onClick={() => onAction(row, 'reject')}>ไม่อนุมัติ</button></>;
    if (page === 'leave') return <><button onClick={() => onAction(row, 'approve')}>อนุมัติ</button><button onClick={() => onAction(row, 'reject')}>ไม่อนุมัติ</button></>;
    if (page === 'rules') return <><button onClick={() => onAction(row, 'edit')}>แก้ไข</button><button onClick={() => onAction(row, 'toggle')}>{row.enabled ? 'ปิดใช้' : 'เปิดใช้'}</button></>;
    if (page === 'licenses') return <><button onClick={() => onAction(row, 'edit')}>แก้ไข</button><button className="danger-action" onClick={() => onAction(row, 'delete')}>ลบ</button></>;
    if (page === 'quota') return <button onClick={() => onAction(row, 'edit')}>แก้ไขโควตา</button>;
    if (page === 'schedule') return <><button onClick={() => onAction(row, 'edit')}>แก้ไข</button><button onClick={() => onAction(row, 'toggle-lock')}>{row.locked ? 'ปลดล็อก' : 'ล็อก'}</button><button className="danger-action" onClick={() => onAction(row, 'delete')}>ลบ</button></>;
    return <><button onClick={() => onAction(row, 'edit')}>สิทธิ์</button><button onClick={() => onAction(row, 'reset-password')}>ตั้งรหัสผ่าน</button><button onClick={() => onAction(row, 'toggle-user')}>{row.isActive ? 'ระงับ' : 'เปิดใช้'}</button></>;
  };
  const showActions = canManage && actionPages.includes(page);
  const canCreate = canManage && ['licenses', 'schedule', 'leave'].includes(page);
  return <section className="view-pane"><div className="page-heading"><div><p className="eyebrow">{config.eyebrow}</p><h1>{config.title}</h1><p>{config.description}</p></div><div className="heading-actions">{canCreate && <button className="btn-primary compact" onClick={onCreate}>+ เพิ่มรายการ</button>}<span className="record-chip">ทั้งหมด {response.meta?.total ?? rows.length} รายการ</span><button className="small-action" disabled={!rows.length} onClick={() => downloadCsv(rows, page)}>CSV</button><button className="small-action" onClick={() => window.print()}>พิมพ์ / PDF</button></div></div>{error && <div className="alert alert-error">{error}</div>}<div className="table-card">{loading ? <div className="loading-row">กำลังอ่านข้อมูล…</div> : <div className="table-scroll"><table className="data-table"><thead><tr>{config.columns.map((column) => <th key={column.label}>{column.label}</th>)}{showActions && <th>ดำเนินการ</th>}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={text(row.id) + index}>{config.columns.map((column) => <td key={column.label}>{column.value(row)}</td>)}{showActions && <td className="row-actions">{rowActions(row)}</td>}</tr>) : <tr><td colSpan={config.columns.length + (showActions ? 1 : 0)} className="no-rows">ไม่มีข้อมูลในหมวดนี้</td></tr>}</tbody></table></div>}</div>{response.meta?.totalPages && response.meta.totalPages > 1 && <div className="pagination-bar"><button disabled={(response.meta.page || 1) <= 1 || loading} onClick={() => onPageChange((response.meta?.page || 1) - 1)}>‹ ก่อนหน้า</button><span>หน้า {response.meta.page} จาก {response.meta.totalPages}</span><button disabled={(response.meta.page || 1) >= response.meta.totalPages || loading} onClick={() => onPageChange((response.meta?.page || 1) + 1)}>หน้าถัดไป ›</button></div>}</section>;
}

function Dashboard() {
  const auth = useContext(AuthContext)!;
  const [activePage, setActivePage] = useState<Page>('dashboard');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [empLoading, setEmpLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string>();
  const [search, setSearch] = useState('');
  const [operationResponse, setOperationResponse] = useState<DataResponse>({});
  const [operationLoading, setOperationLoading] = useState(false);
  const [operationError, setOperationError] = useState<string>();
  const [operationPage, setOperationPage] = useState(1);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [operationRefresh, setOperationRefresh] = useState(0);
  const [employeeRefresh, setEmployeeRefresh] = useState(0);
  const [shiftTypes, setShiftTypes] = useState<DataRow[]>([]);
  const [editor, setEditor] = useState<Editor>();
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState<string>();

  useEffect(() => {
    if (!auth.token) return;
    setEmpLoading(true);
    setFetchError(undefined);
    api.employees(auth.token)
      .then((result) => {
        const records = result?.data || [];
        setEmployees(records);
        setTotalCount(result?.meta?.total ?? records.length);
      })
      .catch((reason) => {
        setFetchError(reason instanceof Error ? reason.message : 'ไม่สามารถอ่านข้อมูลพนักงานได้');
        setEmployees([]);
        setTotalCount(0);
      })
      .finally(() => setEmpLoading(false));
  }, [auth.token, employeeRefresh]);

  useEffect(() => {
    if (!auth.token || activePage !== 'schedule') return;
    api.shiftTypes(auth.token).then((result) => setShiftTypes(result?.data || [])).catch(() => setShiftTypes([]));
  }, [activePage, auth.token]);

  useEffect(() => {
    if (!auth.token || activePage === 'dashboard' || activePage === 'employees') return;
    const loaders: Record<Exclude<Page, 'dashboard' | 'employees'>, (token: string, page: number) => Promise<DataResponse>> = {
      licenses: api.licenses, schedule: api.shifts, approvals: api.scheduleApprovals,
      rules: api.schedulingRules, leave: api.leaveRequests, quota: api.leaveQuotas,
      users: api.users, audit: api.auditEvents, reports: api.reportSummary
    };
    setOperationLoading(true);
    setOperationError(undefined);
    setOperationResponse({});
    loaders[activePage](auth.token, operationPage)
      .then((response) => setOperationResponse(response))
      .catch((reason) => setOperationError(reason instanceof Error ? reason.message : 'ไม่สามารถอ่านข้อมูลได้'))
      .finally(() => setOperationLoading(false));
  }, [activePage, auth.token, operationPage, operationRefresh]);

  useEffect(() => { setOperationPage(1); }, [activePage]);

  const filteredEmployees = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return employees;
    return employees.filter((employee) => [employee.employeeCode, employee.firstName, employee.lastName, employee.department, employee.jobTitle].filter(Boolean).join(' ').toLowerCase().includes(term));
  }, [employees, search]);

  const pageTitle = navigation.flatMap((section) => section.items).find((item) => item.id === activePage)?.label || 'Dashboard';
  const initials = auth.user?.displayName?.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'SM';
  const canManage = ['ADMIN', 'HR', 'MANAGER'].includes(auth.user?.role || '');
  const employeeOptions = employees.map((employee) => ({ value: employee.id, label: `${employee.employeeCode} · ${employee.firstName} ${employee.lastName}` }));
  const shiftTypeOptions = shiftTypes.map((shiftType) => ({ value: String(shiftType.id), label: `${text(shiftType.code)} · ${text(shiftType.name)}` }));

  const runEditor = (definition: Omit<Editor, 'submit'>, action: (values: Record<string, string>) => Promise<unknown>, refresh: 'employees' | 'operations' = 'operations') => {
    setEditorError(undefined);
    setEditor({
      ...definition,
      submit: async (values) => {
        setEditorBusy(true); setEditorError(undefined);
        try {
          await action(values);
          setEditor(undefined);
          if (refresh === 'employees') setEmployeeRefresh((value) => value + 1);
          else setOperationRefresh((value) => value + 1);
        } catch (reason) {
          setEditorError(reason instanceof Error ? reason.message : 'บันทึกข้อมูลไม่สำเร็จ');
        } finally { setEditorBusy(false); }
      }
    });
  };

  const employeeFields: FormField[] = [
    { name: 'employeeCode', label: 'รหัสพนักงาน', required: true }, { name: 'firstName', label: 'ชื่อ', required: true },
    { name: 'lastName', label: 'นามสกุล', required: true }, { name: 'email', label: 'อีเมล', type: 'email' },
    { name: 'phone', label: 'โทรศัพท์' }, { name: 'department', label: 'หน่วยงาน' },
    { name: 'jobTitle', label: 'ตำแหน่ง' }, { name: 'hiredAt', label: 'วันที่เริ่มงาน', type: 'date' }
  ];

  const openEmployeeEditor = (employee?: Employee) => {
    if (!auth.token) return;
    const values = employee ? Object.fromEntries(employeeFields.map((field) => [field.name, field.name === 'hiredAt' ? inputDate((employee as unknown as DataRow)[field.name]) : String((employee as unknown as DataRow)[field.name] || '')])) : {};
    runEditor(
      { title: employee ? 'แก้ไขข้อมูลพนักงาน' : 'เพิ่มพนักงาน', submitLabel: 'บันทึกพนักงาน', fields: employeeFields, values },
      (form) => employee ? api.updateEmployee(auth.token!, employee.id, formPayload(form, ['email', 'phone', 'department', 'jobTitle', 'hiredAt'])) : api.createEmployee(auth.token!, formPayload(form, ['email', 'phone', 'department', 'jobTitle', 'hiredAt'])),
      'employees'
    );
  };

  const openCreateOperation = () => {
    if (!auth.token) return;
    if (activePage === 'licenses') runEditor({
      title: 'เพิ่มใบอนุญาตพนักงาน', submitLabel: 'บันทึกใบอนุญาต',
      fields: [{ name: 'employeeId', label: 'พนักงาน', type: 'select', required: true, options: employeeOptions }, { name: 'licenseType', label: 'ประเภทใบอนุญาต', required: true }, { name: 'licenseNumber', label: 'เลขที่ใบอนุญาต' }, { name: 'issueDate', label: 'วันที่ออก', type: 'date' }, { name: 'expiryDate', label: 'วันหมดอายุ', type: 'date' }, { name: 'status', label: 'สถานะ' }, { name: 'remark', label: 'หมายเหตุ', type: 'textarea' }],
      values: {}
    }, (form) => api.createLicense(auth.token!, formPayload(form, ['licenseNumber', 'issueDate', 'expiryDate', 'status', 'remark'])));
    if (activePage === 'schedule') runEditor({
      title: 'เพิ่มตารางกะ', submitLabel: 'บันทึกกะ',
      fields: [{ name: 'employeeId', label: 'พนักงาน', type: 'select', required: true, options: employeeOptions }, { name: 'shiftTypeId', label: 'ประเภทกะ', type: 'select', required: true, options: shiftTypeOptions }, { name: 'workDate', label: 'วันที่', type: 'date', required: true }, { name: 'startTime', label: 'เวลาเริ่ม' }, { name: 'endTime', label: 'เวลาสิ้นสุด' }, { name: 'hours', label: 'จำนวนชั่วโมง', type: 'number', required: true }, { name: 'remark', label: 'หมายเหตุ', type: 'textarea' }],
      values: {}
    }, (form) => api.createShift(auth.token!, formPayload(form, ['startTime', 'endTime', 'remark'])));
    if (activePage === 'leave') runEditor({
      title: 'สร้างคำขอลา', submitLabel: 'ส่งคำขอลา',
      fields: [{ name: 'employeeId', label: 'พนักงาน', type: 'select', required: true, options: employeeOptions }, { name: 'leaveType', label: 'ประเภทการลา', required: true }, { name: 'startDate', label: 'วันที่เริ่ม', type: 'date', required: true }, { name: 'endDate', label: 'วันที่สิ้นสุด', type: 'date', required: true }, { name: 'dayCount', label: 'จำนวนวัน', type: 'number', required: true }, { name: 'reason', label: 'เหตุผล', type: 'textarea' }],
      values: {}
    }, (form) => api.createLeaveRequest(auth.token!, formPayload(form, ['reason'])));
  };

  const handleOperationAction = async (row: DataRow, action: string) => {
    if (!auth.token || !row.id) return;
    const id = String(row.id);
    if (action === 'edit') {
      if (activePage === 'licenses') runEditor({
        title: 'แก้ไขใบอนุญาต', submitLabel: 'บันทึกการแก้ไข',
        fields: [{ name: 'licenseType', label: 'ประเภทใบอนุญาต', required: true }, { name: 'licenseNumber', label: 'เลขที่ใบอนุญาต' }, { name: 'issueDate', label: 'วันที่ออก', type: 'date' }, { name: 'expiryDate', label: 'วันหมดอายุ', type: 'date' }, { name: 'status', label: 'สถานะ' }, { name: 'remark', label: 'หมายเหตุ', type: 'textarea' }],
        values: { licenseType: String(row.licenseType || ''), licenseNumber: String(row.licenseNumber || ''), issueDate: inputDate(row.issueDate), expiryDate: inputDate(row.expiryDate), status: String(row.status || ''), remark: String(row.remark || '') }
      }, (form) => api.updateLicense(auth.token!, id, formPayload(form, ['licenseNumber', 'issueDate', 'expiryDate', 'status', 'remark'])));
      else if (activePage === 'schedule') runEditor({
        title: 'แก้ไขตารางกะ', submitLabel: 'บันทึกการแก้ไข',
        fields: [{ name: 'employeeId', label: 'พนักงาน', type: 'select', required: true, options: employeeOptions }, { name: 'shiftTypeId', label: 'ประเภทกะ', type: 'select', required: true, options: shiftTypeOptions }, { name: 'workDate', label: 'วันที่', type: 'date', required: true }, { name: 'startTime', label: 'เวลาเริ่ม' }, { name: 'endTime', label: 'เวลาสิ้นสุด' }, { name: 'hours', label: 'จำนวนชั่วโมง', type: 'number', required: true }, { name: 'remark', label: 'หมายเหตุ', type: 'textarea' }],
        values: { employeeId: String(row.employeeId || ''), shiftTypeId: String(row.shiftTypeId || nested(row.shiftType).id || ''), workDate: inputDate(row.workDate), startTime: String(row.startTime || ''), endTime: String(row.endTime || ''), hours: String(row.hours || ''), remark: String(row.remark || '') }
      }, (form) => api.updateShift(auth.token!, id, formPayload(form, ['startTime', 'endTime', 'remark'])));
      else if (activePage === 'rules') runEditor({
        title: 'แก้ไขกฎการทำงาน', submitLabel: 'บันทึกกฎ',
        fields: [{ name: 'value', label: 'ค่า', required: true }, { name: 'unit', label: 'หน่วย' }],
        values: { value: String(row.value || ''), unit: String(row.unit || '') }
      }, (form) => api.updateSchedulingRule(auth.token!, id, formPayload(form, ['unit'])));
      else if (activePage === 'quota') runEditor({
        title: 'แก้ไขโควตาวันลา', submitLabel: 'บันทึกโควตา',
        fields: [{ name: 'sickLeave', label: 'ลาป่วย', type: 'number', required: true }, { name: 'personalLeave', label: 'ลากิจ', type: 'number', required: true }, { name: 'vacationLeave', label: 'ลาพักร้อน', type: 'number', required: true }],
        values: { sickLeave: String(row.sickLeave || '0'), personalLeave: String(row.personalLeave || '0'), vacationLeave: String(row.vacationLeave || '0') }
      }, (form) => api.updateLeaveQuota(auth.token!, id, form));
      else if (activePage === 'users') runEditor({
        title: 'แก้ไขผู้ใช้และสิทธิ์', submitLabel: 'บันทึกสิทธิ์',
        fields: [{ name: 'role', label: 'บทบาท', type: 'select', required: true, options: ['ADMIN', 'HR', 'MANAGER', 'VIEWER', 'USER'].map((value) => ({ value, label: value })) }, { name: 'accountStatus', label: 'สถานะบัญชี', type: 'select', required: true, options: ['ACTIVE', 'PENDING', 'SUSPENDED', 'REJECTED'].map((value) => ({ value, label: value })) }],
        values: { role: String(row.role || ''), accountStatus: String(row.accountStatus || '') }
      }, (form) => api.updateUser(auth.token!, id, form));
      return;
    }
    if (action === 'reset-password') {
      runEditor({
        title: 'ตั้งรหัสผ่านใหม่', submitLabel: 'ตั้งรหัสผ่านและยกเลิก session เดิม',
        fields: [{ name: 'newPassword', label: 'รหัสผ่านใหม่ (อย่างน้อย 12 ตัวอักษร)', type: 'password', required: true }],
        values: {}
      }, (form) => api.resetUserPassword(auth.token!, id, form.newPassword));
      return;
    }
    if (!window.confirm('ยืนยันการดำเนินการนี้ในฐานข้อมูล staging?')) return;
    setOperationLoading(true); setOperationError(undefined);
    try {
      if (action === 'delete' && activePage === 'licenses') await api.deleteLicense(auth.token, id);
      else if (action === 'delete' && activePage === 'schedule') await api.deleteShift(auth.token, id);
      else if (activePage === 'approvals') await api.updateScheduleApproval(auth.token, id, { status: action === 'approve' ? 'APPROVED' : 'REJECTED' });
      else if (activePage === 'leave') await api.updateLeaveRequest(auth.token, id, { status: action === 'approve' ? 'APPROVED' : 'REJECTED' });
      else if (activePage === 'rules') await api.updateSchedulingRule(auth.token, id, { enabled: !row.enabled });
      else if (activePage === 'schedule') await api.updateShift(auth.token, id, { locked: !row.locked });
      else if (activePage === 'users') await api.updateUser(auth.token, id, { isActive: !row.isActive, accountStatus: row.isActive ? 'SUSPENDED' : 'ACTIVE' });
      setOperationRefresh((value) => value + 1);
    } catch (reason) { setOperationError(reason instanceof Error ? reason.message : 'ดำเนินการไม่สำเร็จ'); }
    finally { setOperationLoading(false); }
  };

  const content = () => {
    if (activePage === 'dashboard') return (
      <section className="view-pane">
        <div className="page-heading"><div><p className="eyebrow">ภาพรวมระบบ</p><h1>Dashboard</h1><p>ติดตามข้อมูลกำลังคนและการปฏิบัติงานจากระบบเดียว</p></div><span className="live-status"><i /> ระบบพร้อมใช้งาน</span></div>
        <div className="metrics-grid">
          <article className="metric-card"><span className="metric-icon blue">♙</span><div><p>พนักงานทั้งหมด</p><strong>{empLoading ? '…' : totalCount}</strong><small>ข้อมูลจากฐานข้อมูลกลาง</small></div></article>
          <article className="metric-card"><span className="metric-icon violet">▤</span><div><p>ตารางกะย้อนหลัง</p><strong>2,193</strong><small>ย้ายจากระบบเดิมแล้ว</small></div></article>
          <article className="metric-card"><span className="metric-icon green">◷</span><div><p>คำขอลาย้อนหลัง</p><strong>1</strong><small>พร้อมสำหรับหน้าการลา</small></div></article>
          <article className="metric-card"><span className="metric-icon amber">▣</span><div><p>ใบอนุญาตพนักงาน</p><strong>63</strong><small>รายการรอย้ายเอกสารแนบ</small></div></article>
        </div>
        <section className="dashboard-card"><div><h2>เริ่มต้นใช้งาน</h2><p>เลือกเมนูทางซ้ายเพื่อจัดการพนักงาน ตรวจสอบกะงาน และติดตามกระบวนการอนุมัติ</p></div><button className="btn-secondary" onClick={() => setActivePage('employees')}>ดูรายชื่อพนักงาน</button></section>
      </section>
    );
    if (activePage === 'employees') return (
      <section className="view-pane">
        <div className="page-heading"><div><p className="eyebrow">จัดการบุคลากร</p><h1>พนักงาน</h1><p>รายชื่อพนักงานทั้งหมด {totalCount} รายการ</p></div><div className="heading-actions">{canManage && <button className="btn-primary compact" onClick={() => openEmployeeEditor()}>+ เพิ่มพนักงาน</button>}<span className="record-chip">ฐานข้อมูลกลาง</span></div></div>
        <div className="toolbar"><label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหารหัส ชื่อ หน่วยงาน หรือตำแหน่ง" /></label><span className="toolbar-count">แสดง {filteredEmployees.length} จาก {totalCount} รายการ</span></div>
        {fetchError && <div className="alert alert-error" role="alert">{fetchError}</div>}
        <div className="table-card">
          {empLoading ? <div className="loading-row">กำลังอ่านข้อมูลพนักงาน…</div> : <div className="table-scroll"><table className="data-table"><thead><tr><th>รหัสพนักงาน</th><th>ชื่อ-นามสกุล</th><th>หน่วยงาน</th><th>ตำแหน่ง</th><th>สถานะ</th>{canManage && <th>ดำเนินการ</th>}</tr></thead><tbody>{filteredEmployees.length ? filteredEmployees.map((employee) => <tr key={employee.id}><td><code>{employee.employeeCode}</code></td><td className="employee-name">{employee.firstName} {employee.lastName}</td><td>{employee.department || '-'}</td><td>{employee.jobTitle || '-'}</td><td><span className={employee.isActive ? 'status-badge active' : 'status-badge inactive'}>{employee.isActive ? 'ใช้งาน' : 'ไม่ใช้งาน'}</span></td>{canManage && <td className="row-actions"><button onClick={() => openEmployeeEditor(employee)}>แก้ไข</button>{auth.user?.role === 'ADMIN' && <button className="danger-action" onClick={async () => { if (!auth.token || !window.confirm('ยืนยันการปิดใช้งานพนักงานรายการนี้?')) return; try { await api.deleteEmployee(auth.token, employee.id); setEmployeeRefresh((value) => value + 1); } catch (reason) { setFetchError(reason instanceof Error ? reason.message : 'ปิดใช้งานพนักงานไม่สำเร็จ'); } }}>ปิดใช้งาน</button>}</td>}</tr>) : <tr><td colSpan={canManage ? 6 : 5} className="no-rows">ไม่พบรายการที่ตรงกับคำค้นหา</td></tr>}</tbody></table></div>}
        </div>
      </section>
    );
    if (activePage === 'reports') {
      const summary = !Array.isArray(operationResponse.data) ? operationResponse.data || {} : {};
      const cards: Array<[string, unknown]> = [['พนักงานทั้งหมด', summary.employees], ['พนักงานที่ใช้งาน', summary.activeEmployees], ['ใบอนุญาต', summary.licenses], ['รายการกะ', summary.shifts], ['คำขอลา', summary.leaveRequests], ['โควตาวันลา', summary.leaveQuotas], ['บัญชีผู้ใช้', summary.users]];
      return <section className="view-pane"><div className="page-heading"><div><p className="eyebrow">รายงาน</p><h1>รายงานและส่งออก</h1><p>ยอดรวมจากฐานข้อมูลกลาง ณ เวลาที่เปิดหน้านี้</p></div></div>{operationError && <div className="alert alert-error">{operationError}</div>}<div className="metrics-grid report-grid">{operationLoading ? <div className="loading-row">กำลังสรุปข้อมูล…</div> : cards.map(([label, value]) => <article className="metric-card" key={String(label)}><span className="metric-icon blue">▦</span><div><p>{label}</p><strong>{text(value)}</strong><small>รายการใน staging</small></div></article>)}</div></section>;
    }
    return <OperationalTable page={activePage} response={operationResponse} loading={operationLoading} error={operationError} onPageChange={setOperationPage} onAction={handleOperationAction} onCreate={openCreateOperation} canManage={canManage} />;
  };

  return (
    <div className="app-shell">
      {editor && <EditDialog editor={editor} busy={editorBusy} error={editorError} onClose={() => { setEditor(undefined); setEditorError(undefined); }} />}
      {mobileMenuOpen && <button className="sidebar-overlay" aria-label="ปิดเมนู" onClick={() => setMobileMenuOpen(false)} />}
      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-brand"><Logo /><div><strong>Security Management</strong><span>System v3</span></div></div>
        <nav className="nav-menu" aria-label="เมนูหลัก">{navigation.map((section) => <div className="nav-section" key={section.label}><p>{section.label}</p>{section.items.map((item) => <button type="button" key={item.id} className={`nav-item ${activePage === item.id ? 'active' : ''}`} onClick={() => { setActivePage(item.id); setMobileMenuOpen(false); }}><span className="nav-icon">{item.icon}</span><span>{item.label}</span></button>)}</div>)}</nav>
        <button className="sidebar-user" onClick={() => auth.logout()} title="ออกจากระบบ"><span className="avatar">{initials}</span><span><b>{auth.user?.displayName || 'ผู้ใช้งาน'}</b><small>{auth.user?.role || 'USER'} · ออกจากระบบ</small></span><i>↗</i></button>
      </aside>
      <main className="main-area">
        <header className="topbar"><div className="topbar-left"><button className="mobile-menu-button" aria-label="เปิดเมนู" onClick={() => setMobileMenuOpen(true)}>☰</button><span className="mobile-brand"><Logo /> SMS v3</span><span className="breadcrumb">ระบบบริหารงานรักษาความปลอดภัย <b>/</b> {pageTitle}</span></div><div className="topbar-actions"><span className="environment-pill">STAGING</span><button className="signout-button" onClick={() => auth.logout()}>ออกจากระบบ</button></div></header>
        <div className="content-area">{content()}</div>
      </main>
    </div>
  );
}

function App() {
  const auth = useContext(AuthContext)!;
  if (auth.loading) return <div className="full-loader">กำลังเตรียมระบบ…</div>;
  return auth.token ? <Dashboard /> : <Login />;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthProvider><App /></AuthProvider></React.StrictMode>);
