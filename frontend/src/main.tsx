import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api';
import './styles.css';

type User = { id: string; email: string; displayName: string; role: string };
type Employee = { id: string; employeeCode: string; firstName: string; lastName: string; department?: string; jobTitle?: string; isActive: boolean };
type Page = 'dashboard' | 'employees' | 'licenses' | 'schedule' | 'approvals' | 'rules' | 'leave' | 'quota' | 'users' | 'audit' | 'reports';
type Auth = { token?: string; user?: User; loading: boolean; error?: string; login(email: string, password: string): Promise<void>; logout(): Promise<void> };

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

function Placeholder({ title, description }: { title: string; description: string }) {
  return <section className="view-pane empty-pane"><span className="empty-icon">◌</span><h1>{title}</h1><p>{description}</p><div className="migration-note"><strong>สถานะข้อมูล:</strong> โครงสร้างและข้อมูลเดิมถูกย้ายเข้าสู่ staging แล้ว หน้าการใช้งานและ API ของเมนูนี้กำลังย้ายจากระบบเดิมโดยรักษากฎธุรกิจเดิม</div></section>;
}

function Dashboard() {
  const auth = useContext(AuthContext)!;
  const [activePage, setActivePage] = useState<Page>('dashboard');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [empLoading, setEmpLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string>();
  const [search, setSearch] = useState('');

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
    const placeholders: Record<Exclude<Page, 'dashboard' | 'employees'>, [string, string]> = {
      licenses: ['ใบอนุญาตพนักงาน', 'จัดการข้อมูลใบอนุญาต วันหมดอายุ และสถานะเอกสาร'],
      schedule: ['ตารางกะ', 'จัดการตารางกะรายเดือน ตรวจสอบกำลังคน และกะย้อนหลัง'],
      approvals: ['อนุมัติตารางกะ', 'ตรวจสอบและอนุมัติการเปลี่ยนแปลงตารางกะ'],
      rules: ['กฎการทำงาน', 'ตั้งค่าและตรวจสอบกฎชั่วโมงทำงาน การพัก และคุณสมบัติใบอนุญาต'],
      leave: ['คำขอลา', 'ส่ง ตรวจสอบ และอนุมัติคำขอลาพนักงาน'],
      quota: ['โควตาวันลา', 'ติดตามสิทธิ์วันลาของพนักงานแต่ละราย'],
      users: ['ผู้ใช้และสิทธิ์', 'บริหารบัญชีผู้ใช้ บทบาท และสถานะการอนุมัติ'],
      audit: ['ประวัติการทำรายการ', 'ตรวจสอบเหตุการณ์ด้านความปลอดภัยและการเปลี่ยนแปลงข้อมูล'],
      reports: ['รายงานและส่งออก', 'สรุปตารางกะ การลา และข้อมูลกำลังคนสำหรับการส่งออก']
    };
    const [title, description] = placeholders[activePage as Exclude<Page, 'dashboard' | 'employees'>];
    return <Placeholder title={title} description={description} />;
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
