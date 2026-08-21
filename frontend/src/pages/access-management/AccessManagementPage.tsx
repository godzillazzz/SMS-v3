import { useEffect, useMemo, useRef, useState } from 'react';
import { DataRowActionMenu, type DataRowAction } from '../../components/DataRowActionMenu';
import { acquireDocumentScrollLock } from '../../document-scroll-lock';
import { SmsIcon, type SmsIconName } from '../../components/SmsIcon';
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
type ModalTone = 'default' | 'positive' | 'warning' | 'danger';

const roleLabel: Record<string, string> = { ADMIN: 'ผู้ดูแลระบบ', MANAGER: 'ผู้จัดการ', VIEWER: 'ผู้ใช้งาน' };
const statusLabel: Record<string, string> = { ACTIVE: 'ใช้งานอยู่', PENDING: 'รออนุมัติ', SUSPENDED: 'ระงับใช้งาน', REJECTED: 'ไม่อนุมัติ' };

function formatDate(value?: string) {
  if (!value) return 'ไม่ระบุ';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'ไม่ระบุ' : new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' }).format(date);
}

function AccountStatusBadge({ account }: { account: AccountRecord }) {
  const tone = accountStatusTone(account);
  return <span className={`account-status account-status--${tone}`}><span className="account-status-dot" aria-hidden="true" />{accountStatusLabel(account)}</span>;
}

function ResetBadge({ required }: { required?: boolean }) {
  return <span className={`reset-badge ${required ? 'reset-badge--required' : ''}`}>{required ? 'ต้องรีเซ็ตรหัสผ่าน' : 'ปกติ'}</span>;
}

function AccessSummaryCards({ rows, manager }: { rows: AccountRecord[]; manager: boolean }) {
  const summary = accessSummary(rows);
  const cards: Array<{ label: string; value: number; note: string; icon: SmsIconName; tone: string }> = manager
    ? [{ label: 'รายการที่รออนุมัติ', value: summary.pending, note: 'เฉพาะบัญชีที่แสดงในพื้นที่ทำงานนี้', icon: 'approval', tone: 'indigo' }]
    : [
      { label: 'บัญชีทั้งหมด', value: summary.total, note: 'จากรายการที่ระบบส่งกลับ', icon: 'users', tone: 'indigo' },
      { label: 'ใช้งานอยู่', value: summary.active, note: 'บัญชีที่ Active', icon: 'check', tone: 'green' },
      { label: 'รออนุมัติ', value: summary.pending, note: 'ต้องกำหนดสิทธิ์ก่อนใช้งาน', icon: 'clock', tone: 'amber' },
      { label: 'ระงับใช้งาน', value: summary.suspended, note: 'ไม่สามารถเข้าสู่ระบบได้', icon: 'pause', tone: 'red' },
      { label: 'ต้องรีเซ็ตรหัสผ่าน', value: summary.resetRequired, note: 'ตรวจสอบก่อนเปิดใช้งาน', icon: 'key', tone: 'purple' }
    ];
  return <div className={`access-summary-grid ${manager ? 'access-summary-grid--manager' : ''}`}>{cards.map((card) => <article className={`access-summary-card access-summary-card--${card.tone}`} key={card.label}><span className="access-summary-icon" aria-hidden="true"><SmsIcon name={card.icon} size={19} /></span><div><p>{card.label}</p><strong>{card.value}</strong><small>{card.note}</small></div></article>)}</div>;
}

function AccountTable({ rows, role, originalUserId, loading, onDetails, onEdit, onApprove }: {
  rows: AccountRecord[]; role: AccessRole; originalUserId?: string; loading: boolean;
  onDetails(account: AccountRecord, trigger?: HTMLElement): void; onEdit(account: AccountRecord, trigger?: HTMLElement): void; onApprove(account: AccountRecord, trigger?: HTMLElement): void;
}) {
  if (loading) return <div className="access-table-card data-surface-card" aria-busy="true"><div className="access-table-skeleton">{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</div></div>;
  if (!rows.length) return <div className="access-state data-state data-state--empty"><span aria-hidden="true"><SmsIcon name="users" size={24} /></span><h2>ยังไม่มีบัญชีที่แสดงได้</h2><p>เมื่อมีบัญชีอยู่ในขอบเขตสิทธิ์ของคุณ ระบบจะแสดงรายการที่นี่</p></div>;
  return <div className="access-table-card data-surface-card"><div className="access-table-scroll data-table-scroll"><table className="access-table data-surface-table"><thead><tr><th scope="col">ชื่อที่แสดง</th><th scope="col">บทบาท</th><th scope="col">หน่วยงาน</th><th scope="col">สถานะบัญชี</th><th scope="col">สถานะใช้งาน</th><th scope="col">ความปลอดภัย</th><th scope="col">อัปเดตล่าสุด</th><th scope="col"><span className="sr-only">จัดการบัญชี</span></th></tr></thead><tbody>{rows.map((account) => {
    const actions = visibleAccountActions(role, account, originalUserId);
    return <tr key={account.id} data-account-id={account.id} tabIndex={0} onClick={(event) => onDetails(account, event.currentTarget)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onDetails(account, event.currentTarget); } }}>
      <td><strong>{account.displayName || 'ไม่ระบุชื่อ'}</strong><small>บัญชีผู้ใช้งาน</small></td>
      <td><span className="role-badge">{roleLabel[account.role || ''] || account.role || 'ไม่ระบุ'}</span></td>
      <td>{account.department || 'ไม่ระบุหน่วยงาน'}</td>
      <td><span className={`access-account-state access-account-state--${String(account.accountStatus || '').toLowerCase()}`}>{statusLabel[String(account.accountStatus || '')] || 'ไม่ระบุ'}</span></td>
      <td><AccountStatusBadge account={account} /></td>
      <td><ResetBadge required={account.passwordResetRequired} /></td>
      <td>{formatDate(account.updatedAt || account.createdAt)}</td>
      <td onClick={(event) => event.stopPropagation()}><div className="account-row-actions data-row-actions"><button type="button" className="btn-neutral data-row-primary-action" onClick={(event) => onDetails(account, event.currentTarget)}>รายละเอียด</button>{actions.includes('approve') && <button type="button" className="btn-success" onClick={(event) => onApprove(account, event.currentTarget)}>อนุมัติ</button>}{actions.includes('edit') && <button type="button" className="btn-info-outline data-row-primary-action" onClick={(event) => onEdit(account, event.currentTarget)}><SmsIcon name="edit" size={16} />แก้ไข</button>}</div></td>
    </tr>;
  })}</tbody></table></div><div className="access-mobile-cards">{rows.map((account) => <article className="account-mobile-card data-mobile-card" key={account.id}><div><span className="account-mobile-label">บัญชีผู้ใช้งาน</span><h2>{account.displayName || 'ไม่ระบุชื่อ'}</h2><p>{roleLabel[account.role || ''] || account.role || 'ไม่ระบุ'} · {account.department || 'ไม่ระบุหน่วยงาน'}</p></div><div className="account-mobile-status"><AccountStatusBadge account={account} /><ResetBadge required={account.passwordResetRequired} /></div><footer><small>อัปเดต {formatDate(account.updatedAt || account.createdAt)}</small><button type="button" className="btn-neutral" onClick={(event) => onDetails(account, event.currentTarget)}>เปิดรายละเอียด</button></footer></article>)}</div></div>;
}

function AccountDrawer({ account, role, originalUserId, suspendEscape = false, onClose, onEdit, onApprove, onReset, onViewAs, onToggle, onOpenAudit }: {
  account?: AccountRecord; role: AccessRole; originalUserId?: string; suspendEscape?: boolean; onClose(): void;
  onEdit(account: AccountRecord, trigger?: HTMLElement): void; onApprove(account: AccountRecord, trigger?: HTMLElement): void; onReset(account: AccountRecord, trigger?: HTMLElement): void; onViewAs(account: AccountRecord, trigger?: HTMLElement): void; onToggle(account: AccountRecord, trigger?: HTMLElement): void; onOpenAudit(): void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!account) return;
    const releaseScrollLock = acquireDocumentScrollLock();
    const timer = window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('disabled'));
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    if (!suspendEscape) window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      releaseScrollLock();
    };
  }, [account, onClose, suspendEscape]);
  if (!account) return null;
  const actions = visibleAccountActions(role, account, originalUserId);
  const moreActions: DataRowAction[] = [];
  if (actions.includes('approve') && actions.includes('edit')) moreActions.push({ label: 'แก้ไขบัญชี', onSelect: () => onEdit(account) });
  if (actions.includes('reset-password')) moreActions.push({ label: 'รีเซ็ตรหัสผ่าน', onSelect: () => onReset(account) });
  if (actions.includes('view-as')) moreActions.push({ label: 'ดูในมุมมองผู้ใช้ (View As)', onSelect: () => onViewAs(account) });
  if (actions.includes('activate') && actions.includes('edit')) moreActions.push({ label: 'เปิดใช้งานบัญชี', onSelect: () => onToggle(account) });
  const primary = actions.includes('approve') ? 'approve' : actions.includes('edit') ? 'edit' : actions.includes('activate') ? 'activate' : undefined;

  return <div className="account-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !suspendEscape) onClose(); }}><aside ref={drawerRef} className="account-drawer operational-drawer" role="dialog" aria-modal="true" aria-labelledby="account-drawer-title"><header><div className="account-drawer-identity"><span className="account-drawer-avatar" aria-hidden="true"><SmsIcon name="users" size={21} /></span><div><p>ACCOUNT RECORD</p><h2 id="account-drawer-title">{account.displayName || 'บัญชีผู้ใช้งาน'}</h2><div className="account-drawer-context"><span className="role-badge">{roleLabel[account.role || ''] || account.role || 'ไม่ระบุบทบาท'}</span><span className={`access-account-state access-account-state--${String(account.accountStatus || '').toLowerCase()}`}>{statusLabel[String(account.accountStatus || '')] || 'ไม่ระบุสถานะ'}</span></div></div></div><button ref={closeRef} className="drawer-close overlay-close" type="button" onClick={onClose} aria-label="ปิดรายละเอียดบัญชี"><SmsIcon name="close" size={20} /></button></header><div className="account-drawer-body">
    <section><div className="account-section-heading"><span aria-hidden="true"><SmsIcon name="users" size={18} /></span><div><h3>บัญชี</h3><p>ข้อมูลบทบาทและขอบเขตที่ระบบส่งกลับ</p></div></div><dl><div><dt>บทบาท</dt><dd>{roleLabel[account.role || ''] || account.role || 'ไม่ระบุ'}</dd></div><div><dt>หน่วยงาน</dt><dd>{account.department || 'ไม่ระบุหน่วยงาน'}</dd></div><div><dt>อัปเดตล่าสุด</dt><dd>{formatDate(account.updatedAt || account.createdAt)}</dd></div></dl></section>
    <section><div className="account-section-heading"><span aria-hidden="true"><SmsIcon name="shield" size={18} /></span><div><h3>การเข้าถึง</h3><p>สถานะบัญชีและสถานะการใช้งานเป็นคนละข้อมูล</p></div></div><div className="drawer-status-grid"><div><span>สถานะบัญชี</span><b>{statusLabel[String(account.accountStatus || '')] || 'ไม่ระบุ'}</b></div><div><span>สถานะใช้งาน</span><AccountStatusBadge account={account} /></div></div></section>
    <section><div className="account-section-heading"><span aria-hidden="true"><SmsIcon name="key" size={18} /></span><div><h3>ความปลอดภัย</h3><p>แสดงเฉพาะสถานะที่จำเป็นต่อการจัดการบัญชี</p></div></div><div className="drawer-security-state"><ResetBadge required={account.passwordResetRequired} /><p>{account.passwordResetRequired ? 'บัญชีนี้ต้องตั้งรหัสผ่านใหม่ก่อนใช้งานตามขั้นตอนที่ระบบรองรับ' : 'ไม่มีข้อกำหนดเปลี่ยนรหัสผ่านที่ระบบส่งกลับในขณะนี้'}</p></div></section>
    <section><div className="account-section-heading"><span aria-hidden="true"><SmsIcon name="audit" size={18} /></span><div><h3>Audit &amp; Compliance</h3><p>เปิดบันทึกเหตุการณ์ตามสิทธิ์โดยไม่ขยายข้อมูลอ่อนไหวในหน้าจอนี้</p></div></div><button className="btn-info account-audit-action" type="button" onClick={onOpenAudit}>ดู Audit &amp; Compliance</button></section>
  </div><footer className="account-drawer-actions">
    <div className="account-drawer-primary-actions">{primary === 'approve' && <button type="button" className="btn-success" onClick={(event) => onApprove(account, event.currentTarget)}><SmsIcon name="check" size={17} />อนุมัติบัญชี</button>}{primary === 'edit' && <button type="button" className="btn-primary" onClick={(event) => onEdit(account, event.currentTarget)}><SmsIcon name="edit" size={17} />แก้ไขบัญชี</button>}{primary === 'activate' && <button type="button" className="btn-success" onClick={(event) => onToggle(account, event.currentTarget)}><SmsIcon name="check" size={17} />เปิดใช้งานบัญชี</button>}{moreActions.length > 0 && <DataRowActionMenu label={`การทำงานเพิ่มเติมสำหรับบัญชี ${account.displayName || ''}`} actions={moreActions} />}</div>
    {actions.includes('suspend') && <div className="account-danger-zone"><div><strong>การเข้าถึงบัญชี</strong><span>การระงับจะทำให้บัญชีไม่สามารถใช้งานได้ตามกฎปัจจุบัน</span></div><button type="button" className="btn-danger" onClick={(event) => onToggle(account, event.currentTarget)}><SmsIcon name="pause" size={17} />ระงับใช้งาน</button></div>}
  </footer></aside></div>;
}

function Modal({ title, eyebrow, tone = 'default', children, onClose }: { title: string; eyebrow: string; tone?: ModalTone; children: React.ReactNode; onClose(): void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const releaseScrollLock = acquireDocumentScrollLock();
    const timer = window.setTimeout(() => {
      const firstField = modalRef.current?.querySelector<HTMLElement>('input:not([type="checkbox"]), select, textarea');
      (firstField || closeRef.current)?.focus({ preventScroll: true });
    }, 0);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      releaseScrollLock();
    };
  }, [onClose]);
  return <div className="account-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={modalRef} className={`account-modal account-modal--${tone}`} role="dialog" aria-modal="true" aria-labelledby="account-modal-title"><header><div><p>{eyebrow}</p><h2 id="account-modal-title">{title}</h2></div><button ref={closeRef} type="button" className="drawer-close overlay-close" onClick={onClose} aria-label="ปิดหน้าต่าง"><SmsIcon name="close" size={20} /></button></header>{children}</section></div>;
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
  const [showPassword, setShowPassword] = useState(false);
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
  const prepare = (account: AccountRecord, next: Exclude<Dialog, 'confirm'>, trigger?: HTMLElement) => {
    const fallback = document.querySelector<HTMLElement>(`[data-account-id="${account.id}"]`) || (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
    dialogTriggerRef.current = trigger || fallback;
    setTarget(account); setDepartment(account.department || ''); setSelectedRole(account.role || 'VIEWER'); setSelectedStatus(account.accountStatus || 'ACTIVE'); setSelectedActive(Boolean(account.isActive)); setPassword(''); setShowPassword(false); setMutationError(undefined); setDialog(next);
  };
  const closeDialog = () => { setDialog(undefined); setTarget(undefined); setMutationError(undefined); setShowPassword(false); window.setTimeout(() => dialogTriggerRef.current?.focus(), 0); };
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
    setBusy(true); setMutationError(undefined);
    const result = await executeConfirmedViewAs(target.id, onViewAs);
    if (result.ok) { setNotice('เปิด View As แบบอ่านอย่างเดียวแล้ว'); closeDialog(); closeDetails(); }
    else setMutationError(result.error);
    setBusy(false);
  };
  const approve = (account: AccountRecord, trigger?: HTMLElement) => prepare(account, 'approve', trigger);
  const updateToggle = (account: AccountRecord, trigger?: HTMLElement) => {
    dialogTriggerRef.current = trigger || document.querySelector<HTMLElement>(`[data-account-id="${account.id}"]`) || undefined;
    setTarget(account); setDepartment(account.department || ''); setSelectedRole(account.role || 'VIEWER'); setSelectedStatus(isAccountActive(account) ? 'SUSPENDED' : 'ACTIVE'); setSelectedActive(!isAccountActive(account)); setMutationError(undefined); setDialog('confirm');
  };
  const permissionDenied = state === 'permission-denied';
  const isSuspending = Boolean(target && (selectedStatus === 'SUSPENDED' || !selectedActive));
  const isActivating = Boolean(target && !isAccountActive(target) && selectedStatus === 'ACTIVE' && selectedActive);

  return <section className="access-management-page data-surface-page" aria-label="ผู้ใช้และสิทธิ์"><header className="access-page-header"><div><h1>ผู้ใช้และสิทธิ์</h1><p>{manager ? 'ตรวจสอบบัญชีที่อยู่ในขอบเขตการอนุมัติของผู้จัดการ' : 'จัดการบัญชี บทบาท และสถานะการเข้าถึงตามสิทธิ์ที่ได้รับ'}</p></div><div className="access-page-actions"><span className="access-result-count data-result-count">{loading ? 'กำลังโหลดรายการ…' : `${rows.length} บัญชีในขอบเขตที่แสดง`}</span><button type="button" className="btn-neutral access-refresh-action" disabled={loading} onClick={onRefresh}><SmsIcon name="refresh" size={17} />รีเฟรช</button></div></header>{notice && <div className="access-notice" role="status"><span><SmsIcon name="check" size={17} />{notice}</span><button type="button" onClick={() => setNotice(undefined)} aria-label="ปิดข้อความ"><SmsIcon name="close" size={17} /></button></div>}{permissionDenied ? <div className="access-state access-state--permission data-state data-state--permission"><span aria-hidden="true"><SmsIcon name="shield" size={24} /></span><h2>คุณไม่มีสิทธิ์จัดการบัญชี</h2><p>บัญชีนี้ไม่ได้รับอนุญาตให้เข้าถึงผู้ใช้และสิทธิ์</p></div> : <>{state !== 'error' && <AccessSummaryCards rows={rows} manager={manager} />}{state === 'error' ? <div className="access-state data-state data-state--error"><span aria-hidden="true"><SmsIcon name="shield" size={24} /></span><h2>ไม่สามารถโหลดข้อมูลบัญชี</h2><p>ระบบไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง</p><button type="button" className="btn-neutral" onClick={onRefresh}>ลองใหม่</button></div> : <AccountTable rows={rows} role={role} originalUserId={originalUserId} loading={loading} onDetails={openDetails} onEdit={(account, trigger) => prepare(account, 'edit', trigger)} onApprove={approve} />}</>}<AccountDrawer account={selected} role={role} originalUserId={originalUserId} suspendEscape={Boolean(dialog)} onClose={closeDetails} onEdit={(account, trigger) => prepare(account, 'edit', trigger)} onApprove={approve} onReset={(account, trigger) => prepare(account, 'reset', trigger)} onViewAs={(account, trigger) => prepare(account, 'view-as', trigger)} onToggle={updateToggle} onOpenAudit={() => { closeDetails(); onOpenAudit(); }} />
    {dialog === 'edit' && target && <Modal eyebrow="ACCOUNT SETTINGS" title="แก้ไขบัญชีและสิทธิ์" onClose={closeDialog}><div className="account-modal-body"><div className="account-modal-context"><span>บัญชี</span><strong>{target.displayName || 'บัญชีที่เลือก'}</strong></div><p>แก้ไขเฉพาะบทบาท หน่วยงาน และสถานะที่ระบบรองรับ การเปลี่ยนสิทธิ์อาจมีผลต่อการเข้าถึง</p><div className="account-form-grid"><label>บทบาท<select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value)}>{['ADMIN', 'MANAGER', 'VIEWER'].map((item) => <option key={item} value={item}>{roleLabel[item]}</option>)}</select></label><label>หน่วยงาน<select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">ไม่ระบุหน่วยงาน</option>{departments.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>สถานะบัญชี<select value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value)}>{['ACTIVE', 'PENDING', 'SUSPENDED', 'REJECTED'].map((item) => <option key={item} value={item}>{statusLabel[item]}</option>)}</select></label><label className="access-check"><input type="checkbox" checked={selectedActive} onChange={(event) => setSelectedActive(event.target.checked)} />บัญชีเปิดใช้งาน</label></div>{mutationError && <p className="access-dialog-error" role="alert">{mutationError}</p>}</div><footer><button type="button" className="btn-neutral" onClick={closeDialog}>ยกเลิก</button><button type="button" className="btn-primary" disabled={busy} onClick={saveEdit}>{busy ? 'กำลังบันทึก…' : 'บันทึกการเปลี่ยนแปลง'}</button></footer></Modal>}
    {dialog === 'approve' && target && <Modal eyebrow="ACCOUNT APPROVAL" title="อนุมัติบัญชี" tone="positive" onClose={closeDialog}><div className="account-modal-body"><div className="account-modal-context"><span>บัญชี</span><strong>{target.displayName || 'บัญชีที่เลือก'}</strong></div><p>การอนุมัตินี้ใช้ behavior เดิมของ Access Management: กำหนดบัญชีเป็น <strong>Viewer</strong> และเปิดใช้งานตามกฎปัจจุบัน</p><label>หน่วยงาน<select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">ไม่ระบุหน่วยงาน</option>{departments.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>{mutationError && <p className="access-dialog-error" role="alert">{mutationError}</p>}</div><footer><button type="button" className="btn-neutral" onClick={closeDialog}>ยกเลิก</button><button type="button" className="btn-success" disabled={busy} onClick={() => run(() => onUpdate(target.id, { role: 'VIEWER', department: department || null, accountStatus: 'ACTIVE', isActive: true }), 'อนุมัติบัญชีเป็น Viewer แล้ว')}>{busy ? 'กำลังอนุมัติ…' : 'อนุมัติบัญชี'}</button></footer></Modal>}
    {dialog === 'reset' && target && <Modal eyebrow="ACCOUNT SECURITY" title="รีเซ็ตรหัสผ่าน" tone="warning" onClose={closeDialog}><div className="account-modal-body"><div className="account-modal-context"><span>บัญชี</span><strong>{target.displayName || 'บัญชีที่เลือก'}</strong></div><p>ตั้งรหัสผ่านใหม่ตาม policy เดิมของระบบ รหัสผ่านเดิมจะไม่ถูกแสดง และ session เดิมจะถูกจัดการตาม backend behavior ปัจจุบัน</p><label>รหัสผ่านใหม่<div className="access-password-field"><input type={showPassword ? 'text' : 'password'} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /><button type="button" aria-label={showPassword ? 'ซ่อนรหัสผ่านใหม่' : 'แสดงรหัสผ่านใหม่'} onMouseDown={(event) => event.preventDefault()} onClick={() => setShowPassword((value) => !value)}><SmsIcon name={showPassword ? 'eyeOff' : 'eye'} size={18} /></button></div></label>{mutationError && <p className="access-dialog-error" role="alert">{mutationError}</p>}</div><footer><button type="button" className="btn-neutral" onClick={closeDialog}>ยกเลิก</button><button type="button" className="btn-warning" disabled={busy || password.length < 8} onClick={() => run(() => onResetPassword(target.id, password), 'รีเซ็ตรหัสผ่านและยกเลิก session เดิมแล้ว')}>{busy ? 'กำลังรีเซ็ต…' : 'ยืนยันการรีเซ็ต'}</button></footer></Modal>}
    {dialog === 'view-as' && target && <Modal eyebrow="SECURITY-SENSITIVE OPERATION" title={viewAsConfirmation.title} tone="warning" onClose={closeDialog}><div className="account-modal-body"><div className="account-security-callout"><span aria-hidden="true"><SmsIcon name="eye" size={20} /></span><div><strong>ดูระบบในมุมมองของผู้ใช้นี้?</strong><p>{viewAsConfirmation.description}</p></div></div><p className="view-as-target">บัญชีที่จะเปิดดู: <strong>{target.displayName || 'บัญชีที่เลือก'}</strong></p>{mutationError && <p className="access-dialog-error" role="alert">{mutationError}</p>}</div><footer><button type="button" className="btn-neutral" onClick={closeDialog}>ยกเลิก</button><button type="button" className="btn-warning" disabled={busy} onClick={confirmViewAs}>{busy ? 'กำลังเปิด…' : viewAsConfirmation.confirmLabel}</button></footer></Modal>}
    {dialog === 'confirm' && target && <Modal eyebrow={isSuspending ? 'ACCOUNT ACCESS' : isActivating ? 'ACCOUNT ACCESS' : 'ACCESS CHANGE'} title={isSuspending ? 'ยืนยันการระงับบัญชี' : isActivating ? 'ยืนยันการเปิดใช้งานบัญชี' : 'ยืนยันการเปลี่ยนแปลงสิทธิ์'} tone={isSuspending ? 'danger' : isActivating ? 'positive' : 'warning'} onClose={closeDialog}><div className="account-modal-body"><div className="account-modal-context"><span>บัญชี</span><strong>{target.displayName || 'บัญชีที่เลือก'}</strong></div><div className={`account-confirmation-copy ${isSuspending ? 'is-danger' : isActivating ? 'is-positive' : ''}`}><span aria-hidden="true"><SmsIcon name={isSuspending ? 'pause' : isActivating ? 'check' : 'shield'} size={20} /></span><p>{isSuspending ? 'บัญชีจะไม่สามารถใช้งานได้จนกว่าจะเปิดใช้งานใหม่ตาม behavior ปัจจุบัน' : isActivating ? 'บัญชีจะถูกเปิดใช้งานด้วยสถานะและบทบาทปัจจุบันที่เลือกไว้' : 'การลดบทบาทมีผลต่อสิทธิ์การเข้าถึงของบัญชีนี้'}</p></div>{mutationError && <p className="access-dialog-error" role="alert">{mutationError}</p>}</div><footer><button type="button" className="btn-neutral" onClick={closeDialog}>ยกเลิก</button><button type="button" className={isSuspending ? 'btn-danger' : isActivating ? 'btn-success' : 'btn-primary'} disabled={busy} onClick={confirmEdit}>{busy ? 'กำลังบันทึก…' : isSuspending ? 'ยืนยันการระงับ' : isActivating ? 'ยืนยันการเปิดใช้งาน' : 'ยืนยันการเปลี่ยนแปลง'}</button></footer></Modal>}
  </section>;
}
