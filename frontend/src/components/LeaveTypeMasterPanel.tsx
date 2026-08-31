import { useEffect, useState } from 'react';
import type { LeaveTypeMaster } from '../leave-type-client';

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

  return <section className="line-settings-card leave-type-master-card">
    <div className="line-settings-title">
      <span>🗂️</span>
      <div>
        <h2>ประเภทการลา</h2>
        <p>จัดการรหัสประเภทการลา ชื่อที่แสดง สถานะใช้งาน และกลุ่มโควตารายปี โดยไม่ลบหรือเขียนทับประวัติเดิม</p>
      </div>
    </div>

    {loading ? <div className="loading-row">กำลังอ่าน Leave Type Master…</div> : <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>ประเภทการลา</th><th>ชื่อ</th><th>กลุ่มโควตา</th><th>ลำดับ</th><th>สถานะ</th><th>ข้อกำหนด</th><th>จัดการ</th></tr></thead>
        <tbody>
          {items.map((row) => {
            const editing = editingId === row.id;
            return <tr key={row.id}>
              <td title={`รหัสระบบ: ${row.code}`}>{row.code === 'SICK' ? 'ลาป่วย' : row.code === 'PERSONAL' ? 'ลากิจ' : row.code === 'VACATION' ? 'ลาพักร้อน' : row.name}</td>
              <td>{editing
                ? <input value={String(editForm.name ?? '')} maxLength={150} onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))} />
                : row.name}</td>
              <td>{editing
                ? <select disabled={row.isSystem} value={String(editForm.quotaBucket ?? row.quotaBucket)} onChange={(event) => setEditForm((current) => ({ ...current, quotaBucket: event.target.value as LeaveTypeMaster['quotaBucket'] }))}>
                    {Object.entries(bucketLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                : bucketLabels[row.quotaBucket]}</td>
              <td>{editing
                ? <input type="number" min={0} max={9999} value={Number(editForm.sortOrder ?? row.sortOrder)} onChange={(event) => setEditForm((current) => ({ ...current, sortOrder: Number(event.target.value) }))} />
                : row.sortOrder}</td>
              <td>{editing
                ? <select value={String(Boolean(editForm.isActive ?? row.isActive))} onChange={(event) => setEditForm((current) => ({ ...current, isActive: event.target.value === 'true' }))}>
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                : row.isActive ? 'Active' : 'Inactive'}</td>
              <td>{row.isSystem ? 'ประเภทหลัก · ป้องกันรหัส/โควตา' : 'ผู้ดูแลระบบ · รหัสคงที่'}</td>
              <td>{editing
                ? <div className="row-actions">
                    <button className="btn-primary compact" disabled={busy} onClick={() => void submitEdit()}>บันทึก</button>
                    <button className="btn-neutral small-action" disabled={busy} onClick={() => { setEditingId(undefined); setEditForm({}); }}>ยกเลิก</button>
                  </div>
                : <button className="btn-neutral small-action" disabled={busy} onClick={() => beginEdit(row)}>แก้ไข</button>}</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>}

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
