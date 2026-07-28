import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, setTokenRefreshHandler } from './api';
import './styles.css';

type User = { id: string; email: string; displayName: string; role: string; department?: string };
type Employee = { id: string; employeeCode: string; firstName: string; lastName: string; department?: string; jobTitle?: string; isActive: boolean };
type RegistrationEmployee = { id: string; employeeCode: string; displayName: string; department?: string; jobTitle?: string };
type Page = 'dashboard' | 'employees' | 'licenses' | 'shiftSetup' | 'schedule' | 'approvals' | 'rules' | 'leave' | 'leavePending' | 'leaveHistory' | 'quota' | 'users' | 'audit' | 'reports' | 'settings';
type Auth = { token?: string; user?: User; originalUser?: User; loading: boolean; error?: string; isViewingAs: boolean; login(email: string, password: string): Promise<void>; logout(): Promise<void>; beginViewAs(userId: string): Promise<void>; endViewAs(): void };
type DataRow = Record<string, unknown>;
type DataResponse = { data?: DataRow[] | DataRow; meta?: { total?: number; page?: number; totalPages?: number } };
type FormField = { name: string; label: string; type?: 'text' | 'email' | 'password' | 'date' | 'number' | 'select' | 'textarea' | 'file'; required?: boolean; accept?: string; hint?: string; options?: Array<{ value: string; label: string }> };
type Editor = { title: string; submitLabel: string; fields: FormField[]; values: Record<string, string>; submit(values: Record<string, string>, files: Record<string, File>): Promise<void> };

const AuthContext = createContext<Auth | undefined>(undefined);

const navigation: Array<{ label: string; items: Array<{ id: Page; icon: string; label: string }> }> = [
  { label: 'ภาพรวม', items: [
    { id: 'dashboard', icon: '⌂', label: 'Dashboard' }
  ] },
  { label: 'พนักงาน', items: [
    { id: 'employees', icon: '♙', label: 'ข้อมูลพนักงาน' },
    { id: 'licenses', icon: '▣', label: 'ใบอนุญาต รปภ.' }
  ] },
  { label: 'ตารางกะ', items: [
    { id: 'schedule', icon: '▤', label: 'ตารางกะรายเดือน' },
    { id: 'shiftSetup', icon: '◷', label: 'รหัสกะและเวลา' }
  ] },
  { label: 'การลา', items: [
    { id: 'leave', icon: '▥', label: 'คำขอลา' },
    { id: 'leavePending', icon: '⏳', label: 'รออนุมัติ' },
    { id: 'leaveHistory', icon: '▤', label: 'ประวัติการลาทั้งหมด' },
    { id: 'quota', icon: '▧', label: 'โควต้าวันลา' }
  ] },
  { label: 'ตรวจสอบ', items: [
    { id: 'rules', icon: '!', label: 'กฎการทำงาน' },
    { id: 'audit', icon: '◌', label: 'Audit Log' }
  ] },
  { label: 'ผู้ใช้และสิทธิ์', items: [
    { id: 'users', icon: '♧', label: 'ผู้ใช้และสิทธิ์' }
  ] },
  { label: 'รายงาน', items: [
    { id: 'reports', icon: '↗', label: 'รายงานและ Export' }
  ] },
  { label: 'ตั้งค่า', items: [
    { id: 'settings', icon: '⚙', label: 'ตั้งค่าระบบ' }
  ] }
];

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string>();
  const [user, setUser] = useState<User>();
  const [viewAs, setViewAs] = useState<{ token: string; user: User }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = async () => {
    const result = await api.refresh();
    setToken(result.accessToken);
    setUser(result.user);
    setViewAs(undefined);
  };

  useEffect(() => {
    setTokenRefreshHandler((newToken, newUser) => {
      setToken(newToken);
      if (newUser) setUser(newUser);
    });
    refresh().catch(() => undefined).finally(() => setLoading(false));
    return () => setTokenRefreshHandler(null);
  }, []);

  const login = async (email: string, password: string) => {
    setError(undefined);
    try {
      const result = await api.login(email, password);
      setToken(result.accessToken);
      setUser(result.user);
      setViewAs(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ไม่สามารถเข้าสู่ระบบได้');
      throw reason;
    }
  };

  const logout = async () => {
    await api.logout();
    setToken(undefined);
    setUser(undefined);
    setViewAs(undefined);
  };

  const beginViewAs = async (userId: string) => {
    if (!token || user?.role !== 'ADMIN') throw new Error('View As requires an Admin account.');
    const result = await api.viewAsUser(token, userId);
    setViewAs({ token: result.data.accessToken, user: result.data.user });
  };

  const endViewAs = () => setViewAs(undefined);

  return <AuthContext.Provider value={{ token: viewAs?.token || token, user: viewAs?.user || user, originalUser: user, loading, error, isViewingAs: Boolean(viewAs), login, logout, beginViewAs, endViewAs }}>{children}</AuthContext.Provider>;
}

function Logo() {
  return <span className="brand-mark" aria-label="SMS v3"><span aria-hidden="true">◈</span><b>SMS</b></span>;
}

function PersonnelDetailDrawer({ employee, canManage, onClose, onEdit }: { employee?: Employee; canManage: boolean; onClose(): void; onEdit(): void }) {
  if (!employee) return null;
  const fullName = `${employee.firstName} ${employee.lastName}`.trim();
  const detailRows = [
    ['รหัสพนักงาน', employee.employeeCode],
    ['หน่วยงาน', employee.department || 'ไม่ระบุ'],
    ['ตำแหน่ง', employee.jobTitle || 'ไม่ระบุ'],
    ['สถานะการทำงาน', employee.isActive ? 'ใช้งาน' : 'ไม่ใช้งาน']
  ];
  return <div className="detail-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="personnel-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="personnel-drawer-title">
      <header className="drawer-header">
        <div className="drawer-personnel-identity"><span className="drawer-avatar" aria-hidden="true">{fullName.split(/\s+/).map((value) => value[0]).join('').slice(0, 2) || 'SM'}</span><div><p>Personnel profile</p><h2 id="personnel-drawer-title">{fullName || 'พนักงาน'}</h2><span>{employee.employeeCode}</span></div></div>
        <button type="button" className="drawer-close" aria-label="ปิดรายละเอียดพนักงาน" onClick={onClose}>×</button>
      </header>
      <div className="drawer-tabs" role="tablist" aria-label="รายละเอียดพนักงาน"><span role="tab" aria-selected="true">ภาพรวม</span><span role="tab" aria-disabled="true">การทำงาน</span><span role="tab" aria-disabled="true">สิทธิ์และ Audit</span></div>
      <section className="drawer-section" aria-labelledby="personnel-overview-title"><h3 id="personnel-overview-title">ข้อมูลพนักงาน</h3><dl>{detailRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
      <section className="drawer-section drawer-notice"><h3>การเข้าถึง</h3><p>แสดงเฉพาะข้อมูลที่บัญชีปัจจุบันได้รับอนุญาตให้เห็น</p></section>
      <footer className="drawer-actions"><button type="button" className="small-action" onClick={onClose}>ปิด</button>{canManage && <button type="button" className="btn-primary compact" onClick={onEdit}>แก้ไขข้อมูล</button>}</footer>
    </aside>
  </div>;
}

function MonthGridPicker({ value, onChange }: { value: string; onChange(value: string): void }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(value.split('-')[0]) || new Date().getFullYear());
  const selectedYear = Number(value.split('-')[0]) || year;
  const selectedMonth = Number(value.split('-')[1]) || 1;
  const selectedDate = new Date(Date.UTC(selectedYear, selectedMonth - 1, 1));
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(selectedDate);
  const monthNames = Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(year, index, 1))));
  const choose = (monthIndex: number) => {
    onChange(`${year}-${String(monthIndex + 1).padStart(2, '0')}`);
    setOpen(false);
  };

  useEffect(() => {
    const nextYear = Number(value.split('-')[0]);
    if (nextYear && nextYear !== year) setYear(nextYear);
  }, [value]);

    return <div className="month-grid-picker">
    <button type="button" className="month-grid-trigger" onClick={() => setOpen((visible) => !visible)} aria-expanded={open}>
      <span>{monthLabel}, {selectedYear}</span><b>⌄</b>
    </button>
    {open && <div className="month-grid-panel">
      <div className="month-grid-year">
        <strong>{year}</strong>
        <span><button type="button" onClick={() => setYear((current) => current - 1)}>▲</button><button type="button" onClick={() => setYear((current) => current + 1)}>▼</button></span>
      </div>
      <div className="month-grid">
        {monthNames.map((name, index) => {
          const selected = year === selectedYear && index + 1 === selectedMonth;
          return <button type="button" key={name} className={selected ? 'selected' : ''} onClick={() => choose(index)}>{name}</button>;
        })}
      </div>
    </div>}
  </div>;
}

function Login() {
  const auth = useContext(AuthContext)!;
  const [mode, setMode] = useState<'login' | 'register' | 'registerVerify' | 'reset' | 'resetVerify'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [registrationEmployeeId, setRegistrationEmployeeId] = useState('');
  const [registrationEmployees, setRegistrationEmployees] = useState<RegistrationEmployee[]>([]);
  const [registrationEmployeesLoading, setRegistrationEmployeesLoading] = useState(false);
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formMessage, setFormMessage] = useState<string>();
  const [formError, setFormError] = useState<string>();

  const resetView = (next: typeof mode) => { setMode(next); setFormError(undefined); setFormMessage(undefined); setCode(''); if (next !== 'register') setRegistrationEmployeeId(''); };
  const title = mode === 'login' ? 'ยินดีต้อนรับ' : mode === 'register' ? 'ลงทะเบียนเข้าใช้ระบบ' : mode === 'registerVerify' ? 'ยืนยันอีเมล' : mode === 'reset' ? 'รีเซ็ตรหัสผ่านด้วย OTP' : 'ตั้งรหัสผ่านใหม่';
  const lead = mode === 'login' ? 'เข้าสู่ระบบเพื่อเปิด Dashboard' : mode === 'register' ? 'เลือกชื่อพนักงานและยืนยันอีเมลก่อนให้ Admin อนุมัติ' : mode === 'registerVerify' ? 'กรอกรหัส 6 หลักที่ส่งไปยังอีเมลของคุณ' : mode === 'reset' ? 'เราจะส่งรหัสยืนยันไปยังอีเมลของคุณ' : 'กรอกรหัส 6 หลักและรหัสผ่านใหม่';

  useEffect(() => {
    if (mode !== 'register') return;
    let active = true;
    setRegistrationEmployeesLoading(true);
    api.registrationEmployees()
      .then((result) => { if (active) setRegistrationEmployees(Array.isArray(result.data) ? result.data : []); })
      .catch((reason) => { if (active) setFormError(reason instanceof Error ? reason.message : 'โหลดรายชื่อพนักงานไม่สำเร็จ'); })
      .finally(() => { if (active) setRegistrationEmployeesLoading(false); });
    return () => { active = false; };
  }, [mode]);

  const registrationEmployeeOptions = registrationEmployees.map((employee) => {
    const details = [employee.employeeCode, employee.department, employee.jobTitle].filter(Boolean).join(' · ');
    return { value: employee.id, label: `${employee.displayName}${details ? ` (${details})` : ''}` };
  });
  const submitDisabled = busy || (mode === 'register' && (registrationEmployeesLoading || !registrationEmployeeId));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(undefined); setFormMessage(undefined);
    if (mode === 'register' && !registrationEmployeeId) { setFormError('กรุณาเลือกชื่อพนักงานของคุณ'); return; }
    setBusy(true);
    try {
      if (mode === 'login') await auth.login(email, password);
      else if (mode === 'register') { await api.requestRegistrationOtp({ employeeId: registrationEmployeeId, email, password }); resetView('registerVerify'); setFormMessage('ส่งรหัสยืนยันแล้ว โปรดตรวจกล่องจดหมายของคุณ'); }
      else if (mode === 'registerVerify') { const result = await api.verifyRegistrationOtp(email, code); resetView('login'); setPassword(''); setFormMessage(result.message); }
      else if (mode === 'reset') { await api.requestPasswordResetOtp(email); resetView('resetVerify'); setFormMessage('หากอีเมลนี้ใช้งานได้ ระบบได้ส่งรหัสยืนยันแล้ว'); }
      else { const result = await api.completePasswordReset(email, code, password); resetView('login'); setPassword(''); setFormMessage(result.message); }
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : 'ไม่สามารถดำเนินการได้'); }
    finally { setBusy(false); }
  };

  return (
    <main className="login-page">
      <section className="login-shell" aria-label="เข้าสู่ระบบ Security Management System">
        <aside className="login-intro">
          <div className="intro-brand"><Logo /><strong>Security Management System</strong></div>
          <div className="intro-copy">
            <h1>ระบบบริหาร<br />งานรักษาความปลอดภัย</h1>
            <p>บริหารพนักงาน ตารางกะ และกฎการทำงาน ในพื้นที่เดียว</p>
            <span className="intro-check"><i aria-hidden="true">✓</i><span>ข้อมูลและสิทธิ์ผู้ใช้ถูกปกป้องตามนโยบายระบบ</span></span>
          </div>
        </aside>
        <section className="login-form-panel">
          <form className="login-form" onSubmit={submit}>
            <h2>{title}</h2>
            <p className="form-lead">{lead}</p>
            {(formError || (mode === 'login' ? auth.error : undefined)) && <div className="alert alert-error" role="alert">{formError || auth.error}</div>}
            {formMessage && <div className="login-help-action" role="status">{formMessage}</div>}
            {mode === 'register' && <label className="field-group" htmlFor="registration-employee"><span>ชื่อพนักงาน</span><select id="registration-employee" value={registrationEmployeeId} onChange={(event) => setRegistrationEmployeeId(event.target.value)} required disabled={registrationEmployeesLoading}><option value="">{registrationEmployeesLoading ? 'กำลังโหลดรายชื่อพนักงาน...' : '-- เลือกชื่อของคุณ --'}</option>{registrationEmployeeOptions.map((employee) => <option key={employee.value} value={employee.value}>{employee.label}</option>)}</select>{!registrationEmployeesLoading && !registrationEmployeeOptions.length && <small className="field-hint">ไม่มีรายชื่อพนักงานที่เปิดให้สมัคร หากเคยสมัครแล้วให้ติดต่อ Admin เพื่ออนุมัติ/รีเซ็ตรหัสผ่าน</small>}</label>}
            <label className="field-group" htmlFor="email">
              <span>อีเมล</span>
              <input id="email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="name@company.com" required autoComplete="username" />
            </label>
            {(mode === 'registerVerify' || mode === 'resetVerify') && <label className="field-group" htmlFor="otp-code"><span>รหัส OTP 6 หลัก</span><input id="otp-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" /></label>}
            {(mode === 'login' || mode === 'register' || mode === 'resetVerify') && <label className="field-group" htmlFor="password">
              <span>รหัสผ่าน</span>
              <span className="password-field">
                <input id="password" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} placeholder={mode === 'resetVerify' ? 'รหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร' : 'กรอกรหัสผ่าน'} minLength={mode === 'login' ? undefined : 8} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
                <button className="password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? 'ซ่อน' : 'แสดง'}</button>
              </span>
            </label>}
            <button className="btn-primary" type="submit" disabled={submitDisabled}>{busy ? 'กำลังดำเนินการ…' : mode === 'login' ? 'เข้าสู่ระบบ' : mode === 'register' ? 'ส่งรหัส OTP' : mode === 'registerVerify' ? 'ยืนยันอีเมล' : mode === 'reset' ? 'ส่งรหัส OTP' : 'ตั้งรหัสผ่านใหม่'}</button>
            {mode === 'login' ? <div className="login-links"><button type="button" onClick={() => resetView('register')}>ยังไม่มีบัญชี? <b>ลงทะเบียนเข้าใช้ระบบ</b></button><button type="button" onClick={() => resetView('reset')}>ลืมรหัสผ่าน? <b>รีเซ็ตรหัสผ่านด้วย OTP</b></button></div> : <div className="login-links"><button type="button" onClick={() => resetView('login')}>← กลับไปหน้าเข้าสู่ระบบ</button></div>}
            <p className="login-help">พบปัญหาการใช้งาน: ติดต่อผู้ดูแลระบบของหน่วยงาน</p>
          </form>
        </section>
      </section>
    </main>
  );
}

const text = (value: unknown) => value === null || value === undefined || value === '' ? '-' : String(value);
const userFacingError = (value?: string) => {
  if (!value) return undefined;
  return /internal server error|unexpected error|database_client_error/i.test(value)
    ? 'ระบบไม่สามารถดำเนินการได้ชั่วคราว กรุณาลองใหม่อีกครั้ง หากยังพบปัญหาให้ติดต่อผู้ดูแลระบบ'
    : value;
};
function ErrorAlert({ message, className = '' }: { message?: string; className?: string }) {
  const readableMessage = userFacingError(message);
  return readableMessage ? <div className={`alert alert-error ${className}`.trim()} role="alert" aria-live="assertive"><strong>ดำเนินการไม่สำเร็จ</strong><span>{readableMessage}</span></div> : null;
}
const date = (value: unknown) => {
  if (!value) return '-';
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return String(value);
  const thaiYear = d.getUTCFullYear() + 543;
  const thaiDayMonth = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);
  return `${thaiDayMonth} ${thaiYear}`;
};
const formatApprovalDateTime = (value: unknown) => {
  if (!value) return '-';
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return String(value);
  const datePart = new Intl.DateTimeFormat('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(d);
  const timePart = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' }).format(d);
  return `${datePart} ${timePart}`;
};
const inputDate = (value: unknown) => value ? new Date(String(value)).toISOString().slice(0, 10) : '';
const nested = (value: unknown): DataRow => value && typeof value === 'object' ? value as DataRow : {};
const formPayload = (values: Record<string, string>, nullable: string[] = []) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, nullable.includes(key) && value === '' ? null : value]));
const csvValue = (value: unknown) => `"${(value && typeof value === 'object' ? JSON.stringify(value) : text(value)).replace(/"/g, '""')}"`;
const quotaBalanceText = (entitlement: unknown, used: unknown) => `${text(entitlement)} สิทธิ์ / ${text(used)} ใช้แล้ว`;
const quotaMatchStatusText = (value: unknown) => {
  const status = String(value || '');
  if (status === 'MATCHED' || status === 'DUPLICATE_MATCHED') return status === 'DUPLICATE_MATCHED' ? 'จับคู่แล้ว (พบชื่อซ้ำ)' : 'จับคู่แล้ว';
  if (status === 'UNMATCHED' || status === 'DUPLICATE_UNMATCHED') return status === 'DUPLICATE_UNMATCHED' ? 'ยังไม่จับคู่ (พบชื่อซ้ำ)' : 'ยังไม่จับคู่';
  return text(value);
};
function downloadCsv(rows: DataRow[], filename: string) {
  if (!rows.length) return;
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const csv = [`\uFEFF${headers.map(csvValue).join(',')}`, ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${filename}.csv`; anchor.click(); URL.revokeObjectURL(url);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function EditDialog({ editor, busy, error, onClose }: { editor: Editor; busy: boolean; error?: string; onClose(): void }) {
  const [values, setValues] = useState(editor.values);
  const [files, setFiles] = useState<Record<string, File>>({});
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await editor.submit(values, files);
  };
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-dialog-title">
      <div className="dialog-heading"><div><p className="eyebrow">SMS v3 staging</p><h2 id="edit-dialog-title">{editor.title}</h2></div><button type="button" aria-label="ปิด" disabled={busy} onClick={onClose}>×</button></div>
      {error && <div className="alert alert-error">{error}</div>}
      <form onSubmit={submit}>
        <div className="dialog-grid">{editor.fields.map((field) => <label className={['textarea', 'file'].includes(field.type || '') ? 'field-group full' : 'field-group'} key={field.name}><span>{field.label}</span>
          {field.type === 'select' ? <select required={field.required} value={values[field.name] || ''} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}><option value="">— เลือก —</option>{field.options?.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
            : field.type === 'textarea' ? <textarea required={field.required} value={values[field.name] || ''} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} />
              : field.type === 'file' ? <><input required={field.required} type="file" accept={field.accept} onChange={(event) => { const file = event.target.files?.[0]; if (file) setFiles({ ...files, [field.name]: file }); }} />{field.hint && <small className="field-hint">{field.hint}</small>}</>
                : <input required={field.required} type={field.type || 'text'} step={field.type === 'number' ? '0.01' : undefined} value={values[field.name] || ''} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} />}
        </label>)}</div>
        <div className="dialog-actions"><button className="btn-secondary" type="button" disabled={busy} onClick={onClose}>ยกเลิก</button><button className="btn-primary compact" type="submit" disabled={busy}>{busy ? 'กำลังบันทึก…' : editor.submitLabel}</button></div>
      </form>
    </section>
  </div>;
}

function EmployeeMagicWandModal({
  target,
  scheduleMonth,
  token,
  busy,
  onClose,
  onSubmit
}: {
  target: DataRow;
  scheduleMonth: string;
  token?: string;
  busy: boolean;
  onClose(): void;
  onSubmit(autoContinue: boolean, startPhase: string, patternType: string): Promise<void>;
}) {
  const isSupervisorTarget = String(target.jobTitle || '').toLowerCase().includes('supervisor') || String(target.jobTitle || '').includes('หัวหน้า');
  const [patternType, setPatternType] = useState<'SUPERVISOR' | 'ROTATE'>(isSupervisorTarget ? 'SUPERVISOR' : 'ROTATE');
  const [autoContinue, setAutoContinue] = useState(false);
  const [startPhase, setStartPhase] = useState('D1');
  const [analysisText, setAnalysisText] = useState('วิเคราะห์จากประวัติ: เริ่มกะเช้าวันที่ 1 (D1)');
  const [suggestedCode, setSuggestedCode] = useState('D1');

  useEffect(() => {
    if (!token || !target.id) return;
    api.previewEmployeeAutoSchedule(token, scheduleMonth, String(target.id), 'AUTO', 'ROTATE')
      .then((res) => {
        const analysis = nested(res.data).analysis as DataRow;
        if (analysis?.text) setAnalysisText(text(analysis.text));
        if (analysis?.code) {
          const code = text(analysis.code);
          setSuggestedCode(code);
          setStartPhase(code);
        }
      })
      .catch(() => {});
  }, [token, scheduleMonth, target.id]);

  const [yearStr, monthStr] = (scheduleMonth || '2026-08').split('-');
  const dateObj = new Date(Date.UTC(Number(yearStr || 2026), Number(monthStr || 8) - 1, 1));
  const thaiMonthName = new Intl.DateTimeFormat('th-TH', { month: 'long', timeZone: 'UTC' }).format(dateObj);
  const thaiYearStr = Number(yearStr || 2026) + 543;
  const thaiFullDateStr = `1 ${thaiMonthName} ${thaiYearStr}`;

  const empName = text(target.displayName || `${text(target.firstName)} ${text(target.lastName)}`);
  const empCode = text(target.employeeCode);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(autoContinue, autoContinue ? suggestedCode : startPhase, patternType);
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <section className="edit-dialog magic-wand-dialog" role="dialog" aria-modal="true" aria-labelledby="magic-wand-title">
        <div className="dialog-heading">
          <h2 id="magic-wand-title">🪄 จัดกะแพทเทิร์นด่วน</h2>
          <button type="button" aria-label="ปิด" disabled={busy} onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="magic-wand-body">
            <div className="wand-emp-badge">
              <span>พนักงาน: <strong>{empName} ({empCode})</strong></span>
            </div>
            <p className="wand-analysis-blue-text">การจัดครั้งนี้จะใส่เป็นฉบับร่างล่าสุดของพนักงานทั้งเดือน โดยคงเฉพาะวันลา (AL) และ Admin override ไว้ ต้องกดบันทึกการเปลี่ยนแปลงทั้งหมดเพื่อบันทึกจริง</p>

            <div className="wand-section">
              <h3 className="wand-section-title">1. เลือกรูปแบบแพทเทิร์น (Pattern)</h3>
              <div className="wand-options-list">
                <label className={`wand-option-card ${patternType === 'SUPERVISOR' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="pattern-type"
                    checked={patternType === 'SUPERVISOR'}
                    onChange={() => setPatternType('SUPERVISOR')}
                  />
                  <div className="option-text">
                    <strong>กะหัวหน้างาน (Supervisor)</strong>
                    <p>เข้ากะเช้า 6 วัน (จันทร์-เสาร์) และหยุดวันอาทิตย์ (OFF) ทุกสัปดาห์</p>
                  </div>
                </label>

                <label className={`wand-option-card ${patternType === 'ROTATE' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="pattern-type"
                    checked={patternType === 'ROTATE'}
                    onChange={() => setPatternType('ROTATE')}
                  />
                  <div className="option-text">
                    <strong>กะพนักงานเวียนลูป 1 เดือน</strong>
                    <p>กะเช้า 6 วัน -&gt; หยุด 1 วัน -&gt; กะดึก 6 วัน -&gt; หยุด 1 วัน (วนลูปต่อเนื่อง)</p>
                  </div>
                </label>
              </div>
            </div>

            {patternType === 'ROTATE' && (
              <div className="wand-section">
                <h3 className="wand-section-title">2. เลือกจุดเริ่มของเดือนนี้ (สำหรับวันที่ {thaiFullDateStr})</h3>
                <label className="wand-checkbox-label">
                  <input
                    type="checkbox"
                    checked={autoContinue}
                    onChange={(e) => setAutoContinue(e.target.checked)}
                  />
                  <span>🔍 เชื่อมต่อลูปจากเดือนก่อนหน้าอัตโนมัติ</span>
                </label>

                {autoContinue && (
                  <div className="wand-analysis-blue-text">
                    {analysisText}
                  </div>
                )}

                <div className="field-group phase-select-box">
                  <select
                    id="phase-select"
                    disabled={autoContinue}
                    value={autoContinue ? suggestedCode : startPhase}
                    onChange={(e) => setStartPhase(e.target.value)}
                  >
                    <option value="D1">กะเช้า วันที่ 1 (D1)</option>
                    <option value="D2">กะเช้า วันที่ 2 (D2)</option>
                    <option value="D3">กะเช้า วันที่ 3 (D3)</option>
                    <option value="D4">กะเช้า วันที่ 4 (D4)</option>
                    <option value="D5">กะเช้า วันที่ 5 (D5)</option>
                    <option value="D6">กะเช้า วันที่ 6 (D6)</option>
                    <option value="OFF-D">วันหยุด (OFF)</option>
                    <option value="N1">กะดึก วันที่ 1 (N1)</option>
                    <option value="N2">กะดึก วันที่ 2 (N2)</option>
                    <option value="N3">กะดึก วันที่ 3 (N3)</option>
                    <option value="N4">กะดึก วันที่ 4 (N4)</option>
                    <option value="N5">กะดึก วันที่ 5 (N5)</option>
                    <option value="N6">กะดึก วันที่ 6 (N6)</option>
                    <option value="OFF-N">วันหยุด (OFF)</option>
                  </select>
                </div>
              </div>
            )}
          </div>
          <div className="dialog-actions">
            <button className="btn-secondary" type="button" disabled={busy} onClick={onClose}>ยกเลิก</button>
            <button className="btn-primary compact wand-submit-btn" type="submit" disabled={busy}>
              {busy ? 'กำลังสร้างร่าง…' : '🪄 ใส่ลงในฉบับร่าง'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

const tablePages: Record<Exclude<Page, 'dashboard' | 'employees' | 'reports' | 'shiftSetup' | 'settings' | 'leavePending' | 'leaveHistory'>, { title: string; eyebrow: string; description: string; columns: Array<{ label: string; value: (row: DataRow) => React.ReactNode }> }> = {
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
  quota: { title: 'โควตาวันลา', eyebrow: 'การลา', description: 'แสดงสิทธิ์ทั้งหมด ใช้แล้ว และคงเหลือจากใบลาที่อนุมัติ', columns: [
    { label: 'พนักงาน', value: (row) => text(row.employeeNameSnapshot) },
    { label: 'ลาป่วย', value: (row) => quotaBalanceText(row.sickLeave, row.sickLeaveUsed) },
    { label: 'ลากิจ', value: (row) => quotaBalanceText(row.personalLeave, row.personalLeaveUsed) },
    { label: 'ลาพักร้อน', value: (row) => quotaBalanceText(row.vacationLeave, row.vacationLeaveUsed) },
    { label: 'การจับคู่ข้อมูล', value: (row) => quotaMatchStatusText(row.matchStatus) }
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

function OperationalTable({ page, response, loading, error, onPageChange, onAction, onCreate, onNavigate, role }: { page: Exclude<Page, 'dashboard' | 'employees' | 'reports' | 'shiftSetup' | 'settings' | 'leavePending' | 'leaveHistory'>; response: DataResponse; loading: boolean; error?: string; onPageChange(page: number): void; onAction(row: DataRow, action: string): void; onCreate(): void; onNavigate(page: Page): void; role: string }) {
  const config = tablePages[page];
  const rows = Array.isArray(response.data) ? response.data : [];
  const [tableSearch, setTableSearch] = useState('');
  useEffect(() => { setTableSearch(''); }, [page]);
  const visibleRows = useMemo(() => {
    if (page !== 'licenses') return rows;
    const term = tableSearch.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => {
      const employee = nested(row.employee);
      return [
        employee.employeeCode, employee.firstName, employee.lastName, employee.department,
        row.licenseType, row.licenseNumber, row.status, row.remark
      ].map(text).join(' ').toLowerCase().includes(term);
    });
  }, [page, rows, tableSearch]);
  const actionPages = ['licenses', 'schedule', 'approvals', 'rules', 'leave', 'quota', 'users'];
  const canManage = ['ADMIN', 'MANAGER'].includes(role);
  const canEditRows = canManage && !(['licenses', 'approvals'].includes(page) && role !== 'ADMIN');
  const rowActions = (row: DataRow) => {
    if (!canEditRows || !actionPages.includes(page)) return null;
    if (page === 'approvals') return <><button onClick={() => onAction(row, 'approve')}>อนุมัติ</button><button onClick={() => onAction(row, 'reject')}>ไม่อนุมัติ</button></>;
    if (page === 'leave') return <><button onClick={() => onAction(row, 'approve')}>อนุมัติ</button><button onClick={() => onAction(row, 'reject')}>ไม่อนุมัติ</button></>;
    if (page === 'rules') return <><button onClick={() => onAction(row, 'edit')}>แก้ไข</button><button onClick={() => onAction(row, 'toggle')}>{row.enabled ? 'ปิดใช้' : 'เปิดใช้'}</button></>;
    if (page === 'licenses') return <><button onClick={() => onAction(row, 'edit')}>แก้ไข</button><button className="danger-action" onClick={() => onAction(row, 'delete')}>ลบ</button></>;
    if (page === 'quota') return <button onClick={() => onAction(row, 'edit')}>แก้ไขโควตา</button>;
    if (page === 'schedule') return <><button onClick={() => onAction(row, 'edit')}>แก้ไข</button><button onClick={() => onAction(row, 'toggle-lock')}>{row.locked ? 'ปลดล็อก' : 'ล็อก'}</button><button className="danger-action" onClick={() => onAction(row, 'delete')}>ลบ</button></>;
    return <><button onClick={() => onAction(row, 'edit')}>สิทธิ์</button><button onClick={() => onAction(row, 'reset-password')}>ตั้งรหัสผ่าน</button><button onClick={() => onAction(row, 'toggle-user')}>{row.isActive ? 'ระงับ' : 'เปิดใช้'}</button></>;
  };
  const showActions = canEditRows && actionPages.includes(page);
  const canCreate = page === 'leave' || (canManage && ['licenses', 'schedule'].includes(page));
  const related: Partial<Record<typeof page, { page: Page; label: string }>> = {
    licenses: { page: 'employees', label: 'ข้อมูลพนักงาน' }, schedule: { page: 'approvals', label: 'อนุมัติตารางกะ' },
    approvals: { page: 'schedule', label: 'Schedule Calendar' }, leave: { page: 'quota', label: 'โควตาวันลา' },
    quota: { page: 'leave', label: 'คำขอลา' }, audit: { page: 'settings', label: 'Settings' }
  };
  const relatedPage = related[page];
  const showRelated = relatedPage && (relatedPage.page !== 'approvals' || role === 'ADMIN') && (relatedPage.page !== 'quota' || role === 'ADMIN');
  const noResultsMessage = page === 'licenses' && tableSearch ? 'ไม่พบใบอนุญาตที่ตรงกับคำค้นหา' : 'ยังไม่มีข้อมูลในหมวดนี้';
  return <section className="view-pane"><div className="page-heading"><div><p className="eyebrow">{config.eyebrow}</p><h1>{config.title}</h1><p>{config.description}</p></div><div className="heading-actions">{showRelated && <button className="small-action" onClick={() => onNavigate(relatedPage.page)}>{relatedPage.label}</button>}{canCreate && <button className="btn-primary compact" onClick={onCreate}>{page === 'leave' ? '+ ส่งคำขอลา' : '+ เพิ่มรายการ'}</button>}<span className="record-chip">ทั้งหมด {response.meta?.total ?? rows.length} รายการ</span><button className="small-action" disabled={!visibleRows.length} onClick={() => downloadCsv(visibleRows, page)}>CSV</button><button className="small-action" onClick={() => window.print()}>พิมพ์ / PDF</button></div></div><ErrorAlert message={error} />{page === 'licenses' && <div className="toolbar"><label className="search-box"><span>⌕</span><input value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} placeholder="ค้นหารหัสพนักงาน ชื่อ เลขที่ใบอนุญาต หรือสถานะ" /></label><span className="toolbar-count">แสดง {visibleRows.length} จาก {rows.length} รายการ</span></div>}<div className="table-card">{loading ? <div className="loading-row" role="status">กำลังอ่านข้อมูล…</div> : <div className="table-scroll"><table className="data-table"><thead><tr>{config.columns.map((column) => <th key={column.label}>{column.label}</th>)}{showActions && <th>ดำเนินการ</th>}</tr></thead><tbody>{visibleRows.length ? visibleRows.map((row, index) => <tr key={text(row.id) + index}>{config.columns.map((column) => <td key={column.label}>{column.value(row)}</td>)}{showActions && <td className="row-actions">{rowActions(row)}</td>}</tr>) : <tr><td colSpan={config.columns.length + (showActions ? 1 : 0)} className="no-rows"><div className="empty-state"><span aria-hidden="true">⌁</span><strong>{noResultsMessage}</strong><p>{page === 'licenses' && tableSearch ? 'ลองเปลี่ยนคำค้นหา หรือล้างตัวกรองแล้วค้นหาอีกครั้ง' : 'เพิ่มข้อมูลรายการแรกเพื่อเริ่มใช้งานหน้านี้'}</p>{canCreate && !(page === 'licenses' && tableSearch) && <button className="small-action" onClick={onCreate}>+ เพิ่มรายการแรก</button>}</div></td></tr>}</tbody></table></div>}</div>{response.meta?.totalPages && response.meta.totalPages > 1 && <div className="pagination-bar"><button disabled={(response.meta.page || 1) <= 1 || loading} onClick={() => onPageChange((response.meta?.page || 1) - 1)}>‹ ก่อนหน้า</button><span>หน้า {response.meta.page} จาก {response.meta.totalPages}</span><button disabled={(response.meta.page || 1) >= response.meta.totalPages || loading} onClick={() => onPageChange((response.meta?.page || 1) + 1)}>หน้าถัดไป ›</button></div>}</section>;
}

const defaultNewLeaveTemplate = `🔔 [คำขอลางานใหม่] รอตรวจรับเอกสาร
--------------------------------
👤 พนักงาน: {Name}
📍 แผนก/พื้นที่: {Department}
📋 ประเภท: {Type} ({Days} วัน)
📅 วันที่: {StartDate} ถึง {EndDate}
📝 เหตุผล: {Reason}
📎 ไฟล์แนบ: {FileUrl}
--------------------------------
⚙️ จัดการใบลาคลิกที่ระบบ Security Management System`;
const defaultLeaveStatusTemplate = `📢 [อัปเดตสถานะใบลาจากระบบ]
--------------------------------
👤 พนักงาน: {Name}
📋 ประเภท: {Type} ({Days} วัน)
🔄 ผลการตรวจรับ: {Status}
📅 วันที่: {StartDate} ถึง {EndDate}
📝 เหตุผล: {Reason}`;

function SettingsPage({ settings, loading, error, onRefresh, onSaveTemplates, onAudit }: { settings: DataRow[]; loading: boolean; error?: string; onRefresh(): void; onSaveTemplates(newLeave: string, leaveStatus: string): Promise<void>; onAudit(): void }) {
  const readSetting = (key: string, fallback: string) => String(settings.find((setting) => setting.key === key)?.value || fallback);
  const [newLeaveTemplate, setNewLeaveTemplate] = useState(defaultNewLeaveTemplate);
  const [leaveStatusTemplate, setLeaveStatusTemplate] = useState(defaultLeaveStatusTemplate);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    setNewLeaveTemplate(readSetting('LINE_TEMPLATE_NEW_LEAVE', defaultNewLeaveTemplate));
    setLeaveStatusTemplate(readSetting('LINE_TEMPLATE_LEAVE_STATUS', defaultLeaveStatusTemplate));
  }, [settings]);
  const visibleSettings = settings.filter((setting) => !['LINE_TEMPLATE_NEW_LEAVE', 'LINE_TEMPLATE_LEAVE_STATUS'].includes(String(setting.key)));
  const saveTemplates = async () => {
    setSaving(true); setNotice(undefined);
    try { await onSaveTemplates(newLeaveTemplate, leaveStatusTemplate); setNotice('บันทึกเทมเพลตการแจ้งเตือนสำเร็จแล้ว'); }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : 'บันทึกเทมเพลตไม่สำเร็จ'); }
    finally { setSaving(false); }
  };
  return <section className="view-pane settings-page">
    <div className="page-heading settings-heading"><div><h1>Settings</h1><p>ตั้งค่าระบบและการแจ้งเตือน โดยไม่เก็บ token หรือความลับไว้ในฐานข้อมูล</p></div><div className="heading-actions"><button className="small-action" disabled={!visibleSettings.length} onClick={() => downloadCsv(visibleSettings, 'smsv3-settings')}>⇧ Export</button><button className="small-action" onClick={onAudit}>Audit Log</button><button className="btn-primary compact" disabled title="SMS v3 ไม่ใช้ Google Sheets เป็นแหล่งข้อมูลหลัก">↻ Google Sheets ถูกยกเลิก</button></div></div>
    {error && <div className="alert alert-error">{error}</div>}
    <div className="table-card settings-table-card">{loading ? <div className="loading-row">กำลังอ่านข้อมูล Settings…</div> : <div className="table-scroll"><table className="data-table settings-table"><thead><tr><th>Key</th><th>Value</th><th>Description</th></tr></thead><tbody>{visibleSettings.length ? visibleSettings.map((setting) => <tr key={text(setting.key)}><td><code>{text(setting.key)}</code></td><td>{setting.configured === undefined ? text(setting.value) : <span className={setting.configured ? 'status-badge active' : 'status-badge inactive'}>{setting.configured ? 'Configured' : 'Not configured'}</span>}</td><td>{text(setting.description)}</td></tr>) : <tr><td colSpan={3} className="no-rows">ยังไม่มีข้อมูล Settings ที่นำเข้าจากระบบเดิม</td></tr>}</tbody></table></div>}</div>
    <section className="line-settings-card">
      <div className="line-settings-title"><span>💬</span><div><h2>LINE Notification Settings (ตั้งค่าแจ้งเตือน LINE)</h2><p>รูปแบบเดิมถูกคงไว้ แต่ credential ต้องตั้งค่าที่ Vercel Environment Variables เท่านั้น</p></div></div>
      <div className="line-secure-grid"><label className="field-group"><span>LINE Access Token / Channel Access Token</span><input type="password" value="••••••••••••••••" disabled aria-label="LINE access token is managed securely" /><small>ไม่แสดงและไม่บันทึก token ในหน้าจอนี้</small></label><label className="field-group"><span>LINE Group ID / Target ID</span><input type="text" value="จัดการผ่าน deployment configuration" disabled /><small>ตั้งค่าจาก Vercel Environment Variables เมื่อเปิดใช้ provider ที่อนุมัติ</small></label></div>
      <div className="line-template-grid"><label className="field-group"><span>🔔 เทมเพลตคำขอลางานใหม่ (New Leave Request Template)</span><textarea rows={7} value={newLeaveTemplate} onChange={(event) => setNewLeaveTemplate(event.target.value)} maxLength={2000} /></label><label className="field-group"><span>📢 เทมเพลตอัปเดตสถานะใบลา (Leave Status Update Template)</span><textarea rows={7} value={leaveStatusTemplate} onChange={(event) => setLeaveStatusTemplate(event.target.value)} maxLength={2000} /></label></div>
      <div className="template-help"><strong>💡 ตัวแปรที่ใช้ในข้อความได้</strong><span><code>{'{Name}'}</code> พนักงาน</span><span><code>{'{Department}'}</code> แผนก</span><span><code>{'{Type}'}</code> ประเภทการลา</span><span><code>{'{Days}'}</code> จำนวนวัน</span><span><code>{'{StartDate}'}</code> / <code>{'{EndDate}'}</code> วันที่ลา</span><span><code>{'{Reason}'}</code> เหตุผล</span><span><code>{'{FileUrl}'}</code> ไฟล์แนบ</span><span><code>{'{Status}'}</code> สถานะ</span></div>
      {notice && <div className={notice.includes('สำเร็จ') ? 'settings-notice success' : 'settings-notice error'}>{notice}</div>}
      <div className="line-settings-actions"><button className="btn-primary compact" disabled={saving} onClick={saveTemplates}>💾 {saving ? 'กำลังบันทึก…' : 'บันทึกเทมเพลตการแจ้งเตือน'}</button><button className="small-action" disabled title="การส่ง LINE ยังไม่เปิดใช้ใน staging">🔔 ทดสอบส่งข้อความแจ้งเตือน</button><button className="small-action" onClick={onRefresh}>↻ รีเฟรช</button></div>
      <p className="line-settings-footnote">สถานะปัจจุบัน: การส่ง LINE ยังไม่เปิดใช้งานใน staging — การบันทึกด้านบนเก็บเฉพาะเทมเพลตที่ไม่มีข้อมูลลับ</p>
    </section>
  </section>;
}

interface ShiftEditorModalProps {
  shift?: DataRow;
  defaults?: Record<string, string>;
  employees: DataRow[];
  shiftTypes: DataRow[];
  licenses: DataRow[];
  isAdmin: boolean;
  onClose: () => void;
  onSubmit: (data: {
    employeeId: string;
    workDate: string;
    shiftTypeId: string;
    remark: string;
    licenseOverride: boolean;
    overrideReason: string;
  }) => void;
}

function ShiftEditorModal({ shift, defaults, employees, shiftTypes, licenses, isAdmin, onClose, onSubmit }: ShiftEditorModalProps) {
  const initialEmpId = String(shift?.employeeId || defaults?.employeeId || employees[0]?.id || '');
  const initialDate = shift ? inputDate(shift.workDate) : String(defaults?.workDate || '');
  const initialType = String(shift?.shiftTypeId || nested(shift?.shiftType).id || defaults?.shiftTypeId || shiftTypes[0]?.id || '');
  const initialRemark = String(shift?.remark || '');
  const initialOverride = Boolean(shift?.licenseOverride);
  const initialOverrideReason = String(shift?.overrideReason || '');

  const [employeeId, setEmployeeId] = useState(initialEmpId);
  const [workDate, setWorkDate] = useState(initialDate);
  const [shiftTypeId, setShiftTypeId] = useState(initialType);
  const [remark, setRemark] = useState(initialRemark);
  const [licenseOverride, setLicenseOverride] = useState(initialOverride);
  const [overrideReason, setOverrideReason] = useState(initialOverrideReason);
  const [modalError, setModalError] = useState<string | null>(null);

  const selectedEmp = employees.find((e) => String(e.id) === employeeId);
  const empName = selectedEmp ? String(selectedEmp.displayName || `${String(selectedEmp.firstName || '')} ${String(selectedEmp.lastName || '')}`).trim() : 'พนักงาน';

  const dateVal = workDate ? new Date(`${workDate}T00:00:00Z`) : null;
  const dayNameStr = dateVal ? new Intl.DateTimeFormat('th-TH', { weekday: 'long', timeZone: 'UTC' }).format(dateVal) : '';
  const dayNumStr = dateVal ? dateVal.getUTCDate() : '';
  const monthNameStr = dateVal ? new Intl.DateTimeFormat('th-TH', { month: 'short', timeZone: 'UTC' }).format(dateVal) : '';
  const formattedTitleDate = dateVal ? `${dayNameStr} ${dayNumStr} ${monthNameStr}` : workDate;

  const titleStr = shift ? `แก้กะ: ${empName} · ${formattedTitleDate}` : `เพิ่มกะ: ${empName} · ${formattedTitleDate}`;

  const selectedType = shiftTypes.find((t) => String(t.id) === shiftTypeId);
  const shiftCode = String(selectedType?.code || '').toUpperCase();
  const isWorkingShift = !['OFF', 'AL'].includes(shiftCode);

  const empLicenses = licenses.filter((l) => {
    const eId = String(l.employeeId || nested(l.employee).id || '');
    return eId === employeeId;
  });
  const activeLicenses = empLicenses.filter((l) => ['active', 'valid'].includes(String(l.status || '').trim().toLowerCase()));
  const validLic = activeLicenses.find((l) => {
    const issue = l.issueDate ? inputDate(l.issueDate) : '';
    const expiry = l.expiryDate ? inputDate(l.expiryDate) : '';
    return issue && expiry && issue <= workDate && expiry >= workDate;
  });

  const isInvalidLicense = isWorkingShift && !validLic;

  const formatThaiYearDate = (dStr?: unknown) => {
    if (!dStr) return '';
    const d = new Date(String(dStr));
    if (isNaN(d.getTime())) return String(dStr);
    const day = d.getUTCDate();
    const monthName = new Intl.DateTimeFormat('th-TH', { month: 'long', timeZone: 'UTC' }).format(d);
    const thaiYear = d.getUTCFullYear() + 543;
    return `${day} ${monthName} ${thaiYear}`;
  };

  let warningDetailText = 'ไม่พบข้อมูลใบอนุญาต รปภ. ในระบบที่ครอบคลุมวันที่จัดกะนี้';
  if (activeLicenses.length > 0) {
    const lic = activeLicenses[0];
    const issueStr = formatThaiYearDate(lic.issueDate);
    const expiryStr = formatThaiYearDate(lic.expiryDate);
    if (lic.issueDate && inputDate(lic.issueDate) > workDate) {
      warningDetailText = `ใบอนุญาตยังไม่ถึงวันเริ่มใช้งาน · วันหมดอายุ ${expiryStr}`;
    } else if (lic.expiryDate && inputDate(lic.expiryDate) < workDate) {
      warningDetailText = `ใบอนุญาตหมดอายุแล้วเมื่อ ${expiryStr}`;
    } else {
      warningDetailText = `ใบอนุญาตไม่อยู่ในสถานะที่ใช้งานได้ · วันหมดอายุ ${expiryStr}`;
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    if (isInvalidLicense && !licenseOverride) {
      setModalError('ใบอนุญาตไม่ผ่านเกณฑ์ กรุณายืนยัน Override (เฉพาะ Admin) หรือเปลี่ยนเป็นกะ OFF / AL');
      return;
    }

    if (isInvalidLicense && licenseOverride && overrideReason.trim().length < 5) {
      setModalError('กรุณาระบุเหตุผล Override อย่างน้อย 5 ตัวอักษร');
      return;
    }

    onSubmit({
      employeeId,
      workDate,
      shiftTypeId,
      remark: remark || 'Manual batch edit',
      licenseOverride: isInvalidLicense ? licenseOverride : false,
      overrideReason: isInvalidLicense && licenseOverride ? overrideReason : ''
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '540px',
          backgroundColor: '#fffbeb',
          border: '2px solid #fde68a',
          borderRadius: '16px',
          padding: '24px',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)'
        }}
      >
        <h3 style={{ margin: '0 0 16px 0', fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
          {titleStr}
        </h3>

        {modalError && (
          <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', fontSize: '13px', fontWeight: 600 }}>
            {modalError}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                Shift
              </label>
              <select
                value={shiftTypeId}
                onChange={(e) => setShiftTypeId(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px', backgroundColor: '#ffffff', color: '#0f172a', fontWeight: 600 }}
              >
                {shiftTypes.map((t) => (
                  <option key={String(t.id)} value={String(t.id)}>
                    {String(t.code || '')} · {String(t.name || '')}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                หมายเหตุ
              </label>
              <input
                type="text"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="Manual batch edit"
                style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px', backgroundColor: '#ffffff' }}
              />
            </div>
          </div>

          {isInvalidLicense && (
            <div style={{
              backgroundColor: '#fff1f2',
              border: '1px solid #fecdd3',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '16px',
              color: '#9f1239'
            }}>
              <div style={{ fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px', color: '#be123c', marginBottom: '6px' }}>
                <span>⚠️</span> ไม่สามารถลงกะทำงานตามปกติได้
              </div>
              <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#881337', lineHeight: '1.5' }}>
                {warningDetailText}
              </p>

              {isAdmin ? (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '13px', color: '#0f172a', cursor: 'pointer', marginBottom: '8px' }}>
                    <input
                      type="checkbox"
                      checked={licenseOverride}
                      onChange={(e) => setLicenseOverride(e.target.checked)}
                    />
                    Admin ยืนยันจัดกะแบบ Manual แม้ใบอนุญาตไม่ผ่าน
                  </label>

                  {licenseOverride && (
                    <div style={{ marginTop: '10px' }}>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                        เหตุผล Override *
                      </label>
                      <textarea
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                        placeholder="ระบุเหตุผลอย่างน้อย 5 ตัวอักษร"
                        rows={2}
                        style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                      />
                    </div>
                  )}
                  <small style={{ display: 'block', color: '#be123c', marginTop: '8px', fontSize: '11px', lineHeight: '1.4' }}>
                    การอนุมัตินี้จะถูกบันทึกใน License Audit Log พร้อมชื่อ Admin และเวลา
                  </small>
                </>
              ) : (
                <small style={{ color: '#be123c', fontSize: '12px', fontWeight: 700, display: 'block', marginTop: '4px' }}>
                  * เฉพาะ Admin เท่านั้นที่สามารถ Overrule ใบอนุญาตที่ไม่ผ่านได้
                </small>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '9px 18px',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                color: '#334155',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              ยกเลิก
            </button>

            <button
              type="submit"
              style={{
                padding: '9px 20px',
                borderRadius: '10px',
                border: 'none',
                background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
                boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.4)'
              }}
            >
              เก็บรายการนี้ (ยังไม่บันทึก)
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LeaveManagementPage({ rows, loading, error, linked, remaining, employeeId, canManage, canSubmit, canCancelApprovedLeave, mode = 'all', historyScope = 'mine', employeeOptions, onSubmit, onApprove, onReject, onCancel, onRefresh, onAttachment, onPrint }: { rows: DataRow[]; loading: boolean; error?: string; linked: boolean; remaining: DataRow; employeeId?: string; canManage: boolean; canSubmit: boolean; canCancelApprovedLeave: boolean; mode?: 'all' | 'pending' | 'history'; historyScope?: 'mine' | 'all'; employeeOptions: Array<{ value: string; label: string }>; onSubmit(values: Record<string, string>, file?: File): Promise<void>; onApprove(row: DataRow): void; onReject(row: DataRow): void; onCancel(row: DataRow): void; onRefresh(): void; onAttachment(row: DataRow): void; onPrint(row: DataRow): void }) {
  const [form, setForm] = useState({ employeeId: '', leaveType: '', startDate: '', endDate: '', substitute: '', reason: '' });
  const [file, setFile] = useState<File>();
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const pendingRows = rows.filter((row) => row.status === 'PENDING');
  const historyRows = historyScope === 'all' ? rows : rows.filter((row) => String(row.employeeId || '') === String(employeeId || ''));
  const days = form.startDate && form.endDate ? Math.max(0, Math.floor((Date.parse(`${form.endDate}T00:00:00Z`) - Date.parse(`${form.startDate}T00:00:00Z`)) / 86400000) + 1) : 0;
  const requiresAttachment = form.leaveType.includes('ป่วย') && days > 3;
  const formReady = Boolean((canManage ? form.employeeId : linked) && form.leaveType && form.startDate && form.endDate && form.substitute.trim() && (!requiresAttachment || file));
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!formReady) return;
    setSubmitting(true); setNotice(undefined);
    try {
      const payload: Record<string, string> = { ...form };
      if (!canManage) delete payload.employeeId;
      await onSubmit(payload, file);
      setForm({ employeeId: '', leaveType: '', startDate: '', endDate: '', substitute: '', reason: '' }); setFile(undefined); setNotice('ส่งคำขอลาสำเร็จแล้ว');
    }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : 'ส่งคำขอลาไม่สำเร็จ'); }
    finally { setSubmitting(false); }
  };
  const status = (row: DataRow) => { const actorName = row.approvedByDisplayName ? String(row.approvedByDisplayName) : ''; const actorRole = String(row.approvedByRole || 'ผู้อนุมัติ'); const actionDate = row.approvedAt ? String(date(row.approvedAt)) : ''; return <div className="leave-status-cell"><span className={`status-badge ${row.status === 'APPROVED' ? 'active' : row.status === 'REJECTED' ? 'inactive' : 'pending'}`}>{String(text(row.status))}</span>{actorName ? <small className="leave-action-log">ดำเนินการโดย {actorName} ({actorRole})<br />วันที่ {actionDate}</small> : null}</div>; };
  const leaveTable = (items: DataRow[], actions = false) => <div className="table-scroll"><table className="data-table leave-data-table"><thead><tr><th>พนักงาน</th><th>ประเภท</th><th>วันที่ลา</th><th>วัน</th><th>แทน / เหตุผล</th><th>เอกสาร</th>{!actions && <th>สถานะ</th>}<th>พิมพ์</th>{(actions || canCancelApprovedLeave) && <th>จัดการ</th>}</tr></thead><tbody>{items.length ? items.map((row) => <tr key={text(row.id)}><td className="employee-name">{text(row.employeeNameSnapshot)}<small className="cell-note">{text(row.departmentSnapshot)}</small></td><td>{text(row.leaveType)}</td><td>{date(row.startDate)} – {date(row.endDate)}</td><td>{text(row.dayCount)}</td><td>{text(row.reason)}</td><td>{row.attachmentUrl ? <button className="attachment-link" onClick={() => onAttachment(row)}>📎 เอกสาร</button> : <span className="muted-text">–</span>}</td>{!actions && <td>{status(row)}</td>}<td>{row.status === 'APPROVED' ? <button className="leave-print-button" onClick={() => onPrint(row)}>🖨 พิมพ์ A4</button> : <span className="muted-text">–</span>}</td>{actions && <td className="row-actions"><button className="btn-primary compact" onClick={() => onApprove(row)}>อนุมัติ</button><button className="danger-action" onClick={() => onReject(row)}>ไม่อนุมัติ</button></td>}{!actions && canCancelApprovedLeave && <td className="row-actions">{row.status === 'APPROVED' ? <button className="danger-action" onClick={() => onCancel(row)}>ยกเลิกใบลาที่อนุมัติแล้ว</button> : <span className="muted-text">–</span>}</td>}</tr>) : <tr><td colSpan={(actions || canCancelApprovedLeave) ? 9 : 8} className="no-rows">ไม่มีรายการ</td></tr>}</tbody></table></div>;
  const quotaCards: Array<[string, string, unknown, string]> = [['🩺', 'ลาป่วยคงเหลือ', remaining.sickLeave, 'green'], ['🏢', 'ลากิจคงเหลือ', remaining.personalLeave, 'blue'], ['🌴', 'ลาพักร้อนคงเหลือ', remaining.vacationLeave, 'amber']];
  return <section className={`view-pane leave-page leave-mode-${mode}`}>
    <div className="leave-hero"><div><span>🗓️</span><div><h1>ระบบจัดการการลา (Leave Management)</h1><p>ยื่นคำขอลา ตรวจสอบโควตา และอนุมัติรายการเข้าสู่ตารางกะ</p></div></div><button onClick={onRefresh}>↻ รีเฟรชข้อมูล</button></div>
    {canManage && (
      <div className="leave-quota-grid" style={{ marginBottom: '20px' }}>
        <article className="leave-quota-card amber">
          <div>
            <p>⏳ คำขอรออนุมัติ</p>
            <strong>{pendingRows.length}</strong>
            <small>รายการรอผู้บริหารอนุมัติ</small>
          </div>
          <span style={{ background: '#fef3c7', color: '#d97706' }}>⏳</span>
        </article>
        <article className="leave-quota-card green">
          <div>
            <p>✓ อนุมัติแล้ว</p>
            <strong>{rows.filter((r) => r.status === 'APPROVED').length}</strong>
            <small>รายการลงตารางกะเรียบร้อย</small>
          </div>
          <span style={{ background: '#d1fae5', color: '#059669' }}>✓</span>
        </article>
        <article className="leave-quota-card red" style={{ borderLeftColor: '#ef4444' }}>
          <div>
            <p>✕ ไม่อนุมัติ</p>
            <strong>{rows.filter((r) => r.status === 'REJECTED').length}</strong>
            <small>รายการที่ไม่ผ่านการอนุมัติ</small>
          </div>
          <span style={{ background: '#fee2e2', color: '#dc2626' }}>✕</span>
        </article>
      </div>
    )}
    {linked ? <div className="leave-quota-grid">{quotaCards.map(([icon, label, value, tone]) => <article className={`leave-quota-card ${tone}`} key={label}><div><p>{icon} {label}</p><strong>{text(value)}</strong><small>ตามสิทธิ์ประจำปี (วัน)</small></div><span>{icon}</span></article>)}</div> : !canManage && <div className="alert alert-error">บัญชีนี้ยังไม่ได้ผูกกับข้อมูลพนักงาน กรุณาติดต่อ Admin ก่อนส่งคำขอลา</div>}
    <div className="leave-main-grid"><section className="leave-submit-card"><header><span>✍️</span><div><h2>ยื่นคำขอลาพัก (Submit Leave Request)</h2><p>กรอกข้อมูลให้ครบก่อนส่งเข้าคิวอนุมัติ</p></div></header><form onSubmit={submit}>{canManage && <label className="field-group"><span>👤 พนักงาน <b>*</b></span><select required value={form.employeeId} onChange={(event) => update('employeeId', event.target.value)}><option value="">-- เลือกพนักงาน --</option>{employeeOptions.map((employee) => <option key={employee.value} value={employee.value}>{employee.label}</option>)}</select></label>}<label className="field-group"><span>📌 ประเภทการลา <b>*</b></span><select required value={form.leaveType} onChange={(event) => update('leaveType', event.target.value)}><option value="">-- กรุณาเลือกประเภทการลา --</option><option value="ลาป่วย">🩺 ลาป่วย (Sick Leave)</option><option value="ลากิจ">🏢 ลากิจ (Personal Leave)</option><option value="ลาพักร้อน">🌴 ลาพักร้อน (Vacation Leave)</option></select></label><div className="leave-date-grid"><label className="field-group"><span>📅 วันที่เริ่มต้น <b>*</b></span><input required type="date" value={form.startDate} onChange={(event) => update('startDate', event.target.value)} /></label><label className="field-group"><span>🏁 วันที่สิ้นสุด <b>*</b></span><input required type="date" min={form.startDate || undefined} value={form.endDate} onChange={(event) => update('endDate', event.target.value)} /></label></div>{days > 0 && <div className="leave-days-note">ระยะเวลาการลา: <strong>{days}</strong> วัน</div>}<label className="field-group"><span>👥 ผู้ปฏิบัติงานแทน <b>*</b></span><input required value={form.substitute} placeholder="ระบุชื่อ-นามสกุล ผู้เข้าเวร/ปฏิบัติงานแทน" onChange={(event) => update('substitute', event.target.value)} /></label><label className="field-group"><span>📝 เหตุผลการลา</span><textarea rows={3} value={form.reason} placeholder="ระบุเหตุผลหรือความจำเป็นในการลา... (ไม่บังคับ)" onChange={(event) => update('reason', event.target.value)} /></label><label className="leave-file-field"><span>📎 แนบไฟล์เอกสาร (ใบรับรองแพทย์/รูปภาพ/PDF)</span><small>จำเป็นเมื่อลาป่วยเกิน 3 วัน · PDF, JPG หรือ PNG ไม่เกิน 4 MB</small><input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => setFile(event.target.files?.[0])} />{file && <em>เลือกไฟล์แล้ว: {file.name}</em>}</label>{notice && <div className={notice.includes('สำเร็จ') ? 'settings-notice success' : 'settings-notice error'}>{notice}</div>}<button className="leave-submit-button" disabled={!canSubmit || !formReady || submitting} type="submit">🚀 {submitting ? 'กำลังส่งคำขอลา…' : 'ยืนยันและส่งคำขอลา'}</button></form></section>
      <section className="leave-history-card"><header><span>📋</span><div><h2>{mode === 'history' ? 'ประวัติการลาพนักงานทั้งหมด (All Employee Leaves & Print A4)' : 'ประวัติคำขอลาของฉัน (My Leave History)'}</h2><p>{mode === 'history' ? 'สำหรับหัวหน้างานและ Admin ตรวจสอบรายการลาทั้งหมด และพิมพ์ใบลาอนุมัติ' : 'วันที่ลา ประเภทการลา และสถานะคำขอลา'}</p></div>{mode === 'history' && <button className="small-action" onClick={onRefresh}>↻ รีเฟรชข้อมูล</button>}</header>{mode !== 'history' && <><div className="my-leave-quota-heading">โควต้าคงเหลือ</div><div className="my-leave-quota-grid">{quotaCards.map(([icon, label, value, tone]) => <article className={`leave-quota-card ${tone}`} key={`my-${label}`}><div><p>{icon} {label}</p><strong>{text(value)}</strong><small>ตามสิทธิ์ประจำปี (วัน)</small></div><span>{icon}</span></article>)}</div></>}{loading ? <div className="loading-row">กำลังดึงประวัติการลา…</div> : leaveTable(historyRows)}</section>
    </div>
    <ErrorAlert message={error} className="leave-error" />
    {canManage && <section className="leave-pending-card"><header><span>⚡</span><div><h2>รายการใบลาที่รออนุมัติ (Pending Approval Queue)</h2><p>สำหรับหัวหน้างาน (Manager) และผู้ดูแลระบบ (Admin) ในการตรวจสอบสิทธิ์และอนุมัติวันลา</p></div><b>🛡️ สิทธิ์ผู้บริหาร/หัวหน้างาน</b></header>{loading ? <div className="loading-row">กำลังตรวจสอบรายการที่รออนุมัติ…</div> : leaveTable(pendingRows, true)}</section>}
  </section>;
}

function LeavePrintDocument({ row }: { row: DataRow }) {
  const leaveDates = inputDate(row.startDate) === inputDate(row.endDate) ? date(row.startDate) : `${date(row.startDate)} – ${date(row.endDate)}`;
  return <section className="leave-print-document" aria-hidden="true">
    <style media="print">{'@page { size: A4 portrait; margin: 12mm 18mm; }'}</style>
    <div className="leave-print-topline"><span>{formatApprovalDateTime(new Date())}</span><span>Security Management System — แบบบันทึกการลาพนักงานรักษาความปลอดภัย</span></div>
    <div className="leave-print-heading"><h1>ใบขออนุมัติลางาน</h1><p>พนักงานรักษาความปลอดภัย</p></div>
    <div className="leave-print-person"><strong>ชื่อพนักงาน: {text(row.employeeNameSnapshot)}</strong><strong>วันที่พิมพ์: {date(new Date())}</strong></div>
    <table className="leave-print-table"><thead><tr><th>วันที่ลางาน</th><th>ประเภทการลา</th><th>จำนวนวัน</th><th>ผู้ปฏิบัติงานแทน / รายละเอียด</th></tr></thead><tbody><tr><td>{leaveDates}</td><td>{text(row.leaveType)}</td><td>{text(row.dayCount)} วัน</td><td>{text(row.reason)}</td></tr></tbody></table>
    <div className="leave-print-signatures"><div><p>ลงชื่อ........................................................</p><p>(........................................................)</p><strong>หัวหน้าพนักงานรักษาความปลอดภัย</strong></div><div><p>ทราบ / ลงชื่อ..............................................</p><p>(........................................................)</p><strong>ผู้จัดการเขต (ผู้อนุมัติ)</strong></div></div>
    <footer className="leave-print-footer"><span>Security Management System</span><span>1/1</span></footer>
  </section>;
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
  const [leavePrintTarget, setLeavePrintTarget] = useState<DataRow>();
  const [operationPage, setOperationPage] = useState(1);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [operationRefresh, setOperationRefresh] = useState(0);
  const [pendingLeaveCount, setPendingLeaveCount] = useState(0);
  const [employeeRefresh, setEmployeeRefresh] = useState(0);
  const [shiftTypes, setShiftTypes] = useState<DataRow[]>([]);
  const [editor, setEditor] = useState<Editor>();
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState<string>();
  const [dashboardSummary, setDashboardSummary] = useState<DataRow>({});
  const [scheduleMonth, setScheduleMonth] = useState(new Date().toISOString().slice(0, 7));
  const [scheduleDepartment, setScheduleDepartment] = useState('');
  const [leaveSummary, setLeaveSummary] = useState<DataRow>({});
  const [ruleCheckResponse, setRuleCheckResponse] = useState<DataRow>({});
  const [autoSchedulePreview, setAutoSchedulePreview] = useState<DataRow>();
  const [autoScheduleBusy, setAutoScheduleBusy] = useState(false);
  const [employeeAutoScheduleBusyId, setEmployeeAutoScheduleBusyId] = useState<string>();
  const [employeeAutoScheduleTarget, setEmployeeAutoScheduleTarget] = useState<DataRow>();
  const [employeeAutoContinue, setEmployeeAutoContinue] = useState(true);
  const [employeeAutoStartPhase, setEmployeeAutoStartPhase] = useState('D1');
  const [scheduleExportBusy, setScheduleExportBusy] = useState(false);
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, { action: 'create' | 'update' | 'delete'; id?: string; employeeId: string; workDate: string; shiftTypeId?: string; shiftCode?: string; shiftName?: string; startTime?: string; endTime?: string; color?: string; remark?: string; licenseStatus?: string; licenseOverride?: boolean; overrideReason?: string; payload?: unknown }>>({});
  const [batchSaveBusy, setBatchSaveBusy] = useState(false);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
  const [deptMenuOpen, setDeptMenuOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee>();

  useEffect(() => {
    if (!leavePrintTarget) return;
    document.body.classList.add('printing-leave');
    const timer = window.setTimeout(() => window.print(), 80);
    const finishPrint = () => setLeavePrintTarget(undefined);
    window.addEventListener('afterprint', finishPrint, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', finishPrint);
      document.body.classList.remove('printing-leave');
    };
  }, [leavePrintTarget]);

  const saveAllDrafts = async () => {
    if (!auth.token || !Object.keys(scheduleDrafts).length) return;
    setBatchSaveBusy(true); setOperationError(undefined);
    try {
      const defaultType = shiftTypes.find((t) => String(t.code).toUpperCase() === 'D') || shiftTypes[0];
      const validDefaultTypeId = String(defaultType?.id || '');

      const changes = Object.values(scheduleDrafts)
        .filter((d) => Boolean(d.employeeId && d.workDate))
        .map((d) => {
          const shiftTypeId = (d.shiftTypeId && d.shiftTypeId.length >= 10) ? d.shiftTypeId : validDefaultTypeId;
          return {
            action: d.action,
            id: d.id,
            payload: d.action === 'delete' ? undefined : {
              employeeId: String(d.employeeId),
              shiftTypeId,
              workDate: String(d.workDate),
              remark: String(d.remark || 'จัดตารางกะ'),
              locked: true,
              licenseOverride: Boolean(d.licenseOverride),
              overrideReason: String(d.overrideReason || '')
            }
          };
        });

      if (!changes.length) {
        setScheduleDrafts({});
        setBatchSaveBusy(false);
        return;
      }

      await api.batchSaveShifts(auth.token, changes);
      setScheduleDrafts({});
      const updated = await api.scheduleCalendar(auth.token, scheduleMonth, operationPage, scheduleDepartment);
      setOperationResponse(updated);
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : 'บันทึกการเปลี่ยนแปลงไม่สำเร็จ');
    } finally {
      setBatchSaveBusy(false);
    }
  };

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
    if (!auth.token) return;
    api.shiftTypes(auth.token).then((result) => setShiftTypes(result?.data || [])).catch(() => setShiftTypes([]));
  }, [auth.token, operationRefresh]);

  useEffect(() => {
    if (!auth.token || activePage !== 'dashboard') return;
    api.dashboard(auth.token).then((result) => setDashboardSummary(result?.data || {})).catch((reason) => setOperationError(reason instanceof Error ? reason.message : 'ไม่สามารถอ่าน Dashboard ได้'));
  }, [activePage, auth.token, operationRefresh]);

  useEffect(() => {
    if (!auth.token || !['leave', 'leavePending', 'leaveHistory'].includes(activePage)) return;
    api.leaveSummary(auth.token).then((result) => setLeaveSummary(result?.data || {})).catch(() => setLeaveSummary({ linked: false }));
  }, [activePage, auth.token, operationRefresh]);

  useEffect(() => {
    if (!auth.token || !['ADMIN', 'MANAGER'].includes(auth.user?.role || '')) { setPendingLeaveCount(0); return; }
    api.leaveRequests(auth.token, 1).then((result) => setPendingLeaveCount((Array.isArray(result.data) ? result.data : []).filter((row: DataRow) => row.status === 'PENDING').length)).catch(() => setPendingLeaveCount(0));
  }, [auth.token, auth.user?.role, operationRefresh]);

  useEffect(() => {
    if (!auth.token || activePage !== 'rules') return;
    api.ruleChecks(auth.token, scheduleMonth).then((result) => setRuleCheckResponse(result?.data || {})).catch((reason) => setOperationError(reason instanceof Error ? reason.message : 'ไม่สามารถตรวจสอบกฎได้'));
  }, [activePage, auth.token, operationRefresh, scheduleMonth]);

  useEffect(() => {
    if (!auth.token || activePage === 'dashboard' || activePage === 'employees' || activePage === 'shiftSetup' || activePage === 'schedule') return;
    const loaders: Record<Exclude<Page, 'dashboard' | 'employees' | 'shiftSetup' | 'schedule'>, (token: string, page: number) => Promise<DataResponse>> = {
      licenses: api.licenses, approvals: api.scheduleApprovals,
      rules: api.schedulingRules, leave: api.leaveRequests, leavePending: api.leaveRequests, leaveHistory: api.leaveRequests, quota: api.leaveQuotas,
      users: api.users, audit: api.auditEvents, reports: api.reportSummary, settings: api.systemSettings
    };
    setOperationLoading(true);
    setOperationError(undefined);
    setOperationResponse({});
    loaders[activePage](auth.token, operationPage)
      .then((response) => setOperationResponse(response))
      .catch((reason) => setOperationError(reason instanceof Error ? reason.message : 'ไม่สามารถอ่านข้อมูลได้'))
      .finally(() => setOperationLoading(false));
  }, [activePage, auth.token, operationPage, operationRefresh]);

  useEffect(() => {
    if (!auth.token || activePage !== 'schedule') return;
    setOperationLoading(true); setOperationError(undefined);
    api.scheduleCalendar(auth.token, scheduleMonth, operationPage, scheduleDepartment)
      .then((response) => setOperationResponse(response))
      .catch((reason) => setOperationError(reason instanceof Error ? reason.message : 'ไม่สามารถอ่านตารางกะรายเดือนได้'))
      .finally(() => setOperationLoading(false));
  }, [activePage, auth.token, operationPage, operationRefresh, scheduleDepartment, scheduleMonth]);

  useEffect(() => { setOperationPage(1); }, [activePage]);
  useEffect(() => { setOperationPage(1); }, [scheduleDepartment, scheduleMonth]);
  useEffect(() => { setAutoSchedulePreview(undefined); }, [scheduleMonth]);

  const filteredEmployees = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return employees;
    return employees.filter((employee) => [employee.employeeCode, employee.firstName, employee.lastName, employee.department, employee.jobTitle].filter(Boolean).join(' ').toLowerCase().includes(term));
  }, [employees, search]);

  const parentPage: Partial<Record<Page, Page>> = {};
  const navigationPage = parentPage[activePage] || activePage;
  const pageTitle = navigation.flatMap((section) => section.items).find((item) => item.id === navigationPage)?.label || tablePages[activePage as keyof typeof tablePages]?.title || 'Dashboard';
  const pageSubtitle: Record<Page, string> = {
    dashboard: 'ภาพรวม KPI และสถานะการปฏิบัติงาน',
    employees: 'ข้อมูลพนักงานและใบอนุญาตปฏิบัติงาน',
    licenses: 'ทะเบียนใบอนุญาตของพนักงาน',
    shiftSetup: 'กำหนดประเภทกะและเวลาปฏิบัติงาน',
    schedule: 'จัดตารางกะรายเดือนและส่งอนุมัติ',
    approvals: 'ตรวจสอบและอนุมัติตารางกะ',
    leave: 'ยื่นคำขอลา',
    leavePending: 'รายการใบลาที่รออนุมัติ',
    leaveHistory: 'ประวัติการลาพนักงานทั้งหมด',
    quota: 'สิทธิ์และโควต้าวันลา',
    rules: 'ตรวจสอบกฎการทำงานและความพร้อมของกำลังพล',
    reports: 'รายงานสรุปข้อมูลการปฏิบัติงาน',
    users: 'กำหนด Role และแผนกก่อนอนุมัติบัญชี',
    settings: 'การตั้งค่าระบบและข้อมูลความปลอดภัย',
    audit: 'ประวัติการใช้งานและการเปลี่ยนแปลงข้อมูล',
  };
  const initials = auth.user?.displayName?.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'SM';
  const canManage = !auth.isViewingAs && ['ADMIN', 'MANAGER'].includes(auth.user?.role || '');
  const canViewPage = (page: Page) => {
    if (page === 'leavePending') return ['ADMIN', 'MANAGER'].includes(auth.user?.role || '');
    if (page === 'audit') return auth.user?.role === 'ADMIN';
    if (page === 'settings') return auth.user?.role === 'ADMIN';
    if (page === 'users') return ['ADMIN', 'MANAGER'].includes(auth.user?.role || '');
    if (page === 'quota') return auth.user?.role === 'ADMIN';
    if (['licenses', 'reports'].includes(page)) return ['ADMIN', 'MANAGER'].includes(auth.user?.role || '');
    return true;
  };
  const visibleNavigation = navigation
    .map((section) => ({ ...section, items: section.items.filter((item) => canViewPage(item.id)) }))
    .filter((section) => section.items.length > 0);
  const employeeOptions = employees.map((employee) => ({ value: employee.id, label: `${employee.employeeCode} · ${employee.firstName} ${employee.lastName}` }));
  const shiftTypeOptions = shiftTypes.map((shiftType) => ({ value: String(shiftType.id), label: `${text(shiftType.code)} · ${text(shiftType.name)}` }));

  const runEditor = (definition: Omit<Editor, 'submit'>, action: (values: Record<string, string>, files: Record<string, File>) => Promise<unknown>, refresh: 'employees' | 'operations' = 'operations') => {
    setEditorError(undefined);
    setEditor({
      ...definition,
      submit: async (values, files) => {
        setEditorBusy(true); setEditorError(undefined);
        try {
          await action(values, files);
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

  const [shiftEditorTarget, setShiftEditorTarget] = useState<{ shift?: DataRow; defaults?: Record<string, string>; clickPos?: { x: number; y: number } } | null>(null);
  const [licensesData, setLicensesData] = useState<DataRow[]>([]);

  useEffect(() => {
    if (auth.token) {
      api.licenses(auth.token).then(res => setLicensesData(Array.isArray(res.data) ? res.data : [])).catch(() => undefined);
    }
  }, [auth.token, operationRefresh]);

  const openShiftEditor = (shift?: DataRow, defaults: Record<string, string> = {}, e?: React.MouseEvent) => {
    if (!auth.token) return;
    const clickPos = e ? { x: e.clientX, y: e.clientY } : undefined;
    if ((activePage as string) === 'schedule') {
      setShiftEditorTarget({ shift, defaults, clickPos });
      return;
    }
    const fields: FormField[] = [
      { name: 'employeeId', label: 'พนักงาน', type: 'select', required: true, options: employeeOptions },
      { name: 'shiftTypeId', label: 'ประเภทกะ', type: 'select', required: true, options: shiftTypeOptions },
      { name: 'workDate', label: 'วันที่', type: 'date', required: true },
      { name: 'remark', label: 'หมายเหตุ', type: 'textarea' }
    ];
    if (auth.user?.role === 'ADMIN') fields.push(
      { name: 'licenseOverride', label: 'ยืนยัน Override ใบอนุญาต', type: 'select', options: [{ value: 'false', label: 'ไม่ Override' }, { value: 'true', label: 'Override โดย Admin' }] },
      { name: 'overrideReason', label: 'เหตุผล Override', type: 'textarea' }
    );
    const values: Record<string, string> = shift ? {
      employeeId: String(shift.employeeId || ''), shiftTypeId: String(shift.shiftTypeId || nested(shift.shiftType).id || ''),
      workDate: inputDate(shift.workDate), remark: String(shift.remark || ''), licenseOverride: String(Boolean(shift.licenseOverride)), overrideReason: String(shift.overrideReason || '')
    } : { licenseOverride: 'false', ...defaults };
    runEditor({ title: shift ? 'แก้ไขตารางกะ (ใส่ในร่าง)' : 'เพิ่มตารางกะ (ใส่ในร่าง)', submitLabel: shift ? 'ใส่ตารางกะ (ฉบับร่าง)' : 'บันทึกเข้าฉบับร่าง', fields, values }, (form) => {
      if (activePage === 'schedule') {
        const key = `${form.employeeId}_${form.workDate}`;
        const selectedType = shiftTypes.find((t) => String(t.id) === form.shiftTypeId);
        const payload: Record<string, unknown> = formPayload(form, ['remark', 'overrideReason']);
        payload.licenseOverride = form.licenseOverride === 'true';
        setScheduleDrafts((prev) => ({
          ...prev,
          [key]: {
            action: shift ? 'update' : 'create',
            id: shift ? String(shift.id) : undefined,
            employeeId: form.employeeId,
            workDate: form.workDate,
            shiftTypeId: form.shiftTypeId,
            shiftCode: String(selectedType?.code || ''),
            shiftName: String(selectedType?.name || ''),
            startTime: String(selectedType?.startTime || ''),
            endTime: String(selectedType?.endTime || ''),
            color: String(selectedType?.color || '#64748B'),
            remark: form.remark,
            licenseOverride: form.licenseOverride === 'true',
            overrideReason: form.overrideReason,
            payload
          }
        }));
        return Promise.resolve();
      }
      const payload: Record<string, unknown> = formPayload(form, ['remark', 'overrideReason']);
      payload.licenseOverride = form.licenseOverride === 'true';
      return shift ? api.updateShift(auth.token!, String(shift.id), payload) : api.createShift(auth.token!, payload);
    });
  };

  const openCreateOperation = () => {
    if (!auth.token) return;
    if (activePage === 'licenses') runEditor({
      title: 'เพิ่มใบอนุญาตพนักงาน', submitLabel: 'บันทึกใบอนุญาต',
      fields: [{ name: 'employeeId', label: 'พนักงาน', type: 'select', required: true, options: employeeOptions }, { name: 'licenseType', label: 'ประเภทใบอนุญาต', required: true }, { name: 'licenseNumber', label: 'เลขที่ใบอนุญาต', required: true }, { name: 'issueDate', label: 'วันที่ออก', type: 'date', required: true }, { name: 'expiryDate', label: 'วันหมดอายุ', type: 'date', required: true }, { name: 'status', label: 'สถานะ', type: 'select', required: true, options: ['Active', 'Suspended', 'Revoked', 'Inactive'].map((value) => ({ value, label: value })) }, { name: 'documentUrl', label: 'ลิงก์เอกสาร' }, { name: 'remark', label: 'หมายเหตุ', type: 'textarea' }],
      values: { status: 'Active' }
    }, (form) => api.createLicense(auth.token!, formPayload(form, ['documentUrl', 'remark'])));
    if (activePage === 'schedule') openShiftEditor();
    if (activePage === 'leave') runEditor({
      title: 'สร้างคำขอลา', submitLabel: 'ส่งคำขอลา',
      fields: [{ name: 'employeeId', label: 'พนักงาน', type: 'select', required: auth.user?.role !== 'VIEWER', options: employeeOptions }, { name: 'leaveType', label: 'ประเภทการลา', type: 'select', required: true, options: ['ลาป่วย', 'ลากิจ', 'ลาพักร้อน'].map((value) => ({ value, label: value })) }, { name: 'startDate', label: 'วันที่เริ่ม', type: 'date', required: true }, { name: 'endDate', label: 'วันที่สิ้นสุด', type: 'date', required: true }, { name: 'substitute', label: 'ผู้เข้าเวร / ปฏิบัติงานแทน', required: true }, { name: 'reason', label: 'เหตุผล', type: 'textarea' }, { name: 'attachment', label: 'ไฟล์แนบ (ถ้ามี)', type: 'file', accept: '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png', hint: 'PDF, JPG หรือ PNG ขนาดไม่เกิน 4 MB' }],
      values: {}
    }, (form, files) => files.attachment ? api.createLeaveRequestWithAttachment(auth.token!, form, files.attachment) : api.createLeaveRequest(auth.token!, formPayload(form)));
  };

  const openShiftTypeCreator = () => runEditor({
    title: 'เพิ่มรหัสกะ', submitLabel: 'บันทึกรหัสกะ',
    fields: [{ name: 'code', label: 'Shift Code', required: true }, { name: 'name', label: 'ชื่อกะ', required: true }, { name: 'startTime', label: 'เวลาเริ่ม' }, { name: 'endTime', label: 'เวลาเลิก' }, { name: 'hours', label: 'ชั่วโมง', type: 'number', required: true }, { name: 'color', label: 'สี HEX', required: true }],
    values: { color: '#2F80FF', hours: '8' }
  }, (form) => api.createShiftType(auth.token!, formPayload(form, ['startTime', 'endTime'])));

  const handleOperationAction = async (row: DataRow, action: string) => {
    if (!auth.token || !row.id) return;
    const id = String(row.id);
    if (action === 'edit') {
      if (activePage === 'licenses') runEditor({
        title: 'แก้ไขใบอนุญาต', submitLabel: 'บันทึกการแก้ไข',
        fields: [{ name: 'licenseType', label: 'ประเภทใบอนุญาต', required: true }, { name: 'licenseNumber', label: 'เลขที่ใบอนุญาต', required: true }, { name: 'issueDate', label: 'วันที่ออก', type: 'date', required: true }, { name: 'expiryDate', label: 'วันหมดอายุ', type: 'date', required: true }, { name: 'status', label: 'สถานะ', type: 'select', required: true, options: ['Active', 'Suspended', 'Revoked', 'Inactive'].map((value) => ({ value, label: value })) }, { name: 'remark', label: 'หมายเหตุ', type: 'textarea' }],
        values: { licenseType: String(row.licenseType || ''), licenseNumber: String(row.licenseNumber || ''), issueDate: inputDate(row.issueDate), expiryDate: inputDate(row.expiryDate), status: String(row.status || ''), remark: String(row.remark || '') }
      }, (form) => api.updateLicense(auth.token!, id, formPayload(form, ['remark'])));
      else if (activePage === 'schedule') openShiftEditor(row);
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
        fields: [{ name: 'role', label: 'บทบาท', type: 'select', required: true, options: ['ADMIN', 'MANAGER', 'VIEWER'].map((value) => ({ value, label: value })) }, { name: 'department', label: 'หน่วยงาน' }, { name: 'accountStatus', label: 'สถานะบัญชี', type: 'select', required: true, options: ['ACTIVE', 'PENDING', 'SUSPENDED', 'REJECTED'].map((value) => ({ value, label: value })) }],
        values: { role: String(row.role || ''), department: String(row.department || ''), accountStatus: String(row.accountStatus || '') }
      }, (form) => api.updateUser(auth.token!, id, form));
      return;
    }
    if (action === 'reset-password') {
      runEditor({
        title: 'ตั้งรหัสผ่านใหม่', submitLabel: 'ตั้งรหัสผ่านและยกเลิก session เดิม',
        fields: [{ name: 'newPassword', label: 'รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)', type: 'password', required: true }],
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
      else if (['leave', 'leaveHistory'].includes(activePage) && action === 'cancel') await api.cancelLeaveRequest(auth.token, id, 'restore quota from test leave');
      else if (['leave', 'leavePending', 'leaveHistory'].includes(activePage)) await api.updateLeaveRequest(auth.token, id, { status: action === 'approve' ? 'APPROVED' : 'REJECTED' });
      else if (activePage === 'rules') await api.updateSchedulingRule(auth.token, id, { enabled: !row.enabled });
      else if (activePage === 'schedule') await api.updateShift(auth.token, id, { locked: !row.locked });
      else if (activePage === 'users') await api.updateUser(auth.token, id, { isActive: !row.isActive, accountStatus: row.isActive ? 'SUSPENDED' : 'ACTIVE' });
      setOperationRefresh((value) => value + 1);
    } catch (reason) { setOperationError(reason instanceof Error ? reason.message : 'ดำเนินการไม่สำเร็จ'); }
    finally { setOperationLoading(false); }
  };

  const content = () => {
    if (activePage === 'dashboard') {
      const pendingTotal = Number(dashboardSummary.pendingLeaves || 0) + Number(dashboardSummary.pendingUsers || 0) + Number(dashboardSummary.expiringLicenses || 0);
      const todayThaiStr = new Intl.DateTimeFormat('th-TH', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());

      return (
        <section className="view-pane dashboard-page">
          <div className="dashboard-greeting-banner" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 60%, #2563eb 100%)', borderRadius: '16px', padding: '24px 28px', color: '#ffffff', marginBottom: '24px', boxShadow: '0 10px 25px -8px rgba(37, 99, 235, 0.35)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div className="avatar" style={{ width: '48px', height: '48px', fontSize: '18px', background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>{initials}</div>
              <div>
                <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: '#ffffff' }}>สวัสดี, {auth.user?.displayName || 'ผู้ดูแลระบบ'} 👋</h1>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'rgba(255, 255, 255, 0.85)' }}>{todayThaiStr} · บทบาท: <strong style={{ color: '#60a5fa' }}>{auth.user?.role || 'VIEWER'}</strong></p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="live-status" style={{ background: 'rgba(255, 255, 255, 0.15)', borderColor: 'rgba(255, 255, 255, 0.3)', color: '#ffffff' }}><i style={{ background: '#4ade80' }} /> ระบบพร้อมใช้งาน</span>
              <button className="btn-primary compact" style={{ background: '#ffffff', color: '#1e3a8a', fontWeight: 800, border: 'none', borderRadius: '10px', padding: '10px 16px' }} onClick={() => setActivePage('schedule')}>🗓️ ตารางกะรายเดือน</button>
            </div>
          </div>

          <div className="metrics-grid" style={{ marginBottom: '24px' }}>
            <article className="metric-card" style={{ borderLeft: '4px solid #2563eb' }}>
              <span className="metric-icon blue">👥</span>
              <div>
                <p>พนักงานทั้งหมด</p>
                <strong>{text(dashboardSummary.totalEmployees || 0)}</strong>
                <small>ใช้งานจริง <strong style={{ color: '#16a34a' }}>{text(dashboardSummary.activeEmployees || 0)}</strong> คน</small>
              </div>
            </article>

            <article className="metric-card" style={{ borderLeft: '4px solid #10b981' }}>
              <span className="metric-icon green">📅</span>
              <div>
                <p>กะเดือนนี้</p>
                <strong>{text(dashboardSummary.monthShifts || 0)}</strong>
                <small>รวม <strong style={{ color: '#2563eb' }}>{text(dashboardSummary.totalHours || 0)}</strong> ชั่วโมง</small>
              </div>
            </article>

            <article className="metric-card" style={{ borderLeft: '4px solid #f59e0b' }}>
              <span className="metric-icon amber">⚠️</span>
              <div>
                <p>ใบอนุญาตใกล้หมดอายุ</p>
                <strong style={{ color: Number(dashboardSummary.expiringLicenses || 0) > 0 ? '#d97706' : '#1e293b' }}>{text(dashboardSummary.expiringLicenses || 0)}</strong>
                <small>{Number(dashboardSummary.expiringLicenses || 0) > 0 ? 'ต้องต่ออายุภายใน 60 วัน' : 'ไม่มีใบอนุญาตติดบล็อก'}</small>
              </div>
            </article>

            <article className="metric-card" style={{ borderLeft: '4px solid #8b5cf6' }}>
              <span className="metric-icon violet">📝</span>
              <div>
                <p>คำขอลาค้างอนุมัติ</p>
                <strong style={{ color: Number(dashboardSummary.pendingLeaves || 0) > 0 ? '#7c3aed' : '#1e293b' }}>{text(dashboardSummary.pendingLeaves || 0)}</strong>
                <small>{Number(dashboardSummary.pendingLeaves || 0) > 0 ? 'รอผู้บริหารอนุมัติวันลา' : 'ไม่มีคำขอลาค้าง'}</small>
              </div>
            </article>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px', marginBottom: '24px' }}>
            <div className="table-card" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#0f172a' }}>📊 สัดส่วนกะปฏิบัติงานประจำเดือน</h3>
                <span className="record-chip">รวม {text(dashboardSummary.monthShifts || 0)} กะ</span>
              </div>
              <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 16px' }}>การกระจายกำลังพลรักษาความปลอดภัยตามประเภทกะเดือนนี้</p>
              
              <div style={{ display: 'grid', gap: '14px' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
                    <span style={{ color: '#15803d' }}>☀️ กะเช้า (D 07:00–19:00)</span>
                    <span style={{ color: '#15803d' }}>48%</span>
                  </div>
                  <div style={{ height: '8px', background: '#dcfce7', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{ width: '48%', height: '100%', background: '#22c55e', borderRadius: '999px' }} />
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
                    <span style={{ color: '#6b21a8' }}>🌙 กะดึก (N 19:00–07:00)</span>
                    <span style={{ color: '#6b21a8' }}>38%</span>
                  </div>
                  <div style={{ height: '8px', background: '#f3e8ff', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{ width: '38%', height: '100%', background: '#a855f7', borderRadius: '999px' }} />
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
                    <span style={{ color: '#be185d' }}>🏖️ วันหยุด (OFF / AL)</span>
                    <span style={{ color: '#be185d' }}>14%</span>
                  </div>
                  <div style={{ height: '8px', background: '#ffe4e6', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{ width: '14%', height: '100%', background: '#f43f5e', borderRadius: '999px' }} />
                  </div>
                </div>
              </div>
            </div>

            <div className="table-card" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#0f172a' }}>⚡ รายการแจ้งเตือนและการดําเนินการ</h3>
                <span className={`status-badge ${pendingTotal > 0 ? 'pending' : 'active'}`}>
                  {pendingTotal > 0 ? `${pendingTotal} รายการด่วน` : 'ปกติดี'}
                </span>
              </div>

              <div style={{ display: 'grid', gap: '12px' }}>
                {Number(dashboardSummary.expiringLicenses || 0) > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '20px' }}>⚠️</span>
                      <div>
                        <strong style={{ fontSize: '14px', color: '#92400e' }}>มีใบอนุญาต {text(dashboardSummary.expiringLicenses)} รายการใกล้หมดอายุ</strong>
                        <p style={{ margin: 0, fontSize: '12px', color: '#b45309' }}>ตรวจสอบและอัปเดตวันหมดอายุเพื่อป้องกัน License Block</p>
                      </div>
                    </div>
                    <button className="small-action" style={{ borderColor: '#f59e0b', color: '#92400e', background: '#ffffff', whiteSpace: 'nowrap' }} onClick={() => setActivePage('licenses')}>จัดการ</button>
                  </div>
                )}

                {Number(dashboardSummary.pendingLeaves || 0) > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px', background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '20px' }}>⏳</span>
                      <div>
                        <strong style={{ fontSize: '14px', color: '#1e40af' }}>มี {text(dashboardSummary.pendingLeaves)} คำขอลาพักรอการอนุมัติ</strong>
                        <p style={{ margin: 0, fontSize: '12px', color: '#1d4ed8' }}>อนุมัติหรือปฏิเสธคำขอลาเข้าสู่ตารางกะ</p>
                      </div>
                    </div>
                    <button className="small-action" style={{ borderColor: '#3b82f6', color: '#1e40af', background: '#ffffff', whiteSpace: 'nowrap' }} onClick={() => setActivePage('leavePending')}>ตรวจอนุมัติ</button>
                  </div>
                )}

                {Number(dashboardSummary.pendingUsers || 0) > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '20px' }}>👤</span>
                      <div>
                        <strong style={{ fontSize: '14px', color: '#92400e' }}>มี {text(dashboardSummary.pendingUsers)} บัญชีผู้ใช้ใหม่รออนุมัติสิทธิ์</strong>
                        <p style={{ margin: 0, fontSize: '12px', color: '#b45309' }}>กำหนดบทบาท Role และเปิดสิทธิ์เข้าใช้งาน</p>
                      </div>
                    </div>
                    <button className="small-action" style={{ borderColor: '#f59e0b', color: '#92400e', background: '#ffffff', whiteSpace: 'nowrap' }} onClick={() => setActivePage('users')}>อนุมัติบัญชี</button>
                  </div>
                )}

                {pendingTotal === 0 && (
                  <div style={{ padding: '20px', textAlign: 'center', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '12px', color: '#166534' }}>
                    <span style={{ fontSize: '28px', display: 'block', marginBottom: '4px' }}>✓</span>
                    <strong style={{ fontSize: '15px' }}>ไม่พบรายการแจ้งเตือนด่วน</strong>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#15803d' }}>ระบบตารางกะและใบอนุญาตทั้งหมดอยู่ในสถานะปกติ</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="table-card" style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px', background: '#f8fafc' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '20px' }}>🚀</span>
              <div>
                <strong style={{ fontSize: '14px', color: '#0f172a' }}>ทางลัดการใช้งานระบบ (Quick Actions)</strong>
                <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>เข้าสู่เมนูหลักต่างๆ ได้อย่างรวดเร็ว</p>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              <button className="small-action" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setActivePage('schedule')}>🗓️ จัดตารางกะ</button>
              <button className="small-action" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setActivePage('employees')}>👤 ข้อมูลพนักงาน</button>
              <button className="small-action" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setActivePage('licenses')}>▣ ใบอนุญาต</button>
              <button className="small-action" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setActivePage('leave')}>▥ คำขอลา</button>
              <button className="small-action" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setActivePage('rules')}>🛡️ กฎการทำงาน</button>
            </div>
          </div>
        </section>
      );
    }
    if (activePage === 'employees') return (
      <section className="view-pane personnel-directory-page">
        <div className="page-heading"><div><p className="eyebrow">People · personnel operations</p><h1>Personnel Directory</h1><p>ข้อมูลพนักงานและสถานะการปฏิบัติงานจากฐานข้อมูลกลาง</p></div><div className="heading-actions"><button className="small-action" onClick={() => setActivePage('licenses')}>Employee Licenses</button>{canManage && <button className="btn-primary compact" onClick={() => openEmployeeEditor()}>+ เพิ่มพนักงาน</button>}<span className="record-chip">ทั้งหมด {totalCount} คน</span></div></div>
        <div className="toolbar"><label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหารหัส ชื่อ หน่วยงาน หรือตำแหน่ง" /></label><span className="toolbar-count">แสดง {filteredEmployees.length} จาก {totalCount} รายการ</span></div>
        {fetchError && <div className="alert alert-error" role="alert">{fetchError}</div>}
        <div className="table-card">
          {empLoading ? <div className="loading-row">กำลังอ่านข้อมูลพนักงาน…</div> : <div className="table-scroll"><table className="data-table"><thead><tr><th>รหัสพนักงาน</th><th>ชื่อ-นามสกุล</th><th>หน่วยงาน</th><th>ตำแหน่ง</th><th>สถานะ</th>{canManage && <th>ดำเนินการ</th>}</tr></thead><tbody>{filteredEmployees.length ? filteredEmployees.map((employee) => <tr key={employee.id} className="personnel-row"><td><code>{employee.employeeCode}</code></td><td className="employee-name"><button type="button" className="personnel-name-button" onClick={() => setSelectedEmployee(employee)} aria-label={`ดูรายละเอียด ${employee.firstName} ${employee.lastName}`}>{employee.firstName} {employee.lastName}</button></td><td>{employee.department || '-'}</td><td>{employee.jobTitle || '-'}</td><td><span className={employee.isActive ? 'status-badge active' : 'status-badge inactive'}>{employee.isActive ? 'ใช้งาน' : 'ไม่ใช้งาน'}</span></td>{canManage && <td className="row-actions"><button onClick={() => openEmployeeEditor(employee)}>แก้ไข</button>{auth.user?.role === 'ADMIN' && <button className="danger-action" onClick={async () => { if (!auth.token || !window.confirm('ยืนยันการปิดใช้งานพนักงานรายการนี้?')) return; try { await api.deleteEmployee(auth.token, employee.id); setEmployeeRefresh((value) => value + 1); } catch (reason) { setFetchError(reason instanceof Error ? reason.message : 'ปิดใช้งานพนักงานไม่สำเร็จ'); } }}>ปิดใช้งาน</button>}</td>}</tr>) : <tr><td colSpan={canManage ? 6 : 5} className="no-rows">ไม่พบรายการที่ตรงกับคำค้นหา</td></tr>}</tbody></table></div>}
        </div>
      </section>
    );
    if (activePage === 'shiftSetup') return (
      <section className="view-pane">
        <div className="page-heading"><div><p className="eyebrow">ตารางและกฎการทำงาน</p><h1>Shift Setup</h1><p>กำหนดรหัสกะ และเวลาปฏิบัติงานที่ใช้ใน Schedule Calendar</p></div><div className="heading-actions">{auth.user?.role === 'ADMIN' && <button className="btn-primary compact" onClick={openShiftTypeCreator}>+ เพิ่มรหัสกะ</button>}<span className="record-chip">ทั้งหมด {shiftTypes.length} รหัสกะ</span></div></div>
        {operationError && <div className="alert alert-error">{operationError}</div>}
        <div className="table-card"><div className="table-scroll"><table className="data-table"><thead><tr><th>Shift Code</th><th>ชื่อกะ</th><th>เวลาเริ่ม</th><th>เวลาเลิก</th><th>ชั่วโมง</th><th>สี</th>{auth.user?.role === 'ADMIN' && <th>จัดการ</th>}</tr></thead><tbody>{shiftTypes.length ? shiftTypes.map((shiftType) => <tr key={text(shiftType.id)}><td><code>{text(shiftType.code)}</code></td><td className="employee-name">{text(shiftType.name)}</td><td>{text(shiftType.startTime)}</td><td>{text(shiftType.endTime)}</td><td>{text(shiftType.hours)}</td><td><span className="shift-color" style={{ backgroundColor: String(shiftType.color || '#2F80FF') }} /> {text(shiftType.color)}</td>{auth.user?.role === 'ADMIN' && <td className="row-actions"><button className="danger-action" disabled={['D', 'N', 'OFF', 'AL'].includes(String(shiftType.code))} onClick={async () => { if (!auth.token || !window.confirm(`ยืนยันการลบรหัสกะ ${text(shiftType.code)}?`)) return; try { await api.deleteShiftType(auth.token, String(shiftType.id)); setOperationRefresh((value) => value + 1); } catch (reason) { setOperationError(reason instanceof Error ? reason.message : 'ลบรหัสกะไม่สำเร็จ'); } }}>ลบ</button></td>}</tr>) : <tr><td colSpan={auth.user?.role === 'ADMIN' ? 7 : 6} className="no-rows">ยังไม่มีข้อมูลรหัสกะ</td></tr>}</tbody></table></div></div>
      </section>
    );
    if (activePage === 'schedule') {
      const calendar = !Array.isArray(operationResponse.data) ? operationResponse.data || {} : {};
      const dates = Array.isArray(calendar.dates) ? calendar.dates.map(String) : [];
      const rawCalendarEmployees = Array.isArray(calendar.employees) ? calendar.employees as DataRow[] : [];
      const allCalendarEmployees = [...rawCalendarEmployees].sort((a, b) => (String(a.employeeCode || '')).localeCompare(String(b.employeeCode || ''), undefined, { numeric: true }));
      const calendarEmployees = selectedDepartments.length > 0
        ? allCalendarEmployees.filter((emp) => selectedDepartments.includes(text(emp.department)))
        : allCalendarEmployees;
      const approval = nested(calendar.approval);
      const [yStr, mStr] = scheduleMonth.split('-');
      const thaiYearNum = Number(yStr) + 543;
      const monthNameOnly = new Intl.DateTimeFormat('th-TH', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(yStr), Number(mStr) - 1, 1)));
      const monthLabel = `${monthNameOnly} พ.ศ. ${thaiYearNum}`;
      const departments = Array.from(new Set(employees.map((employee) => employee.department || '').filter(Boolean))).sort();
      const moveMonth = (delta: number) => { const value = new Date(`${scheduleMonth}-01T00:00:00Z`); value.setUTCMonth(value.getUTCMonth() + delta); setScheduleMonth(value.toISOString().slice(0, 7)); };
      const previewRows = Array.isArray(autoSchedulePreview?.rows) ? autoSchedulePreview.rows as DataRow[] : [];
      const previewWarnings = Array.isArray(autoSchedulePreview?.warnings) ? autoSchedulePreview.warnings : [];
      const previewSummary = nested(autoSchedulePreview?.summary);

      const applyPreviewToDrafts = (previewRowsParam: DataRow[], replaceEmployeeId?: string) => {
        const newDrafts = { ...scheduleDrafts };
        if (replaceEmployeeId) {
          for (const key of Object.keys(newDrafts)) {
            if (key.startsWith(`${replaceEmployeeId}_`) && String(newDrafts[key].workDate || '').startsWith(scheduleMonth)) delete newDrafts[key];
          }
        }
        for (const row of previewRowsParam) {
          const workDateStr = inputDate(row.date);
          const empId = String(row.employeeId || '');
          if (!empId || !workDateStr) continue;
          const key = `${empId}_${workDateStr}`;
          const codeStr = String(row.code || 'OFF').toUpperCase();
          const selectedType = shiftTypes.find((t) => String(t.code).toUpperCase() === codeStr)
            || shiftTypes.find((t) => String(t.id) === row.shiftTypeId)
            || shiftTypes[0];
          const validShiftTypeId = String(selectedType?.id || '');
          if (!validShiftTypeId || validShiftTypeId.length < 10) continue;

          newDrafts[key] = {
            action: row.existingShiftId ? 'update' : 'create',
            id: row.existingShiftId ? String(row.existingShiftId) : undefined,
            employeeId: empId,
            workDate: workDateStr,
            shiftTypeId: validShiftTypeId,
            shiftCode: codeStr,
            shiftName: String(selectedType?.name || codeStr),
            startTime: String(selectedType?.startTime || (codeStr === 'N' ? '22:00' : codeStr === 'D' ? '08:00' : '00:00')),
            endTime: String(selectedType?.endTime || (codeStr === 'N' ? '06:00' : codeStr === 'D' ? '16:00' : '00:00')),
            color: String(selectedType?.color || (codeStr === 'D' ? '#2563eb' : codeStr === 'N' ? '#7c3aed' : '#64748b')),
            remark: String(row.remark || 'จัดด้วยไม้กายสิทธิ์ (ฉบับร่าง)'),
            licenseStatus: String(row.licenseStatus || ''),
            licenseOverride: Boolean(row.licenseOverride),
            overrideReason: String(row.overrideReason || ''),
            payload: {
              employeeId: empId,
              workDate: workDateStr,
              shiftTypeId: validShiftTypeId,
              remark: String(row.remark || 'จัดด้วยไม้กายสิทธิ์'),
              licenseOverride: Boolean(row.licenseOverride),
              overrideReason: String(row.overrideReason || '')
            }
          };
        }
        setScheduleDrafts(newDrafts);
      };

      const previewAutoSchedule = async () => {
        if (!auth.token) return;
        setAutoScheduleBusy(true); setOperationError(undefined);
        try { const result = await api.previewAutoSchedule(auth.token, scheduleMonth); setAutoSchedulePreview(result.data || {}); }
        catch (reason) { setOperationError(reason instanceof Error ? reason.message : 'สร้างตัวอย่างตารางอัตโนมัติไม่สำเร็จ'); }
        finally { setAutoScheduleBusy(false); }
      };
      const saveAutoSchedule = () => {
        applyPreviewToDrafts(previewRows);
        setAutoSchedulePreview(undefined);
      };
      const openEmployeeScheduleWizard = (employee: DataRow) => {
        if (employeeAutoScheduleBusyId) return;
        setEmployeeAutoContinue(true); setEmployeeAutoStartPhase('D1'); setEmployeeAutoScheduleTarget(employee);
      };
      const exportApprovedExcel = async () => {
        if (!auth.token) return;
        setScheduleExportBusy(true); setOperationError(undefined);
        try {
          const result = await api.exportScheduleExcel(auth.token, { month: scheduleMonth, scope: selectedDepartments.length ? 'selected' : 'all', departments: selectedDepartments });
          downloadBlob(result.blob, result.fileName || `SMS-Schedule-${scheduleMonth}.xlsx`);
        } catch (reason) { setOperationError(reason instanceof Error ? reason.message : 'ส่งออก Excel ไม่สำเร็จ'); }
        finally { setScheduleExportBusy(false); }
      };
      return <section className="view-pane schedule-calendar-page">
        <div className="page-heading"><div><p className="eyebrow">ตารางและกฎการทำงาน</p><h1>Schedule Calendar</h1><p>จัดกะรายเดือน (โหมดบันทึกด้วยตนเอง: แก้ไขกะหรือลบกะในตารางได้ต่อเนื่อง แล้วกด 💾 บันทึกการเปลี่ยนแปลง เพื่อบันทึกทีเดียว)</p></div><div className="heading-actions">{auth.user?.role === 'ADMIN' && !auth.isViewingAs && <button className="small-action" onClick={() => setActivePage('approvals')}>ประวัติการอนุมัติ</button>}{approval.status === 'APPROVED' && <><button className="excel-action" disabled={scheduleExportBusy} onClick={exportApprovedExcel}>▦ {scheduleExportBusy ? 'กำลังสร้าง Excel…' : `Export Excel${selectedDepartments.length ? ` · ${selectedDepartments.length} แผนก` : ''}`}</button><button className="small-action" onClick={() => window.print()}>📄 Export PDF</button></>}</div></div>
        <div className={`approval-banner ${approval.status === 'APPROVED' ? 'approved' : 'pending'}`}><div><strong>{approval.status === 'APPROVED' ? '✓ Approved' : '● Pending Approval'} · {monthLabel}</strong><small>Revision {text(approval.revision || 1)}{approval.approvedAt ? ` · อนุมัติโดย ${text(approval.approvedBy || approval.approvedByDisplayName || 'Admin')} เมื่อ ${date(approval.approvedAt)}` : ' · การแก้ตารางจะสร้าง revision ใหม่โดยอัตโนมัติ'}</small></div>{auth.user?.role === 'ADMIN' && approval.status !== 'APPROVED' && <button className="btn-primary compact" style={{ backgroundColor: '#059669', borderColor: '#047857', fontWeight: 'bold' }} onClick={async () => { if (!auth.token || !window.confirm(`ยืนยันอนุมัติตารางกะประจำเดือน ${monthLabel}?`)) return; setOperationError(undefined); try { if (approval.id) { await api.updateScheduleApproval(auth.token, String(approval.id), { status: 'APPROVED' }); } else { await api.approveScheduleMonth(auth.token, scheduleMonth); } const updated = await api.scheduleCalendar(auth.token, scheduleMonth, operationPage, scheduleDepartment); setOperationResponse(updated); } catch (reason) { setOperationError(reason instanceof Error ? reason.message : 'อนุมัติตารางไม่สำเร็จ'); } }}>Approve ตารางเดือนนี้</button>}</div>
        <div className="calendar-toolbar-box schedule-workbench" style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '16px 20px', margin: '14px 0 16px 0', boxShadow: '0 2px 6px rgba(37, 99, 235, 0.05)' }}>
          <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#1e40af', marginBottom: '8px' }}>
            เลือกเดือนที่จะจัดกะ: {monthLabel} (สูงสุด 1 เดือน)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <MonthGridPicker value={scheduleMonth} onChange={setScheduleMonth} />
            <button className="small-action" onClick={() => moveMonth(-1)}>‹ เดือนก่อน</button>
            <button className="small-action" onClick={() => moveMonth(1)}>เดือนถัดไป ›</button>

            <div style={{ position: 'relative', display: 'inline-block' }}>
              <button
                type="button"
                className="small-action"
                style={{ fontWeight: 600, padding: '7px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}
                onClick={() => setDeptMenuOpen((prev) => !prev)}
              >
                🏢 แผนก: {selectedDepartments.length === 0 ? 'ทุกแผนก' : `${selectedDepartments.length} แผนกที่เลือก`} ▾
              </button>
              {deptMenuOpen && (
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '4px', backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', padding: '10px 12px', zIndex: 100, minWidth: '220px', maxWidth: '300px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid #f1f5f9', fontSize: '12px', fontWeight: 'bold', color: '#475569' }}>
                    <span>เลือกแผนกที่ต้องการกรอง</span>
                    <button type="button" style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0 }} onClick={() => setSelectedDepartments([])}>แสดงทุกแผนก</button>
                  </div>
                  <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {departments.map((dept) => {
                      const checked = selectedDepartments.includes(dept);
                      return (
                        <label key={dept} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#1e293b', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedDepartments((prev) => [...prev, dept]);
                              } else {
                                setSelectedDepartments((prev) => prev.filter((d) => d !== dept));
                              }
                            }}
                          />
                          <span>{dept}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {auth.user?.role === 'ADMIN' && (
              <button className="btn-primary compact" style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #4f46e5 100%)', border: 'none', fontWeight: 'bold', padding: '8px 14px', borderRadius: '8px' }} disabled={autoScheduleBusy} onClick={previewAutoSchedule}>
                {autoScheduleBusy ? 'กำลังคำนวณ…' : '✨ ดูตัวอย่างจัดกะอัตโนมัติ'}
              </button>
            )}
            <button className="small-action" style={{ border: '1px solid #fdba74', color: '#c2410c' }} onClick={() => window.alert('ตารางกะเดิมถูกเก็บในระบบแยกส่วนย้อนหลังแล้ว')}>
              ย้ายตารางกะเก่าไป Schedule Archive
            </button>
            <span className="toolbar-count" style={{ marginLeft: 'auto' }}>แสดง {calendarEmployees.length} จาก {operationResponse.meta?.total || 0} คน</span>
          </div>
          <div title="เครื่องมือไม้กายสิทธิ์สำหรับ Admin — สร้างตัวอย่างก่อนบันทึก โดยคงกะที่ล็อกและวันลา (AL)" style={{ fontSize: '12px', color: '#64748b', marginBottom: '14px' }}>
            ไม่เกิน 72 ชม./สัปดาห์ · Supervisor หยุดวันอาทิตย์ · AL และกะ Manual ไม่ถูกเขียนทับ
          </div>

          <div className="schedule-draft-actions" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', paddingTop: '12px', borderTop: '1px dashed #bfdbfe' }}>
            <button type="button" className="btn-primary compact" style={{ backgroundColor: '#2563eb', padding: '8px 18px', fontWeight: 'bold', fontSize: '14px', borderRadius: '8px', cursor: batchSaveBusy || Object.keys(scheduleDrafts).length === 0 ? 'not-allowed' : 'pointer', opacity: batchSaveBusy || Object.keys(scheduleDrafts).length === 0 ? 0.65 : 1 }} disabled={batchSaveBusy || Object.keys(scheduleDrafts).length === 0} onClick={saveAllDrafts}>
              {batchSaveBusy ? 'กำลังบันทึก…' : `บันทึกการเปลี่ยนแปลงทั้งหมด (${Object.keys(scheduleDrafts).length})`}
            </button>
            <button
              className="btn-danger compact"
              style={{ backgroundColor: '#dc2626', color: '#ffffff', border: '1px solid #b91c1c', fontSize: '13px', fontWeight: 'bold', padding: '8px 16px', borderRadius: '8px', cursor: Object.keys(scheduleDrafts).length === 0 ? 'not-allowed' : 'pointer', opacity: Object.keys(scheduleDrafts).length === 0 ? 0.5 : 1 }}
              disabled={batchSaveBusy || Object.keys(scheduleDrafts).length === 0}
              onClick={() => { if (Object.keys(scheduleDrafts).length > 0 && window.confirm('ยกเลิกรายการเปลี่ยนแปลงทั้งหมดที่ยังไม่ได้บันทึกหรือไม่?')) { setScheduleDrafts({}); } }}
            >
              ยกเลิกรายการเปลี่ยนแปลงทั้งหมด
            </button>
            <span style={{ fontSize: '13px', color: '#475569' }}>
              คลิกช่องกะเพื่อแก้หลายรายการ แล้วค่อยบันทึกครั้งเดียว
            </span>
          </div>
        </div>
        {auth.user?.role === 'ADMIN' && autoSchedulePreview && (
          <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !autoScheduleBusy) setAutoSchedulePreview(undefined); }}>
            <section className="edit-dialog" style={{ maxWidth: '780px', backgroundColor: '#ffffff', borderRadius: '16px', padding: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
              <div className="dialog-heading" style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>🪄 ตัวอย่างตารางจัดกะอัตโนมัติ ( Auto Schedule Preview )</h2>
                <button type="button" style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }} disabled={autoScheduleBusy} onClick={() => setAutoSchedulePreview(undefined)}>×</button>
              </div>

              <div className="preview-summary" style={{ display: 'flex', gap: '16px', marginBottom: '14px', fontSize: '13px', color: '#334155' }}>
                <span><b>{text(previewSummary.employees)}</b> พนักงาน</span>
                <span><b>{text(previewSummary.totalRows)}</b> กะทั้งหมด</span>
                <span><b>{text(previewSummary.manualLocked)}</b> รายการที่คงไว้</span>
                <span><b>{previewWarnings.length}</b> คำเตือน</span>
              </div>

              {previewWarnings.length > 0 && (
                <div className="preview-warning" style={{ backgroundColor: '#fff7ed', border: '1px solid #ffedd5', color: '#c2410c', padding: '12px', borderRadius: '10px', marginBottom: '14px', fontSize: '13px' }}>
                  <strong>รายการที่ต้องตรวจสอบ:</strong>
                  {previewWarnings.slice(0, 8).map((warning, index) => <p key={`${String(warning)}-${index}`} style={{ margin: '4px 0 0 0' }}>• {text(warning)}</p>)}
                </div>
              )}

              <div className="table-scroll preview-table-wrap" style={{ maxHeight: '320px', overflowY: 'auto', marginBottom: '16px', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
                <table className="data-table preview-table" style={{ width: '100%' }}>
                  <thead>
                    <tr><th>พนักงาน</th><th>วันที่</th><th>กะ</th><th>เหตุผล</th></tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(0, 50).map((row, index) => (
                      <tr key={`${text(row.employeeId)}-${text(row.date)}-${index}`}>
                        <td>{text(row.employeeName)}</td>
                        <td>{date(row.date)}</td>
                        <td><span className={`status-badge ${row.code === 'OFF' ? 'inactive' : 'active'}`}>{text(row.code)}</span></td>
                        <td>{text(row.remark)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="preview-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button className="btn-secondary" style={{ padding: '9px 18px', borderRadius: '10px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer' }} disabled={autoScheduleBusy} onClick={() => setAutoSchedulePreview(undefined)}>ยกเลิก Preview</button>
                <button className="btn-primary compact" style={{ padding: '9px 20px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)', color: '#ffffff', fontWeight: 700, cursor: 'pointer' }} disabled={autoScheduleBusy} onClick={saveAutoSchedule}>🪄 ใส่ลงในฉบับร่าง (ยังไม่บันทึก)</button>
              </div>
            </section>
          </div>
        )}
        <ErrorAlert message={operationError} />
        <div className="table-card calendar-card">{operationLoading && !calendarEmployees.length ? <div className="loading-row">กำลังอ่านตารางกะรายเดือน…</div> : <div className="table-scroll" onMouseDown={(e) => { if ((e.target as HTMLElement).closest('button,input,select,textarea,a')) return; const el = e.currentTarget; el.dataset.isDown = 'true'; el.dataset.startX = String(e.pageX - el.offsetLeft); el.dataset.startY = String(e.pageY - el.offsetTop); el.dataset.scrollLeft = String(el.scrollLeft); el.dataset.scrollTop = String(el.scrollTop); }} onMouseLeave={(e) => { e.currentTarget.dataset.isDown = 'false'; }} onMouseUp={(e) => { e.currentTarget.dataset.isDown = 'false'; }} onMouseMove={(e) => { const el = e.currentTarget; if (el.dataset.isDown !== 'true') return; e.preventDefault(); const x = e.pageX - el.offsetLeft; const y = e.pageY - el.offsetTop; const walkX = (x - Number(el.dataset.startX || 0)) * 1.5; const walkY = (y - Number(el.dataset.startY || 0)) * 1.5; el.scrollLeft = Number(el.dataset.scrollLeft || 0) - walkX; el.scrollTop = Number(el.dataset.scrollTop || 0) - walkY; }}><table className="schedule-grid"><thead><tr><th className="employee-sticky">พนักงาน</th>{dates.map((day) => { const dayValue = new Date(`${day}T00:00:00Z`); const weekend = [0, 6].includes(dayValue.getUTCDay()); return <th key={day} className={weekend ? 'weekend' : ''}><b>{dayValue.getUTCDate()}</b><small>{new Intl.DateTimeFormat('th-TH', { weekday: 'short', timeZone: 'UTC' }).format(dayValue)}</small></th>; })}</tr></thead><tbody>{calendarEmployees.length ? calendarEmployees.map((employee) => { const employeeShifts = Array.isArray(employee.shifts) ? employee.shifts as DataRow[] : []; const isSchedulingEmployee = employeeAutoScheduleBusyId === String(employee.id); return <tr key={text(employee.id)}><td className="employee-sticky"><strong>{text(employee.displayName || `${text(employee.firstName)} ${text(employee.lastName)}`)}{canManage && <button className="employee-magic-button" disabled={Boolean(employeeAutoScheduleBusyId)} title="🪄 จัดกะแพทเทิร์นด่วน: 6 วันทำงาน / 1 วันหยุด" onClick={() => openEmployeeScheduleWizard(employee)}>{isSchedulingEmployee ? '…' : '🪄'}</button>}</strong><small>{text(employee.employeeCode)} · {text(employee.department)}</small></td>{dates.map((day) => { const draftKey = `${employee.id}_${day}`; const draftItem = scheduleDrafts[draftKey]; const shift = employeeShifts.find((item) => inputDate(item.workDate) === day); const shiftType = nested(shift?.shiftType); const shiftCode = text(shiftType.code).toLowerCase(); const coreShift = ['d', 'n', 'off', 'al'].includes(shiftCode); const weekend = [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay()); if (draftItem) { if (draftItem.action === 'delete') { return <td key={day} className={weekend ? 'weekend' : ''}><div className="calendar-shift-wrap"><button className="empty-shift" style={{ color: '#ef4444', borderColor: '#fca5a5' }} title="กะถูกลบในฉบับร่าง (คลิกคืนค่า)" onClick={() => { const next = { ...scheduleDrafts }; delete next[draftKey]; setScheduleDrafts(next); }}>✕ ลบแล้ว</button></div></td>; } const draftCore = ['d', 'n', 'off', 'al'].includes((draftItem.shiftCode || '').toLowerCase()); return <td key={day} className={weekend ? 'weekend' : ''}><div className="calendar-shift-wrap"><button className={`calendar-shift shift-${(draftItem.shiftCode || 'd').toLowerCase()}`} style={draftCore ? { border: '2px dashed #2563eb' } : { backgroundColor: String(draftItem.color || '#64748B'), border: '2px dashed #2563eb' }} title="กะฉบับร่าง (ยังไม่ได้บันทึก)" onClick={(e) => canManage && openShiftEditor(undefined, { employeeId: String(employee.id), workDate: day, shiftTypeId: String(draftItem.shiftTypeId || '') }, e)}><b>{text(draftItem.shiftCode)} *</b><small>{text(draftItem.startTime)}–{text(draftItem.endTime)}</small><small className="shift-note" style={{ color: '#2563eb', fontWeight: 'bold' }}>ร่าง</small></button><button className="calendar-delete" title="ยกเลิกฉบับร่าง" onClick={() => { const next = { ...scheduleDrafts }; delete next[draftKey]; setScheduleDrafts(next); }}>×</button></div></td>; } return <td key={day} className={weekend ? 'weekend' : ''}>{shift ? <div className="calendar-shift-wrap"><button className={`calendar-shift shift-${shiftCode}`} style={coreShift ? undefined : { backgroundColor: String(shiftType.color || '#64748B') }} title={`${text(shiftType.name)} · ${text(shift.startTime)}-${text(shift.endTime)}`} onClick={(e) => canManage && openShiftEditor(shift, {}, e)}><b>{text(shiftType.code).toUpperCase()}</b><small>{text(shiftType.code).toUpperCase() === 'OFF' ? 'วันหยุด' : `${text(shift.startTime || '07:00')}–${text(shift.endTime || '19:00')}`}</small>{(() => {
  const licStatus = String(shift.licenseStatus || '').toUpperCase();
  const remarkStr = String(shift.remark || '');
  const isBlocked = ['EXPIRED', 'MISSING', 'INVALID'].includes(licStatus) || remarkStr.toLowerCase().includes('license block') || remarkStr.includes('ใบอนุญาตไม่ผ่าน');
  const isOverridden = licStatus === 'OVERRIDDEN';

  return (
    <>
      {Boolean(shift.locked) && <small className="shift-note" style={{ color: '#d97706', fontWeight: 700, display: 'block' }}>MANUAL 🔒</small>}
      {isOverridden && <small className="shift-note" style={{ color: '#2563eb', fontWeight: 700, display: 'block' }}>OVERRIDE ⚡</small>}
      {isBlocked && <small className="shift-note" style={{ color: '#dc2626', fontWeight: 700, display: 'block' }}>License Block</small>}
    </>
  );
})()}</button>{canManage && <button className="calendar-delete" aria-label={`ลบกะ ${day}`} onClick={() => { const key = `${employee.id}_${day}`; setScheduleDrafts((prev) => ({ ...prev, [key]: { action: 'delete', id: String(shift.id), employeeId: String(employee.id), workDate: day } })); }}>×</button>}</div> : canManage ? <button className="empty-shift" title="เพิ่มกะ" onClick={(e) => openShiftEditor(undefined, { employeeId: String(employee.id), workDate: day }, e)}>+</button> : <span className="empty-shift read-only">–</span>}</td>; })}</tr>; }) : <tr><td colSpan={dates.length + 1} className="no-rows">ไม่มีพนักงานหรือตารางกะในตัวกรองนี้</td></tr>}</tbody></table></div>}</div>
        {operationResponse.meta?.totalPages && operationResponse.meta.totalPages > 1 && <div className="pagination-bar"><button disabled={(operationResponse.meta.page || 1) <= 1 || operationLoading} onClick={() => setOperationPage((operationResponse.meta?.page || 1) - 1)}>‹ ก่อนหน้า</button><span>หน้า {operationResponse.meta.page} จาก {operationResponse.meta.totalPages}</span><button disabled={(operationResponse.meta.page || 1) >= operationResponse.meta.totalPages || operationLoading} onClick={() => setOperationPage((operationResponse.meta?.page || 1) + 1)}>หน้าถัดไป ›</button></div>}
        {employeeAutoScheduleTarget && <EmployeeMagicWandModal target={employeeAutoScheduleTarget} scheduleMonth={scheduleMonth} token={auth.token} busy={Boolean(employeeAutoScheduleBusyId)} onClose={() => setEmployeeAutoScheduleTarget(undefined)} onSubmit={async (autoContinue, startPhase, patternType) => { if (!auth.token || !employeeAutoScheduleTarget || employeeAutoScheduleBusyId) return; const employeeId = String(employeeAutoScheduleTarget.id || ''); if (!employeeId) return; const phase = autoContinue ? 'AUTO' : startPhase; setEmployeeAutoScheduleBusyId(employeeId); setOperationError(undefined); try { const result = await api.previewEmployeeAutoSchedule(auth.token, scheduleMonth, employeeId, phase, patternType); const rows = Array.isArray(result?.data?.rows) ? result.data.rows as DataRow[] : []; applyPreviewToDrafts(rows, employeeId); setEmployeeAutoScheduleTarget(undefined); } catch (reason) { setOperationError(reason instanceof Error ? reason.message : 'สร้างฉบับร่างจัดกะอัตโนมัติรายบุคคลไม่สำเร็จ'); } finally { setEmployeeAutoScheduleBusyId(undefined); } }} />}
        {shiftEditorTarget && (
          <ShiftEditorModal
            shift={shiftEditorTarget.shift}
            defaults={shiftEditorTarget.defaults}
            employees={calendarEmployees.length ? calendarEmployees : (Array.isArray(operationResponse.data) ? operationResponse.data as DataRow[] : [])}
            shiftTypes={shiftTypes}
            licenses={licensesData}
            isAdmin={auth.user?.role === 'ADMIN'}
            onClose={() => setShiftEditorTarget(null)}
            onSubmit={(data) => {
              const key = `${data.employeeId}_${data.workDate}`;
              const selectedType = shiftTypes.find((t) => String(t.id) === data.shiftTypeId);
              const payload: Record<string, unknown> = {
                employeeId: data.employeeId,
                shiftTypeId: data.shiftTypeId,
                workDate: data.workDate,
                remark: data.remark,
                licenseOverride: data.licenseOverride,
                overrideReason: data.overrideReason
              };
              setScheduleDrafts((prev) => ({
                ...prev,
                [key]: {
                  action: shiftEditorTarget.shift ? 'update' : 'create',
                  id: shiftEditorTarget.shift ? String(shiftEditorTarget.shift.id) : undefined,
                  employeeId: data.employeeId,
                  workDate: data.workDate,
                  shiftTypeId: data.shiftTypeId,
                  shiftCode: String(selectedType?.code || ''),
                  shiftName: String(selectedType?.name || ''),
                  startTime: String(selectedType?.startTime || ''),
                  endTime: String(selectedType?.endTime || ''),
                  color: String(selectedType?.color || '#64748B'),
                  remark: data.remark,
                  licenseOverride: data.licenseOverride,
                  overrideReason: data.overrideReason,
                  payload
                }
              }));
              setShiftEditorTarget(null);
            }}
          />
        )}
      </section>;
    }
    if (['leave', 'leavePending', 'leaveHistory'].includes(activePage)) {
      const rows = Array.isArray(operationResponse.data) ? operationResponse.data : [];
      const remaining = nested(leaveSummary.remaining);
        const canCancelApprovedLeave = auth.user?.role === 'ADMIN';
        return <LeaveManagementPage mode={activePage === 'leavePending' ? 'pending' : activePage === 'leaveHistory' ? 'history' : 'all'} historyScope={activePage === 'leaveHistory' ? 'all' : 'mine'} employeeId={String(leaveSummary.employeeId || '')} rows={rows} loading={operationLoading} error={operationError} linked={Boolean(leaveSummary.linked)} remaining={remaining} canManage={canManage} canSubmit={auth.user?.role !== 'VIEWER' || Boolean(leaveSummary.linked)} canCancelApprovedLeave={canCancelApprovedLeave} employeeOptions={employeeOptions} onRefresh={() => setOperationRefresh((value) => value + 1)} onApprove={(row) => handleOperationAction(row, 'approve')} onReject={(row) => handleOperationAction(row, 'reject')} onCancel={(row) => handleOperationAction(row, 'cancel')} onPrint={setLeavePrintTarget} onAttachment={async (row) => { if (!auth.token) return; try { const result = await api.downloadLeaveAttachment(auth.token, String(row.id)); const url = URL.createObjectURL(result.blob); window.open(url, '_blank', 'noopener,noreferrer'); window.setTimeout(() => URL.revokeObjectURL(url), 60000); } catch (reason) { setOperationError(reason instanceof Error ? reason.message : 'เปิดไฟล์แนบไม่สำเร็จ'); } }} onSubmit={async (form, file) => { if (!auth.token) return; if (file) await api.createLeaveRequestWithAttachment(auth.token, form, file); else await api.createLeaveRequest(auth.token, form); setOperationRefresh((value) => value + 1); }} />;
    }
    if (activePage === 'rules') {
      const rules = Array.isArray(operationResponse.data) ? operationResponse.data : [];
      const results = Array.isArray(ruleCheckResponse.ruleResults) ? ruleCheckResponse.ruleResults as DataRow[] : [];
      const violations = Array.isArray(ruleCheckResponse.violations) ? ruleCheckResponse.violations as DataRow[] : [];
      const metrics = nested(ruleCheckResponse.metrics);
      const resultById = new Map(results.map((result) => [String(result.id), result]));
      return <section className="view-pane"><div className="page-heading"><div><p className="eyebrow">ตารางและกฎการทำงาน</p><h1>Rule Checking</h1><p>ตรวจสอบกฎเดิมกับตารางกะจาก PostgreSQL แบบ read-only</p></div><div className="heading-actions"><label className="month-filter"><span>เดือน</span><select value={scheduleMonth} onChange={(event) => setScheduleMonth(event.target.value)} style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 600, fontSize: '13px', backgroundColor: '#ffffff', color: '#0f172a' }}>{Array.from({ length: 24 }, (_, i) => { const d = new Date(Date.UTC(2025, i, 1)); const val = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; const name = new Intl.DateTimeFormat('th-TH', { month: 'long', timeZone: 'UTC' }).format(d); const thaiYear = d.getUTCFullYear() + 543; return <option key={val} value={val}>{name} พ.ศ. {thaiYear}</option>; })}</select></label><button className="small-action" onClick={() => setOperationRefresh((value) => value + 1)}>ตรวจสอบอีกครั้ง</button></div></div>
        {operationError && <div className="alert alert-error">{operationError}</div>}
        <div className="rule-summary-grid"><article><span className={Number(metrics.violations || 0) ? 'rule-state fail' : 'rule-state pass'}>{Number(metrics.violations || 0) ? '!' : '✓'}</span><div><p>รายการขัดกฎทั้งหมด</p><strong>{text(metrics.violations)}</strong></div></article><article><span className="rule-state pass">✓</span><div><p>กฎที่ผ่าน</p><strong>{text(metrics.rulesPassed)} / {text(metrics.rulesChecked)}</strong></div></article><article><span className="rule-state pass">♙</span><div><p>พนักงาน Active</p><strong>{text(metrics.activeEmployees)}</strong></div></article><article><span className="rule-state pass">◷</span><div><p>ชั่วโมงรวม</p><strong>{text(metrics.totalHours)}</strong></div></article></div>
        <div className="table-card"><div className="table-scroll"><table className="data-table"><thead><tr><th>Rule ID</th><th>ชื่อกฎ</th><th>ค่า</th><th>หน่วย</th><th>ผลตรวจ</th>{canManage && <th>จัดการ</th>}</tr></thead><tbody>{operationLoading ? <tr><td colSpan={canManage ? 6 : 5} className="loading-row">กำลังตรวจสอบกฎ…</td></tr> : rules.length ? rules.map((rule) => { const result = resultById.get(String(rule.ruleId)) || {}; return <tr key={text(rule.id)}><td><code>{text(rule.ruleId)}</code></td><td className="employee-name">{text(rule.name)}</td><td>{text(rule.value)}</td><td>{text(rule.unit)}</td><td><span className={`status-badge ${!rule.enabled ? 'inactive' : result.passed ? 'active' : 'pending'}`}>{!rule.enabled ? 'ปิดใช้' : text(result.summary || 'รอตรวจ')}</span></td>{canManage && <td className="row-actions"><button onClick={() => handleOperationAction(rule, 'edit')}>แก้ไข</button><button onClick={() => handleOperationAction(rule, 'toggle')}>{rule.enabled ? 'ปิดใช้' : 'เปิดใช้'}</button></td>}</tr>; }) : <tr><td colSpan={canManage ? 6 : 5} className="no-rows">ยังไม่มีข้อมูลกฎ</td></tr>}</tbody></table></div></div>
        <div className="section-title"><div><h2>รายการที่ต้องแก้ไข</h2><p>{violations.length ? `พบ ${violations.length} รายการ` : 'ผ่านทุกกฎที่เปิดใช้งาน'}</p></div></div>
        <div className="table-card"><div className="table-scroll"><table className="data-table"><thead><tr><th>Rule</th><th>รายการ</th><th>รายละเอียด</th><th>ระดับ</th></tr></thead><tbody>{violations.length ? violations.slice(0, 500).map((item, index) => <tr key={`${text(item.ruleId)}-${index}`}><td><code>{text(item.ruleId)}</code><small className="cell-note">{text(item.ruleName)}</small></td><td className="employee-name">{text(item.title)}</td><td>{text(item.description)}</td><td><span className={`status-badge ${item.severity === 'error' ? 'inactive' : 'pending'}`}>{text(item.severity)}</span></td></tr>) : <tr><td colSpan={4} className="no-rows">✓ ไม่พบรายการขัดกฎในเดือนนี้</td></tr>}</tbody></table></div></div>
      </section>;
    }
    if (activePage === 'users') {
      const users = Array.isArray(operationResponse.data) ? operationResponse.data : [];
      const pendingCount = users.filter((user) => user.accountStatus === 'PENDING').length;
      const departments = Array.from(new Set(users.map((user) => String(user.department || '')).filter(Boolean))).sort();
      const isManager = auth.user?.role === 'MANAGER';
      return <section className="view-pane users-roles-page">
        <div className="page-heading"><div><h1>Users &amp; Roles</h1><p>{isManager ? 'Manager อนุมัติบัญชีใหม่เป็น Viewer และกำหนดแผนก' : 'Admin กำหนด Role และแผนกก่อนอนุมัติบัญชี'}</p></div></div>
        {operationError && <div className="alert alert-error">{operationError}</div>}
        <div className="users-roles-toolbar"><strong>คำขอรออนุมัติ {pendingCount} บัญชี</strong><button className="small-action" disabled={operationLoading} onClick={() => setOperationRefresh((value) => value + 1)}>รีเฟรช</button></div>
        <div className="table-card"><div className="table-scroll"><table className="data-table users-roles-table"><thead><tr><th>User ID</th><th>Name</th><th>Email</th><th>Role</th><th>Department</th><th>Status</th><th>จัดการ</th></tr></thead><tbody>{operationLoading ? <tr><td colSpan={7} className="loading-row">กำลังอ่านข้อมูลบัญชี…</td></tr> : users.length ? users.map((user, index) => <tr key={text(user.id) + index}><td><code>{text(user.legacyUserId || user.id)}</code>{user.role === 'ADMIN' && <small className="user-id-note">Primary Admin</small>}</td><td className="employee-name">{text(user.displayName)}</td><td>{text(user.email)}</td><td>{isManager ? <span>Viewer</span> : <select className="inline-select" name={`role-${text(user.id)}`} defaultValue={text(user.role)}>{['ADMIN', 'MANAGER', 'VIEWER'].map((role) => <option key={role} value={role}>{role[0] + role.slice(1).toLowerCase()}</option>)}</select>}</td><td><select className="inline-select" name={`department-${text(user.id)}`} defaultValue={text(user.department)}><option value="">All</option>{departments.map((department) => <option key={department} value={department}>{department}</option>)}</select></td><td><span className={user.isActive && user.accountStatus === 'ACTIVE' ? 'status-badge active' : 'status-badge inactive'}>{user.isActive && user.accountStatus === 'ACTIVE' ? '● Active' : `● ${text(user.accountStatus)}`}</span></td><td className="row-actions"><button className="btn-primary compact" onClick={async () => { try { const role = isManager ? 'VIEWER' : (document.querySelector(`[name="role-${text(user.id)}"]`) as HTMLSelectElement)?.value; const department = (document.querySelector(`[name="department-${text(user.id)}"]`) as HTMLSelectElement)?.value; await api.updateUser(auth.token!, String(user.id), isManager ? { role, department: department || null, accountStatus: 'ACTIVE', isActive: true } : { role, department: department || null }); setOperationRefresh((value) => value + 1); } catch (reason) { setOperationError(reason instanceof Error ? reason.message : 'บันทึกสิทธิ์ไม่สำเร็จ'); } }}>{isManager ? 'อนุมัติเป็น Viewer' : 'บันทึกสิทธิ์'}</button>{!isManager && <><button onClick={() => handleOperationAction(user, 'toggle-user')}>{user.isActive ? 'ระงับ' : 'เปิดใช้งาน'}</button><button onClick={() => handleOperationAction(user, 'reset-password')}>ตั้งรหัสผ่าน</button>{String(user.id) !== auth.originalUser?.id && user.isActive && user.accountStatus === 'ACTIVE' && <button className="view-as-action" onClick={async () => { if (!window.confirm(`เปิดมุมมองของ ${text(user.displayName)} แบบอ่านอย่างเดียว?`)) return; try { await auth.beginViewAs(String(user.id)); setActivePage('dashboard'); } catch (reason) { setOperationError(reason instanceof Error ? reason.message : 'เปิด View As ไม่สำเร็จ'); } }}>🐞 View As</button>}</>}</td></tr>) : <tr><td colSpan={7} className="no-rows">ไม่มีข้อมูลบัญชีผู้ใช้</td></tr>}</tbody></table></div></div>
      </section>;
    }
    if (activePage === 'settings') {
      const settings = Array.isArray(operationResponse.data) ? operationResponse.data : [];
      return <SettingsPage settings={settings} loading={operationLoading} error={operationError} onRefresh={() => setOperationRefresh((value) => value + 1)} onAudit={() => setActivePage('audit')} onSaveTemplates={async (newLeave, leaveStatus) => { if (!auth.token) return; await Promise.all([api.updateSystemSetting(auth.token, 'LINE_TEMPLATE_NEW_LEAVE', { value: newLeave, description: 'เทมเพลตข้อความคำขอลาใหม่ (รูปแบบเดิม)' }), api.updateSystemSetting(auth.token, 'LINE_TEMPLATE_LEAVE_STATUS', { value: leaveStatus, description: 'เทมเพลตข้อความอัปเดตสถานะการลา (รูปแบบเดิม)' })]); setOperationRefresh((value) => value + 1); }} />;
    }
    if (activePage === 'reports') {
      const summary = !Array.isArray(operationResponse.data) ? operationResponse.data || {} : {};
      const cards: Array<[string, unknown]> = [['พนักงานทั้งหมด', summary.employees], ['พนักงานที่ใช้งาน', summary.activeEmployees], ['ใบอนุญาต', summary.licenses], ['รายการกะ', summary.shifts], ['คำขอลา', summary.leaveRequests], ['โควตาวันลา', summary.leaveQuotas], ['บัญชีผู้ใช้', summary.users]];
      return <section className="view-pane"><div className="page-heading"><div><p className="eyebrow">รายงาน</p><h1>รายงานและส่งออก</h1><p>ยอดรวมจากฐานข้อมูลกลาง ณ เวลาที่เปิดหน้านี้</p></div></div>{operationError && <div className="alert alert-error">{operationError}</div>}<div className="metrics-grid report-grid">{operationLoading ? <div className="loading-row">กำลังสรุปข้อมูล…</div> : cards.map(([label, value]) => <article className="metric-card" key={String(label)}><span className="metric-icon blue">▦</span><div><p>{label}</p><strong>{text(value)}</strong><small>รายการใน staging</small></div></article>)}</div></section>;
    }
    return <OperationalTable page={activePage as Exclude<Page, 'dashboard' | 'employees' | 'reports' | 'shiftSetup' | 'settings' | 'leavePending' | 'leaveHistory'>} response={operationResponse} loading={operationLoading} error={operationError} onPageChange={setOperationPage} onAction={handleOperationAction} onCreate={openCreateOperation} onNavigate={setActivePage} role={auth.user?.role || 'VIEWER'} />;
  };

  const printData = useMemo(() => {
    if (activePage !== 'schedule') return null;
    const calendar = !Array.isArray(operationResponse.data) ? operationResponse.data || {} : {};
    const dates = Array.isArray(calendar.dates) ? calendar.dates.map(String) : [];
    const rawCalendarEmployees = Array.isArray(calendar.employees) ? calendar.employees as DataRow[] : [];
    const allCalendarEmployees = [...rawCalendarEmployees].sort((a, b) => (String(a.employeeCode || '')).localeCompare(String(b.employeeCode || ''), undefined, { numeric: true }));
    const calendarEmployees = selectedDepartments.length > 0
      ? allCalendarEmployees.filter((emp) => selectedDepartments.includes(text(emp.department)))
      : allCalendarEmployees;
    const approval = nested(calendar.approval);
    const [yStr, mStr] = scheduleMonth.split('-');
    const thaiYearNum = Number(yStr) + 543;
    const monthNameOnly = new Intl.DateTimeFormat('th-TH', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(yStr), Number(mStr) - 1, 1)));
    const printMonthLabel = `${monthNameOnly} ${thaiYearNum}`;
    const printDepartments = Array.from(new Set(calendarEmployees.map((e) => String(e.department || '')))).sort();

    return {
      dates,
      calendarEmployees,
      approval,
      printMonthLabel,
      printDepartments
    };
  }, [activePage, operationResponse, selectedDepartments, scheduleMonth]);

  return (
    <>
      <div className={`app-shell ${auth.isViewingAs ? 'view-as-active' : ''}`}>
      {editor && <EditDialog editor={editor} busy={editorBusy} error={editorError} onClose={() => { setEditor(undefined); setEditorError(undefined); }} />}
      <PersonnelDetailDrawer employee={selectedEmployee} canManage={canManage} onClose={() => setSelectedEmployee(undefined)} onEdit={() => { if (!selectedEmployee) return; openEmployeeEditor(selectedEmployee); setSelectedEmployee(undefined); }} />
      {auth.isViewingAs && <div className="view-as-banner" role="status"><span>🐞 กำลังดูระบบในมุมมอง <strong>{auth.user?.displayName}</strong> ({auth.user?.role}) · อ่านอย่างเดียว</span><button onClick={() => { auth.endViewAs(); setActivePage('users'); }}>กลับสู่บัญชี Admin</button></div>}
      {mobileMenuOpen && <button className="sidebar-overlay" aria-label="ปิดเมนู" onClick={() => setMobileMenuOpen(false)} />}
      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-brand"><Logo /><div><strong>SMS v3</strong><span>Security Management System</span></div></div>
        <nav className="nav-menu" aria-label="เมนูหลัก">{visibleNavigation.map((section) => (
          <div className="nav-section" key={section.label}><p>{section.label}</p>{section.items.map((item) => <button type="button" key={item.id} className={`nav-item ${navigationPage === item.id ? 'active' : ''}`} onClick={() => { setActivePage(item.id); setMobileMenuOpen(false); }}><span className="nav-icon">{item.icon}</span><span>{item.label}{item.id === 'leavePending' && pendingLeaveCount > 0 && <b className="nav-count-badge">{pendingLeaveCount}</b>}</span></button>)}</div>
        ))}</nav>
        <button className="sidebar-user" onClick={() => auth.logout()} title="ออกจากระบบ"><span className="avatar">{initials}</span><span><b>{auth.user?.displayName || 'ผู้ใช้งาน'}</b><small>{auth.user?.role || 'VIEWER'} · ออกจากระบบ</small></span><i>↗</i></button>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu-button" aria-label="เปิดเมนู" onClick={() => setMobileMenuOpen(true)}>☰</button>
            <span className="mobile-brand"><Logo /> SMS v3</span>
            <span className="topbar-copy"><strong>{pageTitle}</strong><small>{pageSubtitle[navigationPage]}</small></span>
          </div>
          <div className="topbar-actions">
            <label className="topbar-search"><span aria-hidden="true">⌕</span><input aria-label="ค้นหาพนักงาน" placeholder="ค้นหา..." value={search} onChange={(event) => { setSearch(event.target.value); if (event.target.value && activePage !== 'employees') setActivePage('employees'); }} /></label>
            <button className="topbar-icon" type="button" title="การแจ้งเตือน" aria-label="การแจ้งเตือน">♢</button>
            <span className="environment-pill">{import.meta.env.PROD ? 'DEPLOYED' : 'LOCAL'}</span>
            <span className="topbar-profile" title="บัญชีผู้ใช้งาน"><span className="avatar">{initials}</span><span><b>{auth.user?.displayName || 'ผู้ใช้งาน'}</b><small>{auth.user?.role || 'VIEWER'}</small></span></span>
            <button className="signout-button" onClick={() => auth.logout()}>ออกจากระบบ</button>
          </div>
        </header>
        <nav className="mobile-nav-strip" aria-label="เมนูหลักสำหรับมือถือและแท็บเล็ต">
          {visibleNavigation.map((section) => (
            <div className="mobile-nav-group" key={section.label}>
              <span className="mobile-nav-section">{section.label}</span>
              {section.items.map((item) => <button type="button" key={item.id} className={`mobile-nav-item ${navigationPage === item.id ? 'active' : ''}`} onClick={() => { setActivePage(item.id); setMobileMenuOpen(false); }}><span>{item.icon}</span>{item.label}{item.id === 'leavePending' && pendingLeaveCount > 0 && <b className="nav-count-badge">{pendingLeaveCount}</b>}</button>)}
            </div>
          ))}
        </nav>
        <div className="content-area">{content()}</div>
      </main>
    </div>
    {printData && (
      <div className="print-only">
        {printData.printDepartments.map((dept) => {
          const deptEmployees = printData.calendarEmployees.filter((e) => String(e.department || '') === dept);
          return (
            <div className="print-page" key={dept}>
              <div className="print-header">
                Security Management System - ตารางกะที่อนุมัติแล้ว - {printData.printMonthLabel}
              </div>
              <div className="print-metadata">
                <div className="print-metadata-left">
                  <span>แผนก: <strong>{dept || 'ทั่วไป'}</strong></span>
                  <span style={{ marginLeft: '12px' }}>Revision: <strong>{text(printData.approval.revision || 1)}</strong></span>
                  <span style={{ marginLeft: '12px' }}>อนุมัติโดย: <strong>{text(printData.approval.approvedBy || printData.approval.approvedByDisplayName || 'Admin')}</strong></span>
                  <span style={{ marginLeft: '12px' }}>วันที่อนุมัติ: <strong>{printData.approval.approvedAt ? formatApprovalDateTime(printData.approval.approvedAt) : '-'}</strong></span>
                </div>
                <div className="print-metadata-right">
                  <span>Export โดย: <strong>{auth.user?.email || 'Admin'}</strong></span>
                  <span style={{ marginLeft: '12px' }}>วันที่ Export: <strong>{formatApprovalDateTime(new Date())}</strong></span>
                </div>
              </div>
              <table className="print-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>ลำดับ</th>
                    <th>ชื่อ-นามสกุล</th>
                    <th>ตำแหน่ง</th>
                    {printData.dates.map((day) => {
                      const dayValue = new Date(`${day}T00:00:00Z`);
                      const dayOfWeek = dayValue.getUTCDay();
                      let thClass = '';
                      if (dayOfWeek === 6) thClass = 'weekend sat';
                      else if (dayOfWeek === 0) thClass = 'weekend sun';
                      return (
                        <th key={day} className={thClass}>
                          <b>{dayValue.getUTCDate()}</b>
                          <small>{new Intl.DateTimeFormat('th-TH', { weekday: 'short', timeZone: 'UTC' }).format(dayValue).replace(/\./g, '')}</small>
                        </th>
                      );
                    })}
                    <th>ชม.รวมเดือน</th>
                  </tr>
                </thead>
                <tbody>
                  {deptEmployees.map((employee, idx) => {
                    const employeeShifts = Array.isArray(employee.shifts) ? (employee.shifts as DataRow[]) : [];
                    let totalHours = 0;
                    return (
                      <tr key={String(employee.id)}>
                        <td>{idx + 1}</td>
                        <td className="emp-name-col">
                          {text(employee.displayName || `${text(employee.firstName)} ${text(employee.lastName)}`)}
                        </td>
                        <td className="emp-role-col">{text(employee.jobTitle || 'Security Guard')}</td>
                        {printData.dates.map((day) => {
                          const shift = employeeShifts.find((item) => inputDate(item.workDate) === day);
                          const shiftType = nested(shift?.shiftType);
                          const shiftTypeCode = shift ? String(shiftType.code || '').toUpperCase() : 'OFF';
                          const dayValue = new Date(`${day}T00:00:00Z`);
                          const dayOfWeek = dayValue.getUTCDay();
                          const hours = shift ? Number(shift.hours || 0) : 0;
                          totalHours += hours;

                          let cellClass = `shift-cell-${shiftTypeCode.toLowerCase()}`;
                          if (dayOfWeek === 6) cellClass += ' sat';
                          if (dayOfWeek === 0) cellClass += ' sun';

                          return (
                            <td key={day} className={cellClass}>
                              {shiftTypeCode}
                            </td>
                          );
                        })}
                        <td style={{ fontWeight: 'bold' }}>{totalHours.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="print-legend">
                  <div style={{ fontWeight: 'bold', marginBottom: '6px', fontSize: '10px', color: '#1e293b' }}>คำอธิบายรหัสกะ</div>
                  <table className="print-legend-table">
                    <tbody>
                      {shiftTypes.map((t) => {
                        const codeStr = text(t.code).toUpperCase();
                        const badgeClass = `print-legend-badge badge-${codeStr.toLowerCase()}`;
                        return (
                          <tr key={String(t.id)}>
                            <td style={{ width: '40px', textAlign: 'center' }}>
                              <span className={badgeClass} style={['D', 'N', 'OFF', 'AL'].includes(codeStr) ? undefined : { backgroundColor: String(t.color || '#cbd5e1'), color: '#fff' }}>
                                {codeStr}
                              </span>
                            </td>
                            <td style={{ fontWeight: 'bold' }}>{text(t.name)}</td>
                            <td>{codeStr === 'OFF' ? '-' : `${text(t.startTime)} - ${text(t.endTime)}`}</td>
                            <td>{Number(t.hours || 0)} ชม.</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
              </div>
              <div className="print-footer-container">
                <div className="print-signatures">
                  <div className="signature-box">
                    <div>ลงชื่อ....................................................................................</div>
                    <div style={{ marginTop: '4px' }}>(....................................................................................)</div>
                    <div className="signature-title">พนักงานผู้จัดพิมพ์รายงาน / หัวหน้าพนักงานรักษาความปลอดภัย</div>
                  </div>
                  <div className="signature-box">
                    <div>ทราบ / ลงชื่อ..........................................................................</div>
                    <div style={{ marginTop: '4px' }}>(....................................................................................)</div>
                    <div className="signature-title">ผู้จัดการเขต (ผู้อนุมัติ)</div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    )}
    {leavePrintTarget && <LeavePrintDocument row={leavePrintTarget} />}
    </>
  );
}

function App() {
  const auth = useContext(AuthContext)!;
  if (auth.loading) return <div className="full-loader">กำลังเตรียมระบบ…</div>;
  return auth.token ? <Dashboard /> : <Login />;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthProvider><App /></AuthProvider></React.StrictMode>);
