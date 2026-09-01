import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

type MasterKind = 'department' | 'position';
type MasterRow = { id: string; name: string; isActive: boolean; sortOrder: number };
type MasterData = { departments: MasterRow[]; positions: MasterRow[] };

type ColumnProps = {
  title: string;
  rows: MasterRow[];
  kind: MasterKind;
  busy: string;
  onCreate(kind: MasterKind, name: string): Promise<void>;
  onToggle(kind: MasterKind, row: MasterRow): Promise<void>;
};

function MasterColumn({ title, rows, kind, busy, onCreate, onToggle }: ColumnProps) {
  const [name, setName] = useState('');
  const active = rows.filter((row) => row.isActive).length;
  return <section className="personnel-master-column">
    <header><div><h3>{title}</h3><small>{active} Active / {rows.length} ทั้งหมด</small></div></header>
    <div className="personnel-master-create">
      <input value={name} maxLength={100} placeholder={kind === 'department' ? 'ชื่อหน่วยงานใหม่' : 'ชื่อตำแหน่งใหม่'} onChange={(event) => setName(event.target.value)} />
      <button type="button" className="btn-primary compact" disabled={!name.trim() || Boolean(busy)} onClick={async () => { await onCreate(kind, name.trim()); setName(''); }}>เพิ่ม</button>
    </div>
    <div className="personnel-master-list">{rows.length ? rows.map((row) => <article key={row.id} className={row.isActive ? '' : 'is-inactive'}>
      <div><strong>{row.name}</strong><small>{row.isActive ? 'Active · ใช้เลือกค่าใหม่ได้' : 'Inactive · เก็บไว้เพื่อประวัติ'}</small></div>
      <button type="button" className={row.isActive ? 'btn-neutral small-action' : 'btn-success'} disabled={Boolean(busy)} onClick={() => void onToggle(kind, row)}>{busy === row.id ? 'กำลังบันทึก…' : row.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>
    </article>) : <p className="personnel-master-empty">ยังไม่มีรายการ</p>}</div>
  </section>;
}

export function PersonnelMasterPanel({ token }: { token: string }) {
  const [data, setData] = useState<MasterData>({ departments: [], positions: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.personnelMasters(token, false);
      const next = result?.data as MasterData | undefined;
      setData({ departments: Array.isArray(next?.departments) ? next!.departments : [], positions: Array.isArray(next?.positions) ? next!.positions : [] });
      setNotice('');
    } catch { setNotice('ไม่สามารถโหลด Department / Position Master ได้'); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  const create = async (kind: MasterKind, name: string) => {
    setBusy('create-' + kind); setNotice('');
    try { await api.createPersonnelMaster(token, kind, { name, isActive: true }); await load(); setNotice('เพิ่ม ' + (kind === 'department' ? 'Department' : 'Position') + ' Master แล้ว'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'เพิ่ม Master ไม่สำเร็จ'); }
    finally { setBusy(''); }
  };
  const toggle = async (kind: MasterKind, row: MasterRow) => {
    setBusy(row.id); setNotice('');
    try { await api.updatePersonnelMaster(token, kind, row.id, { isActive: !row.isActive }); await load(); setNotice(row.name + ': ' + (row.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน') + 'แล้ว'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'บันทึก Master ไม่สำเร็จ'); }
    finally { setBusy(''); }
  };
  return <section className="line-settings-card personnel-master-card">
    <div className="line-settings-title"><span>◫</span><div><h2>Department / Position Master</h2><p>ค่าที่ใช้กับ Employee Master และ Approval Authority ต้องเลือกจากรายการ Active เท่านั้น รายการ Inactive ยังถูกเก็บเพื่ออ่านประวัติเดิม</p></div></div>
    {loading ? <div className="loading-row">กำลังอ่าน Personnel Master…</div> : <div className="personnel-master-grid"><MasterColumn title="Department Master" rows={data.departments} kind="department" busy={busy} onCreate={create} onToggle={toggle} /><MasterColumn title="Position Master" rows={data.positions} kind="position" busy={busy} onCreate={create} onToggle={toggle} /></div>}
    {notice && <div className={notice.includes('แล้ว') ? 'settings-notice success' : 'settings-notice error'}>{notice}</div>}
    <div className="line-settings-actions"><button type="button" className="btn-neutral small-action" disabled={loading || Boolean(busy)} onClick={() => void load()}>↻ รีเฟรช</button></div>
  </section>;
}
