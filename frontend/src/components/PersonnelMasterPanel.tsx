import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';

type MasterKind = 'department' | 'position';
type MasterRow = { id: string; code: string; name: string; isActive: boolean; sortOrder: number };
type MasterData = { departments: MasterRow[]; positions: MasterRow[] };
type MasterImpact = { id: string; kind: MasterKind; name: string; employeeReferences: number; approvalAuthorityReferences: number; totalReferences: number };

type ColumnProps = {
  title: string; rows: MasterRow[]; kind: MasterKind; busy: string;
  onCreate(kind: MasterKind, code: string, name: string): Promise<void>;
  onEdit(kind: MasterKind, row: MasterRow, input: Pick<MasterRow, 'name' | 'sortOrder'>): Promise<void>;
  onActivate(kind: MasterKind, row: MasterRow): Promise<void>;
  onPreflight(kind: MasterKind, row: MasterRow): Promise<MasterImpact>;
  onDeactivate(kind: MasterKind, row: MasterRow, reason: string): Promise<void>;
};

function MasterColumn({ title, rows, kind, busy, onCreate, onEdit, onActivate, onPreflight, onDeactivate }: ColumnProps) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [impact, setImpact] = useState<MasterImpact>();
  const [target, setTarget] = useState<MasterRow>();
  const [reason, setReason] = useState('');
  const [editTarget, setEditTarget] = useState<MasterRow>();
  const [editName, setEditName] = useState('');
  const [editSortOrder, setEditSortOrder] = useState('0');
  const [editError, setEditError] = useState('');
  const active = rows.filter((row) => row.isActive).length;
  const visibleRows = useMemo(() => { const q=query.trim().toLocaleLowerCase('th-TH'); return q ? rows.filter((row)=>row.name.toLocaleLowerCase('th-TH').includes(q)) : rows; }, [rows, query]);
  const closeImpact = () => { setImpact(undefined); setTarget(undefined); setReason(''); };
  const beginEdit = (row: MasterRow) => { setEditTarget(row); setEditName(row.name); setEditSortOrder(String(row.sortOrder)); setEditError(''); closeImpact(); };
  const closeEdit = () => { setEditTarget(undefined); setEditName(''); setEditSortOrder('0'); setEditError(''); };
  const saveEdit = async () => {
    if (!editTarget) return;
    const name = editName.trim();
    const sortOrder = Number(editSortOrder);
    if (!name || name.length > 100) { setEditError('ชื่อ Master ต้องมี 1-100 ตัวอักษร'); return; }
    if (!Number.isInteger(sortOrder) || sortOrder < -9999 || sortOrder > 9999) { setEditError('ลำดับต้องเป็นจำนวนเต็มระหว่าง -9999 ถึง 9999'); return; }
    setEditError('');
    try {
      await onEdit(kind, editTarget, { name, sortOrder });
      closeEdit();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'บันทึก Master ไม่สำเร็จ');
    }
  };
  return <section className="personnel-master-column">
    <header><div><h3>{title}</h3><small>{active} Active / {rows.length} ทั้งหมด</small></div></header>
    <div className="personnel-master-create personnel-master-create--coded">
      <input value={code} maxLength={50} placeholder={kind === 'department' ? 'Code เช่น SEC' : 'Code เช่น OFFICER'} onChange={(event) => setCode(event.target.value.toUpperCase())} />
      <input value={name} maxLength={100} placeholder={kind === 'department' ? 'ชื่อหน่วยงานใหม่' : 'ชื่อตำแหน่งใหม่'} onChange={(event) => setName(event.target.value)} />
      <button type="button" className="btn-primary compact" disabled={!code.trim() || !name.trim() || Boolean(busy)} onClick={async () => { await onCreate(kind, code.trim(), name.trim()); setCode(''); setName(''); }}>เพิ่ม</button>
    </div>
    <label className="personnel-master-search"><span>ค้นหา</span><input value={query} placeholder={kind === 'department' ? 'ค้นหา Department' : 'ค้นหา Position'} onChange={(event)=>setQuery(event.target.value)} /></label>
    <div className="personnel-master-list">{visibleRows.length ? visibleRows.map((row) => <div className="personnel-master-record" key={row.id}>
      <article className={row.isActive ? '' : 'is-inactive'}>
        <div><strong>{row.code} · {row.name}</strong><small>{row.isActive ? `Active · ลำดับ ${row.sortOrder} · ใช้เลือกค่าใหม่ได้` : `Inactive · ลำดับ ${row.sortOrder} · เก็บไว้เพื่อประวัติ`}</small></div>
        <div className="personnel-master-row-actions"><button type="button" className="btn-neutral small-action" disabled={Boolean(busy)} onClick={() => beginEdit(row)}>แก้ไข</button><button type="button" className={row.isActive ? 'btn-neutral small-action' : 'btn-success'} disabled={Boolean(busy)} onClick={async () => { if (!row.isActive) { await onActivate(kind,row); return; } const nextImpact=await onPreflight(kind,row); setImpact(nextImpact); setTarget(row); setReason(''); }}>{busy === row.id ? 'กำลังบันทึก…' : row.isActive ? 'ตรวจสอบก่อนปิด' : 'เปิดใช้งาน'}</button></div>
      </article>
      {editTarget?.id === row.id && <form className="personnel-master-edit" aria-label={`แก้ไข ${title}: ${row.code}`} onSubmit={(event) => { event.preventDefault(); void saveEdit(); }}><p><strong>แก้ไข {row.code}</strong><span>รหัส Master คงที่เพื่อรักษา reference integrity</span></p><label><span>ชื่อ</span><input value={editName} maxLength={100} onChange={(event) => setEditName(event.target.value)} autoFocus /></label><label><span>ลำดับแสดงผล</span><input value={editSortOrder} inputMode="numeric" type="number" min={-9999} max={9999} onChange={(event) => setEditSortOrder(event.target.value)} /></label>{editError && <div className="personnel-master-edit-error" role="alert">{editError}</div>}<div className="personnel-master-edit-actions"><button type="button" className="btn-neutral small-action" disabled={Boolean(busy)} onClick={closeEdit}>ยกเลิก</button><button type="submit" className="btn-primary compact" disabled={Boolean(busy)}>{busy === row.id ? 'กำลังบันทึก…' : 'บันทึกการแก้ไข'}</button></div></form>}
    </div>) : <p className="personnel-master-empty">ไม่พบรายการที่ตรงกับการค้นหา</p>}</div>
    {impact && target && <div className="personnel-master-impact" role="alert" aria-live="polite"><h4>Impact Preview ก่อนปิดใช้งาน</h4><p><strong>{impact.name}</strong> จะไม่สามารถถูกเลือกเป็นค่าใหม่ได้ แต่ประวัติเดิมยังคงอยู่</p><dl><div><dt>พนักงานที่ยังอ้างค่านี้</dt><dd>{impact.employeeReferences}</dd></div><div><dt>Approval Authority aliases</dt><dd>{impact.approvalAuthorityReferences}</dd></div><div><dt>รวมการอ้างอิง</dt><dd>{impact.totalReferences}</dd></div></dl><label>เหตุผลในการปิดใช้งาน<textarea value={reason} maxLength={1000} rows={3} onChange={(event)=>setReason(event.target.value)} /></label><div className="personnel-master-impact-actions"><button type="button" className="btn-neutral small-action" onClick={closeImpact}>ยกเลิก</button><button type="button" className="btn-danger small-action" disabled={reason.trim().length < 3 || Boolean(busy)} onClick={async()=>{await onDeactivate(kind,target,reason.trim());closeImpact();}}>ยืนยันปิดใช้งาน</button></div></div>}
  </section>;
}

export function PersonnelMasterPanel({ token }: { token: string }) {
  const [data, setData] = useState<MasterData>({ departments: [], positions: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => { setLoading(true); try { const result = await api.personnelMasters(token, false); const next = result?.data as MasterData | undefined; setData({ departments: Array.isArray(next?.departments) ? next!.departments : [], positions: Array.isArray(next?.positions) ? next!.positions : [] }); setNotice(''); } catch { setNotice('ไม่สามารถโหลด Department / Position Master ได้'); } finally { setLoading(false); } }, [token]);
  useEffect(() => { void load(); }, [load]);
  const create = async (kind: MasterKind, code: string, name: string) => { setBusy('create-' + kind); setNotice(''); try { await api.createPersonnelMaster(token, kind, { code, name, isActive: true }); await load(); setNotice('เพิ่ม ' + (kind === 'department' ? 'Department' : 'Position') + ' Master แล้ว'); } catch (error) { setNotice(error instanceof Error ? error.message : 'เพิ่ม Master ไม่สำเร็จ'); } finally { setBusy(''); } };
  const edit = async (kind: MasterKind, row: MasterRow, input: Pick<MasterRow, 'name' | 'sortOrder'>) => { setBusy(row.id); setNotice(''); try { await api.updatePersonnelMaster(token, kind, row.id, input); await load(); setNotice(row.name + ': บันทึกการแก้ไขแล้ว'); } catch (error) { const message = error instanceof Error ? error.message : 'บันทึก Master ไม่สำเร็จ'; setNotice(message); throw error; } finally { setBusy(''); } };
  const activate = async (kind: MasterKind, row: MasterRow) => { setBusy(row.id); setNotice(''); try { await api.updatePersonnelMaster(token, kind, row.id, { isActive: true }); await load(); setNotice(row.name + ': เปิดใช้งานแล้ว'); } catch (error) { setNotice(error instanceof Error ? error.message : 'บันทึก Master ไม่สำเร็จ'); } finally { setBusy(''); } };
  const preflight = async (kind: MasterKind, row: MasterRow) => { setBusy(row.id); setNotice(''); try { const result=await api.personnelMasterImpact(token,kind,row.id); return result?.data as MasterImpact; } catch(error) { setNotice(error instanceof Error ? error.message : 'ตรวจสอบผลกระทบไม่สำเร็จ'); throw error; } finally { setBusy(''); } };
  const deactivate = async (kind: MasterKind, row: MasterRow, reason: string) => { setBusy(row.id); setNotice(''); try { await api.updatePersonnelMaster(token, kind, row.id, { isActive: false, confirmImpact: true, reason }); await load(); setNotice(row.name + ': ปิดใช้งานแล้ว'); } catch(error) { setNotice(error instanceof Error ? error.message : 'ปิดใช้งาน Master ไม่สำเร็จ'); throw error; } finally { setBusy(''); } };
  return <section className="line-settings-card personnel-master-card"><div className="line-settings-title"><span>◫</span><div><h2>Department / Position Master</h2><p>ค่าที่ใช้กับ Employee Master และ Approval Authority ต้องเลือกจากรายการ Active เท่านั้น แก้ไขได้เฉพาะชื่อและลำดับ โดยรหัสคงที่เพื่อรักษา reference integrity การปิดใช้งานต้องตรวจสอบ Impact Preview และระบุเหตุผล ส่วน Inactive ยังคงอยู่เพื่อประวัติ</p></div></div>{loading ? <div className="loading-row">กำลังอ่าน Personnel Master…</div> : <div className="personnel-master-grid"><MasterColumn title="Department Master" rows={data.departments} kind="department" busy={busy} onCreate={create} onEdit={edit} onActivate={activate} onPreflight={preflight} onDeactivate={deactivate} /><MasterColumn title="Position Master" rows={data.positions} kind="position" busy={busy} onCreate={create} onEdit={edit} onActivate={activate} onPreflight={preflight} onDeactivate={deactivate} /></div>}{notice && <div className={notice.includes('แล้ว') ? 'settings-notice success' : 'settings-notice error'}>{notice}</div>}<div className="line-settings-actions"><button type="button" className="btn-neutral small-action" disabled={loading || Boolean(busy)} onClick={() => void load()}>↻ รีเฟรช</button></div></section>;
}
