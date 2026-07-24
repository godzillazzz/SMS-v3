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
const nested = (value: unknown): DataRow => value && typeof value === 'object' ? value as DataRow : {};

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

function OperationalTable({ page, response, loading, error, onPageChange }: { page: Exclude<Page, 'dashboard' | 'employees' | 'reports'>; response: DataResponse; loading: boolean; error?: string; onPageChange(page: number): void }) {
  const config = tablePages[page];
  const rows = Array.isArray(response.data) ? response.data : [];
  return <section className="view-pane"><div className="page-heading"><div><p className="eyebrow">{config.eyebrow}</p><h1>{config.title}</h1><p>{config.description}</p></div><span className="record-chip">ทั้งหมด {response.meta?.total ?? rows.length} รายการ</span></div>{error && <div className="alert alert-error">{error}</div>}<div className="table-card">{loading ? <div className="loading-row">กำลังอ่านข้อมูล…</div> : <div className="table-scroll"><table className="data-table"><thead><tr>{config.columns.map((column) => <th key={column.label}>{column.label}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={text(row.id) + index}>{config.columns.map((column) => <td key={column.label}>{column.value(row)}</td>)}</tr>) : <tr><td colSpan={config.columns.length} className="no-rows">ไม่มีข้อมูลในหมวดนี้</td></tr>}</tbody></table></div>}</div>{response.meta?.totalPages && response.meta.totalPages > 1 && <div className="pagination-bar"><button disabled={(response.meta.page || 1) <= 1 || loading} onClick={() => onPageChange((response.meta?.page || 1) - 1)}>‹ ก่อนหน้า</button><span>หน้า {response.meta.page} จาก {response.meta.totalPages}</span><button disabled={(response.meta.page || 1) >= response.meta.totalPages || loading} onClick={() => onPageChange((response.meta?.page || 1) + 1)}>หน้าถัดไป ›</button></div>}</section>;
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
  }, [auth.token]);

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
  }, [activePage, auth.token, operationPage]);

  useEffect(() => { setOperationPage(1); }, [activePage]);

  const filteredEmployees = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return employees;
    return employees.filter((employee) => [employee.employeeCode, employee.firstName, employee.lastName, employee.department, employee.jobTitle].filter(Boolean).join(' ').toLowerCase().includes(term));
  }, [employees, search]);

  const pageTitle = navigation.flatMap((section) => section.items).find((item) => item.id === activePage)?.label || 'Dashboard';
  const initials = auth.user?.displayName?.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'SM';

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
        <div className="page-heading"><div><p className="eyebrow">จัดการบุคลากร</p><h1>พนักงาน</h1><p>รายชื่อพนักงานทั้งหมด {totalCount} รายการ</p></div><span className="record-chip">ฐานข้อมูลกลาง</span></div>
        <div className="toolbar"><label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหารหัส ชื่อ หน่วยงาน หรือตำแหน่ง" /></label><span className="toolbar-count">แสดง {filteredEmployees.length} จาก {totalCount} รายการ</span></div>
        {fetchError && <div className="alert alert-error" role="alert">{fetchError}</div>}
        <div className="table-card">
          {empLoading ? <div className="loading-row">กำลังอ่านข้อมูลพนักงาน…</div> : <div className="table-scroll"><table className="data-table"><thead><tr><th>รหัสพนักงาน</th><th>ชื่อ-นามสกุล</th><th>หน่วยงาน</th><th>ตำแหน่ง</th><th>สถานะ</th></tr></thead><tbody>{filteredEmployees.length ? filteredEmployees.map((employee) => <tr key={employee.id}><td><code>{employee.employeeCode}</code></td><td className="employee-name">{employee.firstName} {employee.lastName}</td><td>{employee.department || '-'}</td><td>{employee.jobTitle || '-'}</td><td><span className={employee.isActive ? 'status-badge active' : 'status-badge inactive'}>{employee.isActive ? 'ใช้งาน' : 'ไม่ใช้งาน'}</span></td></tr>) : <tr><td colSpan={5} className="no-rows">ไม่พบรายการที่ตรงกับคำค้นหา</td></tr>}</tbody></table></div>}
        </div>
      </section>
    );
    if (activePage === 'reports') {
      const summary = !Array.isArray(operationResponse.data) ? operationResponse.data || {} : {};
      const cards: Array<[string, unknown]> = [['พนักงานทั้งหมด', summary.employees], ['พนักงานที่ใช้งาน', summary.activeEmployees], ['ใบอนุญาต', summary.licenses], ['รายการกะ', summary.shifts], ['คำขอลา', summary.leaveRequests], ['โควตาวันลา', summary.leaveQuotas], ['บัญชีผู้ใช้', summary.users]];
      return <section className="view-pane"><div className="page-heading"><div><p className="eyebrow">รายงาน</p><h1>รายงานและส่งออก</h1><p>ยอดรวมจากฐานข้อมูลกลาง ณ เวลาที่เปิดหน้านี้</p></div></div>{operationError && <div className="alert alert-error">{operationError}</div>}<div className="metrics-grid report-grid">{operationLoading ? <div className="loading-row">กำลังสรุปข้อมูล…</div> : cards.map(([label, value]) => <article className="metric-card" key={String(label)}><span className="metric-icon blue">▦</span><div><p>{label}</p><strong>{text(value)}</strong><small>รายการใน staging</small></div></article>)}</div></section>;
    }
    return <OperationalTable page={activePage} response={operationResponse} loading={operationLoading} error={operationError} onPageChange={setOperationPage} />;
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><Logo /><div><strong>Security Management</strong><span>System v3</span></div></div>
        <nav className="nav-menu" aria-label="เมนูหลัก">{navigation.map((section) => <div className="nav-section" key={section.label}><p>{section.label}</p>{section.items.map((item) => <button type="button" key={item.id} className={`nav-item ${activePage === item.id ? 'active' : ''}`} onClick={() => setActivePage(item.id)}><span className="nav-icon">{item.icon}</span><span>{item.label}</span></button>)}</div>)}</nav>
        <button className="sidebar-user" onClick={() => auth.logout()} title="ออกจากระบบ"><span className="avatar">{initials}</span><span><b>{auth.user?.displayName || 'ผู้ใช้งาน'}</b><small>{auth.user?.role || 'USER'} · ออกจากระบบ</small></span><i>↗</i></button>
      </aside>
      <main className="main-area">
        <header className="topbar"><div><span className="mobile-brand"><Logo /> SMS v3</span><span className="breadcrumb">ระบบบริหารงานรักษาความปลอดภัย <b>/</b> {pageTitle}</span></div><div className="topbar-actions"><span className="environment-pill">STAGING</span><button className="signout-button" onClick={() => auth.logout()}>ออกจากระบบ</button></div></header>
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
