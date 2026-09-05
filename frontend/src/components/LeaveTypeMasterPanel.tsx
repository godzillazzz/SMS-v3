import { useEffect, useState } from 'react';
import type { LeaveTypeMaster } from '../leave-type-client';
import { DataTableSkeletonCards, DataTableSkeletonRows, DataTableState, ResponsiveDataTable } from './ResponsiveDataTable';

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
    <header><div><small>ประเภทการลา</small><code>{row.code}</code></div><span className={`status-badge ${active ? 'status-badge--success' : 'status-badge--neutral'}`}>{active ? 'Active' : 'Inactive'}</span></header>
    <h3>{row.code === 'SICK' ? 'ลาป่วย' : row.code === 'PERSONAL' ? 'ลากิจ' : row.code === 'VACATION' ? 'ลาพักร้อน' : row.name}</h3>
    <dl>
      <div><dt>ชื่อ</dt><dd>{editing ? <input aria-label={`ชื่อ ${row.code}`} value={String(editForm.name ?? row.name)} maxLength={150} onChange={(event) => onChange({ name: event.target.value })} /> : row.name}</dd></div>
      <div><dt>กลุ่มโควตา</dt><dd>{editing ? <select aria-label={`กลุ่มโควตา ${row.code}`} disabled={row.isSystem} value={String(editForm.quotaBucket ?? row.quotaBucket)} onChange={(event) => onChange({ quotaBucket: event.target.value as LeaveTypeMaster['quotaBucket'] })}>{Object.entries(bucketLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : bucketLabels[row.quotaBucket]}</dd></div>
      <div><dt>ลำดับ</dt><dd>{editing ? <input aria-label={`ลำดับ ${row.code}`} type="number" min={0} max={9999} value={Number(editForm.sortOrder ?? row.sortOrder)} onChange={(event) => onChange({ sortOrder: Number(event.target.value) })} /> : row.sortOrder}</dd></div>
      <div><dt>ข้อกำหนด</dt><dd>{row.isSystem ? 'ประเภทหลัก · ป้องกันรหัส/โควตา' : 'ผู้ดูแลระบบ · รหัสคงที่'}</dd></div>
    </dl>
    {editing && <label className="leave-type-mobile-status"><span>สถานะ</span><select aria-label={`สถานะ ${row.code}`} value={String(active)} onChange={(event) => onChange({ isActive: event.target.value === 'true' })}><option value="true">Active</option><option value="false">Inactive</option></select></label>}
    <footer>{editing ? <><button type="button" className="btn-primary compact" disabled={busy} onClick={onSave}>บันทึก</button><button type="button" className="btn-neutral small-action" disabled={busy} onClick={onCancel}>ยกเลิก</button></> : <button type="button" className="btn-neutral small-action" disabled={busy} onClick={onBeginEdit}>แก้ไข</button>}</footer>
  </article>;
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
  const [createForm, setCreateForm] = useState<CreateInput>({
    code: '',
    name: '',
    quotaBucket: 'NONE',
    isActive: true,
    sortOrder: 100
  });
  const [editingId, setEditingId] = useState<string>();
  const [editForm, setEditForm] = useState<UpdateInput>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    if (!editingId) return;
    const row = items.find((item) => item.id === editingId);
    if (!row) {
      setEditingId(undefined);
      setEditForm({});
    }
  }, [editingId, items]);

  const beginEdit = (row: LeaveTypeMaster) => {
    setEditingId(row.id);
    setEditForm({
      name: row.name,
      quotaBucket: row.quotaBucket,
      isActive: row.isActive,
      sortOrder: row.sortOrder
    });
    setNotice(undefined);
  };

  const submitCreate = async () => {
    setBusy(true);
    setNotice(undefined);
    try {
      await onCreate({
        ...createForm,
        code: createForm.code.trim().toUpperCase(),
        name: createForm.name.trim()
      });
      setCreateForm({ code: '', name: '', quotaBucket: 'NONE', isActive: true, sortOrder: 100 });
      setNotice('เพิ่ม Leave Type สำเร็จแล้ว');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'เพิ่ม Leave Type ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async () => {
    if (!editingId) return;
    setBusy(true);
    setNotice(undefined);
    try {
      await onUpdate(editingId, editForm);
      setNotice('บันทึก Leave Type สำเร็จแล้ว');
      setEditingId(undefined);
      setEditForm({});
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'บันทึก Leave Type ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const desktop = <div className="data-table-scroll"><table className="data-surface-table leave-type-data-table" aria-label="ประเภทการลา"><thead><tr><th scope="col">ประเภทการลา</th><th scope="col">ชื่อ</th><th scope="col">กลุ่มโควตา</th><th scope="col">ลำดับ</th><th scope="col">สถานะ</th><th scope="col">ข้อกำหนด</th><th scope="col">จัดการ</th></tr></thead><tbody>
    {loading ? <DataTableSkeletonRows columnCount={7} rowCount={4} /> : items.length ? items.map((row) => {
      const editing = editingId === row.id;
      return <tr key={row.id}>
        <td title={`รหัสระบบ: ${row.code}`}>{row.code === 'SICK' ? 'ลาป่วย' : row.code === 'PERSONAL' ? 'ลากิจ' : row.code === 'VACATION' ? 'ลาพักร้อน' : row.name}</td>
        <td>{editing
          ? <input aria-label={`ชื่อ ${row.code}`} value={String(editForm.name ?? '')} maxLength={150} onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))} />
          : row.name}</td>
        <td>{editing
          ? <select aria-label={`กลุ่มโควตา ${row.code}`} disabled={row.isSystem} value={String(editForm.quotaBucket ?? row.quotaBucket)} onChange={(event) => setEditForm((current) => ({ ...current, quotaBucket: event.target.value as LeaveTypeMaster['quotaBucket'] }))}>
              {Object.entries(bucketLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          : bucketLabels[row.quotaBucket]}</td>
        <td>{editing
          ? <input aria-label={`ลำดับ ${row.code}`} type="number" min={0} max={9999} value={Number(editForm.sortOrder ?? row.sortOrder)} onChange={(event) => setEditForm((current) => ({ ...current, sortOrder: Number(event.target.value) }))} />
          : row.sortOrder}</td>
        <td>{editing
          ? <select aria-label={`สถานะ ${row.code}`} value={String(Boolean(editForm.isActive ?? row.isActive))} onChange={(event) => setEditForm((current) => ({ ...current, isActive: event.target.value === 'true' }))}>
              <option value="true">Active</option><option value="false">Inactive</option>
            </select>
          : row.isActive ? 'Active' : 'Inactive'}</td>
        <td>{row.isSystem ? 'ประเภทหลัก · ป้องกันรหัส/โควตา' : 'ผู้ดูแลระบบ · รหัสคงที่'}</td>
        <td>{editing
          ? <div className="row-actions">
              <button type="button" className="btn-primary compact" disabled={busy} onClick={() => void submitEdit()}>บันทึก</button>
              <button type="button" className="btn-neutral small-action" disabled={busy} onClick={() => { setEditingId(undefined); setEditForm({}); }}>ยกเลิก</button>
            </div>
          : <button type="button" className="btn-neutral small-action" disabled={busy} onClick={() => beginEdit(row)}>แก้ไข</button>}</td>
      </tr>;
    }) : <tr><td colSpan={7} className="data-table-empty-cell"><DataTableState variant="empty" title="ยังไม่มีประเภทการลา" description="เพิ่ม Leave Type ใหม่ได้จากฟอร์มด้านล่าง" announce={false} /></td></tr>}
  </tbody></table></div>;
  const mobile = loading
    ? <div className="leave-type-mobile-cards"><DataTableSkeletonCards count={3} cardClassName="data-mobile-card leave-type-mobile-skeleton" /></div>
    : items.length
      ? <div className="leave-type-mobile-cards">{items.map((row) => <LeaveTypeCard key={row.id} row={row} editing={editingId === row.id} editForm={editForm} busy={busy} onBeginEdit={() => beginEdit(row)} onChange={(change) => setEditForm((current) => ({ ...current, ...change }))} onSave={() => void submitEdit()} onCancel={() => { setEditingId(undefined); setEditForm({}); }} />)}</div>
      : <DataTableState variant="empty" title="ยังไม่มีประเภทการลา" description="เพิ่ม Leave Type ใหม่ได้จากฟอร์มด้านล่าง" />;

  return <section className="line-settings-card leave-type-master-card">
    <div className="line-settings-title">
      <span>🗂️</span>
      <div>
        <h2>ประเภทการลา</h2>
        <p>จัดการรหัสประเภทการลา ชื่อที่แสดง สถานะใช้งาน และกลุ่มโควตารายปี โดยไม่ลบหรือเขียนทับประวัติเดิม</p>
      </div>
    </div>

    <ResponsiveDataTable ariaLabel="ประเภทการลา" loading={loading} loadingLabel="กำลังอ่าน Leave Type Master…" hasRows={items.length > 0} className="leave-type-responsive-table" desktop={desktop} mobile={mobile} />

    <div className="line-secure-grid">
      <label className="field-group">
        <span>รหัสประเภทการลาใหม่</span>
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
    </div>

    <div className="alert alert-info">ไม่มีคำสั่ง Delete สำหรับ Leave Type Master การปิดใช้งานจะกระทบเฉพาะการเลือกสำหรับคำขอใหม่ ส่วนคำขอเดิมใช้ snapshot ที่บันทึกไว้แล้ว</div>
    {notice && <div className={notice.includes('สำเร็จ') ? 'settings-notice success' : 'settings-notice error'}>{notice}</div>}
    <div className="line-settings-actions">
      <button className="btn-primary compact" disabled={busy || !createForm.code.trim() || !createForm.name.trim()} onClick={() => void submitCreate()}>＋ เพิ่ม Leave Type</button>
      <button className="btn-neutral small-action" disabled={busy} onClick={onRefresh}>↻ รีเฟรช</button>
    </div>
  </section>;
}
