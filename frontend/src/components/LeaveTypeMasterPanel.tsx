import { useEffect, useState, type ReactNode } from 'react';
import { formatRequestErrorMessage } from '../request-error';
import type { LeaveTypeMaster } from '../leave-type-client';
import { showToast } from '../toast';
import { DataTableSkeletonCards, DataTableSkeletonRows, DataTableState, ResponsiveDataTable } from './ResponsiveDataTable';
import { SmsIcon } from './SmsIcon';
import { useAccessibleOverlay } from './useAccessibleOverlay';
import '../styles/leave-type-master.css';
import { EditIconButton } from './EditIconButton';

type CreateInput = {
  code: string;
  name: string;
  quotaBucket: LeaveTypeMaster['quotaBucket'];
  isActive: boolean;
  sortOrder: number;
};

type UpdateInput = Partial<Pick<LeaveTypeMaster, 'name' | 'quotaBucket' | 'isActive' | 'sortOrder'>>;

const bucketLabels: Record<LeaveTypeMaster['quotaBucket'], string> = {
  SICK: 'โควตาลาป่วย',
  PERSONAL: 'โควตาลากิจ',
  VACATION: 'โควตาลาพักร้อน',
  NONE: 'ไม่หักโควตารายปี'
};

const emptyCreate: CreateInput = { code: '', name: '', quotaBucket: 'NONE', isActive: true, sortOrder: 100 };

const displayName = (row: LeaveTypeMaster) => row.code === 'SICK' ? 'ลาป่วย' : row.code === 'PERSONAL' ? 'ลากิจ' : row.code === 'VACATION' ? 'ลาพักร้อน' : row.name;

function LeaveTypeChip({ row }: { row: LeaveTypeMaster }) {
  return <span className={`leave-type-chip leave-type-chip--${row.quotaBucket.toLowerCase()}`}>{displayName(row)}</span>;
}

function StatusPill({ active }: { active: boolean }) {
  return <span className={`leave-type-status ${active ? 'is-active' : 'is-inactive'}`}>{active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span>;
}

function LeaveTypeCard({ row, editing, editForm, busy, onBeginEdit, onChange, onSave, onCancel }: {
  row: LeaveTypeMaster;
  editing: boolean;
  editForm: UpdateInput;
  busy: boolean;
  onBeginEdit(): void;
  onChange(change: UpdateInput): void;
  onSave(): void;
  onCancel(): void;
}) {
  const active = Boolean(editForm.isActive ?? row.isActive);
  return <article className="data-mobile-card leave-type-mobile-card">
    <header><div><LeaveTypeChip row={row} /><code>{row.code}</code></div><StatusPill active={editing ? active : row.isActive} /></header>
    <dl>
      <div><dt>ชื่อ</dt><dd>{editing ? <input aria-label={`ชื่อ ${row.code}`} value={String(editForm.name ?? row.name)} maxLength={150} onChange={(event) => onChange({ name: event.target.value })} /> : row.name}</dd></div>
      <div><dt>กลุ่มโควตา</dt><dd>{editing ? <select aria-label={`กลุ่มโควตา ${row.code}`} disabled={row.isSystem} value={String(editForm.quotaBucket ?? row.quotaBucket)} onChange={(event) => onChange({ quotaBucket: event.target.value as LeaveTypeMaster['quotaBucket'] })}>{Object.entries(bucketLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : bucketLabels[row.quotaBucket]}</dd></div>
      <div><dt>ลำดับ</dt><dd>{editing ? <input aria-label={`ลำดับ ${row.code}`} type="number" min={0} max={9999} value={Number(editForm.sortOrder ?? row.sortOrder)} onChange={(event) => onChange({ sortOrder: Number(event.target.value) })} /> : row.sortOrder}</dd></div>
      <div><dt>ชนิด</dt><dd>{row.isSystem ? 'ประเภทหลักของระบบ' : 'กำหนดเอง'}</dd></div>
    </dl>
    {editing && <label className="leave-type-mobile-status"><span>สถานะ</span><select aria-label={`สถานะ ${row.code}`} value={String(active)} onChange={(event) => onChange({ isActive: event.target.value === 'true' })}><option value="true">เปิดใช้งาน</option><option value="false">ปิดใช้งาน</option></select></label>}
    <footer>{editing ? <><button type="button" className="btn-primary compact" disabled={busy} onClick={onSave}>บันทึก</button><button type="button" className="btn-neutral small-action" disabled={busy} onClick={onCancel}>ยกเลิก</button></> : <button type="button" className="btn-neutral small-action" disabled={busy} onClick={onBeginEdit}>แก้ไข</button>}</footer>
  </article>;
}

function LeaveTypeDialog({ title, busy, error, onClose, onSubmit, children }: { title: string; busy: boolean; error?: string; onClose(): void; onSubmit(): void; children: ReactNode }) {
  const ref = useAccessibleOverlay<HTMLDivElement>(true, onClose, { closeDisabled: busy, initialFocusSelector: 'input:not([disabled]), select:not([disabled])' });
  return <div className="leave-type-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div ref={ref} className="leave-type-dialog" role="dialog" aria-modal="true" aria-labelledby="leave-type-dialog-title">
      <header><h3 id="leave-type-dialog-title">{title}</h3><button type="button" className="leave-type-icon-button" aria-label="ปิด" disabled={busy} onClick={onClose}><SmsIcon name="close" size={16} /></button></header>
      <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <div className="leave-type-dialog__fields">{children}</div>
        {error && <div className="settings-notice error" role="alert">{error}</div>}
        <footer><button type="button" className="btn-neutral small-action" disabled={busy} onClick={onClose}>ยกเลิก</button><button type="submit" className="btn-primary compact" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button></footer>
      </form>
    </div>
  </div>;
}

export function LeaveTypeMasterPanel({
  items,
  loading,
  onCreate,
  onUpdate,
  onRefresh
}: {
  items: LeaveTypeMaster[];
  loading: boolean;
  onCreate(input: CreateInput): Promise<void>;
  onUpdate(id: string, input: UpdateInput): Promise<void>;
  onRefresh(): void;
}) {
  const [createForm, setCreateForm] = useState<CreateInput>(emptyCreate);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [editDialog, setEditDialog] = useState(false);
  const [editForm, setEditForm] = useState<UpdateInput>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!editingId) return;
    const row = items.find((item) => item.id === editingId);
    if (!row) {
      setEditingId(undefined);
      setEditForm({});
    }
  }, [editingId, items]);

  const beginEdit = (row: LeaveTypeMaster, inDialog = false) => {
    setEditingId(row.id);
    setEditDialog(inDialog);
    setEditForm({
      name: row.name,
      quotaBucket: row.quotaBucket,
      isActive: row.isActive,
      sortOrder: row.sortOrder
    });
    setError(undefined);
  };
  const closeEdit = () => { setEditingId(undefined); setEditDialog(false); setEditForm({}); setError(undefined); };

  const submitCreate = async () => {
    if (!createForm.code.trim() || !createForm.name.trim()) { setError('กรุณาระบุรหัสและชื่อประเภทการลา'); return; }
    setBusy(true);
    setError(undefined);
    try {
      await onCreate({
        ...createForm,
        code: createForm.code.trim().toUpperCase(),
        name: createForm.name.trim()
      });
      setCreateForm(emptyCreate);
      setCreateOpen(false);
      showToast('เพิ่มประเภทการลาเรียบร้อยแล้ว');
    } catch (reason) {
      setError(formatRequestErrorMessage(reason, 'เพิ่ม Leave Type ไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async () => {
    if (!editingId) return;
    setBusy(true);
    setError(undefined);
    try {
      await onUpdate(editingId, editForm);
      showToast('บันทึกประเภทการลาเรียบร้อยแล้ว');
      closeEdit();
    } catch (reason) {
      setError(formatRequestErrorMessage(reason, 'บันทึก Leave Type ไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (row: LeaveTypeMaster) => {
    setBusy(true);
    setError(undefined);
    try {
      await onUpdate(row.id, { isActive: !row.isActive });
      showToast(row.isActive ? `ปิดใช้งาน ${displayName(row)} แล้ว` : `เปิดใช้งาน ${displayName(row)} แล้ว`);
    } catch (reason) {
      setError(formatRequestErrorMessage(reason, 'เปลี่ยนสถานะ Leave Type ไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  };

  const editingRow = editDialog ? items.find((item) => item.id === editingId) : undefined;

  const desktop = <div className="data-table-scroll"><table className="data-surface-table leave-type-data-table" aria-label="ประเภทการลา"><thead><tr><th scope="col">ชื่อประเภท</th><th scope="col">รหัส</th><th scope="col">กลุ่มโควตา</th><th scope="col">ลำดับ</th><th scope="col">ชนิด</th><th scope="col">สถานะ</th><th scope="col"><span className="sr-only">จัดการ</span></th></tr></thead><tbody>
    {loading ? <DataTableSkeletonRows columnCount={7} rowCount={4} /> : items.length ? items.map((row) => <tr key={row.id}>
      <td><div className="leave-type-name-cell"><LeaveTypeChip row={row} /><small>{row.name}</small></div></td>
      <td className="leave-type-code">{row.code}</td>
      <td><span className={`leave-type-bucket leave-type-bucket--${row.quotaBucket === 'NONE' ? 'none' : 'quota'}`}>{bucketLabels[row.quotaBucket]}</span></td>
      <td className="tabular">{row.sortOrder}</td>
      <td className="leave-type-kind" title={row.isSystem ? 'ประเภทหลัก · ป้องกันรหัส/โควตา' : 'ผู้ดูแลระบบ · รหัสคงที่'}>{row.isSystem ? 'ประเภทหลัก' : 'กำหนดเอง'}</td>
      <td><StatusPill active={row.isActive} /></td>
      <td><div className="leave-type-row-actions">
        <EditIconButton label={`แก้ไข ${displayName(row)}`} disabled={busy} onClick={() => beginEdit(row, true)} />
        <button type="button" className={`leave-type-icon-button ${row.isActive ? 'is-danger' : 'is-success'}`} disabled={busy} aria-label={`${row.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} ${displayName(row)}`} title={row.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} onClick={() => void toggleActive(row)}><SmsIcon name={row.isActive ? 'pause' : 'check'} size={16} /></button>
      </div></td>
    </tr>) : <tr><td colSpan={7} className="data-table-empty-cell"><DataTableState variant="empty" title="ยังไม่มีประเภทการลา" description="กด “เพิ่มประเภทการลา” เพื่อสร้างรายการแรก" announce={false} /></td></tr>}
  </tbody></table>{!loading && items.length > 0 && <p className="leave-type-count">{items.length} รายการ</p>}</div>;
  const mobile = loading
    ? <div className="leave-type-mobile-cards"><DataTableSkeletonCards count={3} cardClassName="data-mobile-card leave-type-mobile-skeleton" /></div>
    : items.length
      ? <div className="leave-type-mobile-cards">{items.map((row) => <LeaveTypeCard key={row.id} row={row} editing={!editDialog && editingId === row.id} editForm={editForm} busy={busy} onBeginEdit={() => beginEdit(row)} onChange={(change) => setEditForm((current) => ({ ...current, ...change }))} onSave={() => void submitEdit()} onCancel={() => { setEditingId(undefined); setEditForm({}); }} />)}</div>
      : <DataTableState variant="empty" title="ยังไม่มีประเภทการลา" description="กด “เพิ่มประเภทการลา” เพื่อสร้างรายการแรก" />;

  return <section className="line-settings-card leave-type-master-card">
    <header className="leave-type-master-head">
      <div>
        <h2>ประเภทการลา</h2>
        <p>จัดการหมวดหมู่การลา กลุ่มโควตารายปี และสถานะใช้งาน</p>
      </div>
      <div className="leave-type-master-head__actions">
        <button type="button" className="btn-neutral small-action" disabled={busy} onClick={onRefresh} aria-label="รีเฟรช"><SmsIcon name="refresh" size={16} /></button>
        <button type="button" className="btn-primary compact" disabled={busy} onClick={() => { setCreateForm(emptyCreate); setError(undefined); setCreateOpen(true); }}><SmsIcon name="plus" size={16} /> เพิ่มประเภทการลา</button>
      </div>
    </header>

    {error && !createOpen && !editDialog && <div className="settings-notice error" role="alert">{error}</div>}

    <ResponsiveDataTable ariaLabel="ประเภทการลา" loading={loading} loadingLabel="กำลังอ่าน Leave Type Master…" hasRows={items.length > 0} className="leave-type-responsive-table" desktop={desktop} mobile={mobile} />

    <p className="leave-type-policy-note">ไม่มีคำสั่ง Delete สำหรับ Leave Type Master การปิดใช้งานจะกระทบเฉพาะการเลือกสำหรับคำขอใหม่ ส่วนคำขอเดิมใช้ snapshot ที่บันทึกไว้แล้ว</p>

    {createOpen && <LeaveTypeDialog title="เพิ่มประเภทการลา" busy={busy} error={error} onClose={() => { setCreateOpen(false); setError(undefined); }} onSubmit={() => void submitCreate()}>
      <label className="field-group">
        <span>รหัสประเภทการลา</span>
        <input value={createForm.code} maxLength={40} placeholder="เช่น TRAINING" onChange={(event) => setCreateForm((current) => ({ ...current, code: event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') }))} />
        <small>รหัสเป็นตัวตนถาวรของประเภทการลาและแก้ไม่ได้หลังสร้าง</small>
      </label>
      <label className="field-group">
        <span>ชื่อที่แสดง</span>
        <input value={createForm.name} maxLength={150} placeholder="เช่น ลาฝึกอบรม" onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))} />
      </label>
      <label className="field-group">
        <span>กลุ่มโควตารายปี</span>
        <select value={createForm.quotaBucket} onChange={(event) => setCreateForm((current) => ({ ...current, quotaBucket: event.target.value as LeaveTypeMaster['quotaBucket'] }))}>
          {Object.entries(bucketLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <small>ไม่หักโควตารายปี = ไม่สร้างหรือหักโควตารายปีอัตโนมัติ</small>
      </label>
      <label className="field-group">
        <span>ลำดับแสดงผล</span>
        <input type="number" min={0} max={9999} value={createForm.sortOrder} onChange={(event) => setCreateForm((current) => ({ ...current, sortOrder: Number(event.target.value) }))} />
      </label>
    </LeaveTypeDialog>}

    {editingRow && <LeaveTypeDialog title={`แก้ไข ${displayName(editingRow)}`} busy={busy} error={error} onClose={closeEdit} onSubmit={() => void submitEdit()}>
      <label className="field-group">
        <span>รหัสประเภทการลา</span>
        <input value={editingRow.code} disabled readOnly />
        <small>รหัสแก้ไขไม่ได้หลังสร้าง</small>
      </label>
      <label className="field-group">
        <span>ชื่อที่แสดง</span>
        <input aria-label={`ชื่อ ${editingRow.code}`} value={String(editForm.name ?? '')} maxLength={150} onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))} />
      </label>
      <label className="field-group">
        <span>กลุ่มโควตารายปี</span>
        <select aria-label={`กลุ่มโควตา ${editingRow.code}`} disabled={editingRow.isSystem} value={String(editForm.quotaBucket ?? editingRow.quotaBucket)} onChange={(event) => setEditForm((current) => ({ ...current, quotaBucket: event.target.value as LeaveTypeMaster['quotaBucket'] }))}>
          {Object.entries(bucketLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {editingRow.isSystem && <small>ประเภทหลักของระบบ เปลี่ยนกลุ่มโควตาไม่ได้</small>}
      </label>
      <label className="field-group">
        <span>ลำดับแสดงผล</span>
        <input aria-label={`ลำดับ ${editingRow.code}`} type="number" min={0} max={9999} value={Number(editForm.sortOrder ?? editingRow.sortOrder)} onChange={(event) => setEditForm((current) => ({ ...current, sortOrder: Number(event.target.value) }))} />
      </label>
      <label className="field-group">
        <span>สถานะ</span>
        <select aria-label={`สถานะ ${editingRow.code}`} value={String(Boolean(editForm.isActive ?? editingRow.isActive))} onChange={(event) => setEditForm((current) => ({ ...current, isActive: event.target.value === 'true' }))}>
          <option value="true">เปิดใช้งาน</option><option value="false">ปิดใช้งาน</option>
        </select>
      </label>
    </LeaveTypeDialog>}
  </section>;
}
