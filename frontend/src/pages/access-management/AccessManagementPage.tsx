import { useEffect, useMemo, useRef, useState } from 'react';
import {
  accessManagementState,
  accessSummary,
  accountStatusLabel,
  accountStatusTone,
  executeConfirmedViewAs,
  isAccountActive,
  visibleAccountActions,
  viewAsConfirmation,
  type AccountRecord,
  type AccessRole
} from '../../components/access-management/access-management-utils';
import '../../styles/access-management.css';

type AccountUpdate = { role?: string; department?: string | null; accountStatus?: string; isActive?: boolean };
type Props = {
  rows: AccountRecord[];
  loading: boolean;
  error?: string;
  role: AccessRole;
  originalUserId?: string;
  onRefresh(): void;
  onUpdate(id: string, payload: AccountUpdate): Promise<unknown>;
  onResetPassword(id: string, password: string): Promise<unknown>;
  onViewAs(id: string): Promise<unknown>;
  onOpenAudit(): void;
};

type Dialog = 'edit' | 'approve' | 'reset' | 'view-as' | 'confirm' | undefined;

const roleLabel: Record<string, string> = { ADMIN: 'ผู้ดูแลระบบ', MANAGER: 'ผู้จัดการ', VIEWER: 'ผู้ใช้งาน' };
const statusLabel: Record<string, string> = { ACTIVE: 'ใช้งานอยู่', PENDING: 'รออนุมัติ', SUSPENDED: 'ระงับใช้งาน', REJECTED: 'ไม่อนุมัติ' };

function formatDate(value?: string) {
  if (!value) return 'ไม่ระบุ';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'ไม่ระบุ' : new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' }).format(date);
}

function AccountStatusBadge({ account }: { account: AccountRecord }) {
  const tone = accountStatusTone(account);
  return <span className={`account-status account-status--${tone}`}><span aria-hidden="true">●</span>{accountStatusLabel(account)}</span>;
}

function ResetBadge({ required }: { required?: boolean }) {
  return <span className={`reset-badge ${required ? 'reset-badge--required' : ''}`}>{required ? 'ต้องรีเซ็ตรหัสผ่าน' : 'ปกติ'}</span>;
}

function AccessSummaryCards({ rows, manager }: { rows: AccountRecord[]; manager: boolean }) {
  const summary = accessSummary(rows);
  const cards = manager
    ? [{ label: 'รายการที่รออนุมัติ', value: summary.pending, note: 'เฉพาะบัญชีที่แสดงในพื้นที่ทำงานนี้', icon: '◷', tone: 'indigo' }]
    : [
      { label: 'บัญชีทั้งหมด', value: summary.total, note: 'จากรายการที่ระบบส่งกลับ', icon: '♙', tone: 'indigo' },
      { label: 'ใช้งานอยู่', value: summary.active, note: 'บัญชีที่ Active', icon: '✓', tone: 'green' },
      { label: 'รออนุมัติ', value: summary.pending, note: 'ต้องกำหนดสิทธิ์ก่อนใช้งาน', icon: '◷', tone: 'amber' },
      { label: 'ระงับใช้งาน', value: summary.suspended, note: 'ไม่สามารถเข้าสู่ระบบได้', icon: '!', tone: 'red' },
      { label: 'ต้องรีเซ็ตรหัสผ่าน', value: summary.resetRequired, note: 'ตรวจสอบก่อนเปิดใช้งาน', icon: '⌘', tone: 'purple' }
    ];
  return <div className={`access-summary-grid ${manager ? 'access-summary-grid--manager' : ''}`}>{cards.map((card) => <article className={`access-summary-card access-summary-card--${card.tone}`} key={card.label}><span className="access-summary-icon" aria-hidden="true">{card.icon}</span><div><p>{card.label}</p><strong>{card.value}</strong><small>{card.note}</small></div></article>)}</div>;
}

function AccountTable({ rows, role, originalUserId, loading, onDetails, onEdit, onApprove, onReset, onViewAs, onToggle }: {
  rows: AccountRecord[]; role: AccessRole; originalUserId?: string; loading: boolean;
  onDetails(account: AccountRecord, trigger?: HTMLElement): void; onEdit(account: AccountRecord): void; onApprove(account: AccountRecord): void;
  onReset(account: AccountRecord): void; onViewAs(account: AccountRecord): void; onToggle(account: AccountRecord): void;
}) {
  if (loading) return <div className="access-table-card" aria-busy="true"><div className="access-table-skeleton">{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</div></div>;
  if (!rows.length) return <div className="access-state"><span aria-hidden="true">♙</span><h2>ยังไม่มีบัญชีที่แสดงได้</h2><p>เมื่อมีบัญชีอยู่ในขอบเขตสิทธิ์ของคุณ ระบบจะแสดงรายการที่นี่</p></div>;
  return <div className="access-table-card"><div className="access-table-scroll"><table className="access-table"><thead><tr><th scope="col">ชื่อที่แสดง</th><th scope="col">บทบาท</th><th scope="col">หน่วยงาน</th><th scope="col">สถานะบัญชี</th><th scope="col">สถานะใช้งาน</th><th scope="col">ความปลอดภัย</th><th scope="col">อัปเดตล่าสุด</th><th scope="col"><span className="sr-only">จัดการบัญชี</span></th></tr></thead><tbody>{rows.map((account) => {
    const actions = visibleAccountActions(role, account, originalUserId);
    return <tr key={account.id} tabIndex={0} onClick={(event) => onDetails(account, event.currentTarget)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onDetails(account, event.currentTarget); } }}>
      <td><strong>{account.displayName || 'ไม่ระบุชื่อ'}</strong><small>บัญชีผู้ใช้งาน</small></td>
      <td><span className="role-badge">{roleLabel[account.role || ''] || account.role || 'ไม่ระบุ'}</span></td>
      <td>{account.department || 'ไม่ระบุหน่วยงาน'}</td>
      <td><span className={`access-account-state access-account-state--${String(account.accountStatus || '').toLowerCase()}`}>{statusLabel[String(account.accountStatus || '')] || 'ไม่ระบุ'}</span></td>
      <td><AccountStatusBadge account={account} /></td>
      <td><ResetBadge required={account.passwordResetRequired} /></td>
      <td>{formatDate(account.updatedAt || account.createdAt)}</td>
      <td onClick={(event) => event.stopPropagation()}><div className="account-row-actions"><button type="button" className="btn-neutral" onClick={(event) => onDetails(account, event.currentTarget)}>รายละเอียด</button>{actions.includes('approve') && <button type="button" className="btn-success" onClick={() => onApprove(account)}>อนุมัติ</button>}{actions.includes('edit') && <button type="button" className="btn-neutral icon-action" aria-label={`แก้ไขบัญชี ${account.displayName || ''}`} onClick={() => onEdit(account)}>✎</button>}</div></td>
    </tr>;
  })}</tbody></table></div><div className="access-mobile-cards">{rows.map((account) => <article className="account-mobile-card" key={account.id}><div><span className="account-mobile-label">บัญชีผู้ใช้งาน</span><h2>{account.displayName || 'ไม่ระบุชื่อ'}</h2><p>{roleLabel[account.role || ''] || account.role || 'ไม่ระบุ'} · {account.department || 'ไม่ระบุหน่วยงาน'}</p></div><div className="account-mobile-status"><AccountStatusBadge account={account} /><ResetBadge required={account.passwordResetRequired} /></div><footer><small>อัปเดต {formatDate(account.updatedAt || account.createdAt)}</small><button type="button" className="btn-neutral" onClick={(event) => onDetails(account, event.currentTarget)}>เปิดรายละเอียด</button></footer></article>)}</div></div>;
}

function AccountDrawer({ account, role, originalUserId, suspendEscape = false, onClose, onEdit, onApprove, onReset, onViewAs, onToggle, onOpenAudit }: {
  account?: AccountRecord; role: AccessRole; originalUserId?: string; suspendEscape?: boolean; onClose(): void; onEdit(account: AccountRecord): void; onApprove(account: AccountRecord): void; onReset(account: AccountRecord): void; onViewAs(account: AccountRecord, trigger?: HTMLElement): void; onToggle(account: AccountRecord): void; onOpenAudit(): void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!account) return; const timer = window.setTimeout(() => closeRef.current?.focus(), 0); return () => window.clearTimeout(timer); }, [account]);
  useEffect(() => { if (!account) return; const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; if (!suspendEscape) window.addEventListener('keydown', onKey); return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = previous; }; }, [account, onClose, suspendEscape]);
  if (!account) return null;
  const actions = visibleAccountActions(role, account, originalUserId);
  return <div className="account-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="account-drawer" role="dialog" aria-modal="true" aria-labelledby="account-drawer-title"><header><div><p>ACCOUNT DETAILS</p><h2 id="account-drawer-title">{account.displayName || 'บัญชีผู้ใช้งาน'}</h2><span>{roleLabel[account.role || ''] || account.role || 'ไม่ระบุบทบาท'}</span></div><button ref={closeRef} className="drawer-close" type="button" onClick={onClose} aria-label="ปิดรายละเอียดบัญชี">×</button></header><div className="account-drawer-body"><section><h3>ภาพรวมบัญชี</h3><dl><div><dt>บทบาท</dt><dd>{roleLabel[account.role || ''] || account.role || 'ไม่ระบุ'}</dd></div><div><dt>หน่วยงาน</dt><dd>{account.department || 'ไม่ระบุหน่วยงาน'}</dd></div><div><dt>อัปเดตล่าสุด</dt><dd>{formatDate(account.updatedAt || account.createdAt)}</dd></div></dl></section><section><h3>สถานะการเข้าถึง</h3><div className="drawer-status-grid"><div><span>สถานะบัญชี</span><b>{statusLabel[String(account.accountStatus || '')] || 'ไม่ระบุ'}</b></div><div><span>สถานะใช้งาน</span><AccountStatusBadge account={account} /></div></div></section><section><h3>ความปลอดภัยของบัญชี</h3><p className="drawer-security-copy">{account.passwordResetRequired ? 'บัญชีนี้ต้องตั้งรหัสผ่านใหม่ก่อนใช้งานตามขั้นตอนที่ระบบรองรับ' : 'ไม่มีข้อกำหนดเปลี่ยนรหัสผ่านที่ระบบส่งกลับในขณะนี้'}</p></section><section><h3>ประวัติการเปลี่ยนแปลง</h3><p className="drawer-security-copy">ดูเฉพาะเหตุการณ์ที่ได้รับอนุญาตจาก Audit &amp; Compliance โดยไม่แสดงข้อมูลอ่อนไหว</p><button className="btn-info" type="button" onClick={onOpenAudit}>ดู Audit &amp; Compliance</button></section></div><footer>{actions.includes('approve') && <button type="button" className="btn-success" onClick={() => onApprove(account)}>อนุมัติบัญชีเป็น Viewer</button>}{actions.includes('edit') && <button type="button" className="btn-primary" onClick={() => onEdit(account)}>แก้ไขบัญชี</button>}{actions.includes('reset-password') && <button type="button" className="btn-warning" onClick={() => onReset(account)}>รีเซ็ตรหัสผ่าน</button>}{actions.includes('view-as') && <button type="button" className="btn-warning" onClick={(event) => onViewAs(account, event.currentTarget)}>ดูในมุมมองผู้ใช้ (View As)</button>}{actions.includes('suspend') && <button type="button" className="btn-danger" onClick={() => onToggle(account)}>ระงับใช้งาน</button>}{actions.includes('activate') && <button type="button" className="btn-success" onClick={() => onToggle(account)}>เปิดใช้งาน</button>}<button type="button" className="btn-neutral" onClick={onClose}>ปิด</button></footer></aside></div>;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose(): void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { const timer = window.setTimeout(() => closeRef.current?.focus(), 0); const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', onKey); return () => { window.clearTimeout(timer); window.removeEventListener('keydown', onKey); }; }, [onClose]);
  return <div className="account-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="account-modal" role="dialog" aria-modal="true" aria-labelledby="account-modal-title"><header><h2 id="account-modal-title">{title}</h2><button ref={closeRef} type="button" className="drawer-close" onClick={onClose} aria-label="ปิดหน้าต่าง">×</button></header>{children}</section></div>;
}

export function AccessManagementPage({ rows, loading, error, role, originalUserId, onRefresh, onUpdate, onResetPassword, onViewAs, onOpenAudit }: Props) {
  const [selected, setSelected] = useState<AccountRecord>();
  const [dialog, setDialog] = useState<Dialog>();
  const [target, setTarget] = useState<AccountRecord>();
  const [department, setDepartment] = useState('');
  const [selectedRole, setSelectedRole] = useState('VIEWER');
  const [selectedStatus, setSelectedStatus] = useState('ACTIVE');
  const [selectedActive, setSelectedActive] = useState(true);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [mutationError, setMutationError] = useState<string>();
  const triggerRef = useRef<HTMLElement>();
  const dialogTriggerRef = useRef<HTMLElement>();
  const manager = role === 'MANAGER';
  const state = accessManagementState(role, loading, error, rows);
  const departments = useMemo(() => Array.from(new Set(rows.map((row) => row.department || '').filter(Boolean))).sort(), [rows]);

  const openDetails = (account: AccountRecord, trigger?: HTMLElement) => { triggerRef.current = trigger; setSelected(account); };
  const closeDetails = () => { setSelected(undefined); window.setTimeout(() => triggerRef.current?.focus(), 0); };
  const prepare = (account: AccountRecord, next: Exclude<Dialog, 'confirm'>, trigger?: HTMLElement) => { dialogTriggerRef.current = trigger; setTarget(account); setDepartment(account.department || ''); setSelectedRole(account.role || 'VIEWER'); setSelectedStatus(account.accountStatus || 'ACTIVE'); setSelectedActive(Boolean(account.isActive)); setPassword(''); setMutationError(undefined); setDialog(next); };
  const closeDialog = () => { setDialog(undefined); setTarget(undefined); setMutationError(undefined); window.setTimeout(() => dialogTriggerRef.current?.focus(), 0); };
  const run = async (action: () => Promise<unknown>, success: string) => { setBusy(true); setMutationError(undefined); try { await action(); setNotice(success); closeDialog(); closeDetails(); } catch (reason) { setMutationError(reason instanceof Error ? reason.message : 'ไม่สามารถดำเนินการได้'); } finally { setBusy(false); } };
  const saveEdit = () => {
    if (!target) return;
    const roleReduced = target.role === 'ADMIN' && selectedRole !== 'ADMIN';
    const suspending = selectedStatus === 'SUSPENDED' || !selectedActive;
    if (roleReduced || suspending) { setDialog('confirm'); return; }
    run(() => onUpdate(target.id, { role: selectedRole, department: department || null, accountStatus: selectedStatus, isActive: selectedActive }), 'บันทึกการเปลี่ยนแปลงบัญชีแล้ว');
  };
  const confirmEdit = () => { if (target) run(() => onUpdate(target.id, { role: selectedRole, department: department || null, accountStatus: selectedStatus, isActive: selectedActive }), 'บันทึกการเปลี่ยนแปลงบัญชีแล้ว'); };
  const confirmViewAs = async () => {
    if (!target) return;
    setBusy(true);
    setMutationError(undefined);
    const result = await executeConfirmedViewAs(target.id, onViewAs);
    if (result.ok) {
      setNotice('เปิด View As แบบอ่านอย่างเดียวแล้ว');
      closeDialog();
      closeDetails();
    } else {
      setMutationError(result.error);
    }
    setBusy(false);
  };
  const approve = (account: AccountRecord) => prepare(account, 'approve');
  const updateToggle = (account: AccountRecord) => { setTarget(account); setDepartment(account.department || ''); setSelectedRole(account.role || 'VIEWER'); setSelectedStatus(isAccountActive(account) ? 'SUSPENDED' : 'ACTIVE'); setSelectedActive(!isAccountActive(account)); setDialog('confirm'); };
  const permissionDenied = state === 'permission-denied';

  return <section className="access-management-page" aria-label="ผู้ใช้และสิทธิ์"><header className="access-page-header"><div><p className="access-eyebrow">{manager ? 'PENDING ACCOUNT APPROVAL' : 'ACCOUNT AND ACCESS MANAGEMENT'}</p><h1>ผู้ใช้และสิทธิ์</h1><p>{manager ? 'รายการที่รออนุมัติ — อนุมัติได้เฉพาะบัญชี Viewer ที่เปิดใช้งาน' : 'บัญชี บทบาท สถานะ และความปลอดภัยของการเข้าถึง'}</p></div><div className="access-page-actions"><span className="access-result-count">{loading ? 'กำลังโหลดรายการ…' : `${rows.length} บัญชีในขอบเขตที่แสดง`}</span><button type="button" className="btn-neutral" disabled={loading} onClick={onRefresh}>↻ รีเฟรช</button></div></header>{notice && <div className="access-notice" role="status">✓ {notice}<button type="button" onClick={() => setNotice(undefined)} aria-label="ปิดข้อความ">×</button></div>}{permissionDenied ? <div className="access-state access-state--permission"><span aria-hidden="true">⛨</span><h2>คุณไม่มีสิทธิ์จัดการบัญชี</h2><p>บัญชีนี้ไม่ได้รับอนุญาตให้เข้าถึงผู้ใช้และสิทธิ์</p></div> : <>{state !== 'error' && <AccessSummaryCards rows={rows} manager={manager} />}{state === 'error' ? <div className="access-state"><span aria-hidden="true">!</span><h2>ไม่สามารถโหลดข้อมูลบัญชี</h2><p>ระบบไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง</p><button type="button" className="btn-neutral" onClick={onRefresh}>ลองใหม่</button></div> : <AccountTable rows={rows} role={role} originalUserId={originalUserId} loading={loading} onDetails={openDetails} onEdit={(account) => prepare(account, 'edit')} onApprove={approve} onReset={(account) => prepare(account, 'reset')} onViewAs={(account) => prepare(account, 'view-as')} onToggle={updateToggle} />}</>}<AccountDrawer account={selected} role={role} originalUserId={originalUserId} suspendEscape={Boolean(dialog)} onClose={closeDetails} onEdit={(account) => prepare(account, 'edit')} onApprove={approve} onReset={(account) => prepare(account, 'reset')} onViewAs={(account, trigger) => prepare(account, 'view-as', trigger)} onToggle={updateToggle} onOpenAudit={() => { closeDetails(); onOpenAudit(); }} />
    {dialog === 'edit' && target && <Modal title="แก้ไขบัญชีและสิทธิ์" onClose={closeDialog}><div className="account-modal-body"><p>บันทึกเฉพาะข้อมูลที่ backend รองรับและตรวจสอบสิทธิ์อีกครั้งก่อนแก้ไข</p><label>บทบาท<select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value)}>{['ADMIN', 'MANAGER', 'VIEWER'].map((item) => <option key={item} value={item}>{roleLabel[item]}</option>)}</select></label><label>หน่วยงาน<select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">ไม่ระบุหน่วยงาน</option>{departments.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>สถานะบัญชี<select value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value)}>{['ACTIVE', 'PENDING', 'SUSPENDED', 'REJECTED'].map((item) => <option key={item} value={item}>{statusLabel[item]}</option>)}</select></label><label className="access-check"><input type="checkbox" checked={selectedActive} onChange={(event) => setSelectedActive(event.target.checked)} />บัญชีเปิดใช้งาน</label>{mutationError && <p className="access-dialog-error">{mutationError}</p>}</div><footer><button type="button" className="btn-neutral" onClick={closeDialog}>ยกเลิก</button><button type="button" className="btn-primary" disabled={busy} onClick={saveEdit}>{busy ? 'กำลังบันทึก…' : 'บันทึกการเปลี่ยนแปลง'}</button></footer></Modal>}
    {dialog === 'approve' && target && <Modal title="อนุมัติบัญชี" onClose={closeDialog}><div className="account-modal-body"><p>การอนุมัติจะกำหนดบัญชีนี้เป็น <strong>Viewer</strong> และเปิดใช้งานตามกฎของระบบ</p><label>หน่วยงาน<select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">ไม่ระบุหน่วยงาน</option>{departments.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>{mutationError && <p className="access-dialog-error">{mutationError}</p>}</div><footer><button type="button" className="btn-neutral" onClick={closeDialog}>ยกเลิก</button><button type="button" className="btn-success" disabled={busy} onClick={() => run(() => onUpdate(target.id, { role: 'VIEWER', department: department || null, accountStatus: 'ACTIVE', isActive: true }), 'อนุมัติบัญชีเป็น Viewer แล้ว')}>{busy ? 'กำลังอนุมัติ…' : 'อนุมัติบัญชี'}</button></footer></Modal>}
    {dialog === 'reset' && target && <Modal title="รีเซ็ตรหัสผ่าน" onClose={closeDialog}><div className="account-modal-body"><p>รหัสผ่านใหม่จะไม่แสดงหรือบันทึกไว้ในหน้าจอนี้ และ refresh sessions เดิมของบัญชีจะถูกยกเลิก</p><label>รหัสผ่านใหม่<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></label>{mutationError && <p className="access-dialog-error">{mutationError}</p>}</div><footer><button type="button" className="btn-neutral" onClick={closeDialog}>ยกเลิก</button><button type="button" className="btn-warning" disabled={busy || password.length < 8} onClick={() => run(() => onResetPassword(target.id, password), 'รีเซ็ตรหัสผ่านและยกเลิก session เดิมแล้ว')}>{busy ? 'กำลังรีเซ็ต…' : 'ยืนยันการรีเซ็ต'}</button></footer></Modal>}
    {dialog === 'view-as' && target && <Modal title={viewAsConfirmation.title} onClose={closeDialog}><div className="account-modal-body"><p>{viewAsConfirmation.description}</p><p className="view-as-target">บัญชีที่จะเปิดดู: <strong>{target.displayName || 'บัญชีที่เลือก'}</strong></p>{mutationError && <p className="access-dialog-error">{mutationError}</p>}</div><footer><button type="button" className="btn-neutral" onClick={closeDialog}>ยกเลิก</button><button type="button" className="btn-warning" disabled={busy} onClick={confirmViewAs}>{busy ? 'กำลังเปิด…' : viewAsConfirmation.confirmLabel}</button></footer></Modal>}
    {dialog === 'confirm' && target && <Modal title={selectedStatus === 'SUSPENDED' || !selectedActive ? 'ยืนยันการระงับบัญชี' : 'ยืนยันการเปลี่ยนแปลงสิทธิ์'} onClose={closeDialog}><div className="account-modal-body"><p>{selectedStatus === 'SUSPENDED' || !selectedActive ? 'บัญชีจะไม่สามารถใช้งานได้จนกว่าจะเปิดใช้งานใหม่' : 'การลดบทบาทมีผลต่อสิทธิ์การเข้าถึงของบัญชีนี้'}</p>{mutationError && <p className="access-dialog-error">{mutationError}</p>}</div><footer><button type="button" className="btn-neutral" onClick={closeDialog}>ยกเลิก</button><button type="button" className={selectedStatus === 'SUSPENDED' || !selectedActive ? 'btn-danger' : 'btn-primary'} disabled={busy} onClick={confirmEdit}>{busy ? 'กำลังบันทึก…' : 'ยืนยันการเปลี่ยนแปลง'}</button></footer></Modal>}
  </section>;
}
