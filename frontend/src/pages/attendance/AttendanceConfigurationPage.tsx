import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { toRequestErrorState } from '../../request-error';
import './attendance-configuration.css';

type Row = Record<string, unknown>;
type Section = 'sites' | 'shifts' | 'duties' | 'policies';
type DialogKind = 'site' | 'shift' | 'duty';

const OFFLINE_SYNC_KEY = 'ATTENDANCE_OFFLINE_SYNC_MAX_AGE_MINUTES';
const LOCAL_RETENTION_KEY = 'ATTENDANCE_CLIENT_LOCAL_RETENTION_DAYS';

const value = (record: Row, key: string) => String(record[key] ?? '');
const rows = (response: any): Row[] => Array.isArray(response?.data) ? response.data : [];

export function validateSiteDraft(draft: Record<string, string>) {
  const latitude = Number(draft.latitude);
  const longitude = Number(draft.longitude);
  const radius = Number(draft.geofenceRadiusMeters);
  if (!draft.code.trim() || !draft.name.trim()) return 'กรุณาระบุรหัสและชื่อจุดปฏิบัติงาน';
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return 'ละติจูดต้องอยู่ระหว่าง -90 ถึง 90';
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return 'ลองจิจูดต้องอยู่ระหว่าง -180 ถึง 180';
  if (!Number.isInteger(radius) || radius < 10 || radius > 100000) return 'รัศมี GPS ต้องเป็นจำนวนเต็มระหว่าง 10 ถึง 100,000 เมตร';
  return undefined;
}

export function validateShiftDraft(draft: Record<string, string>) {
  if (!draft.code.trim() || !draft.name.trim()) return 'กรุณาระบุรหัสและชื่อกะ';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.endTime)) return 'กรุณาระบุเวลาในรูปแบบ HH:mm';
  if (draft.endTime <= draft.startTime && draft.isOvernight !== 'true') return 'โปรดระบุกะข้ามวัน เมื่อเวลาเลิกไม่ช้ากว่าเวลาเริ่ม';
  if (Number(draft.hours) <= 0 || Number(draft.hours) > 24) return 'จำนวนชั่วโมงต้องมากกว่า 0 และไม่เกิน 24';
  return undefined;
}

export function overnightPreview(startTime: string, endTime: string, isOvernight: boolean) {
  return isOvernight ? `${startTime} วันนี้ → ${endTime} วันถัดไป` : `${startTime} → ${endTime} วันนี้`;
}

function status(active: unknown) {
  return <span className={`attendance-status ${active ? 'is-active' : 'is-inactive'}`}>{active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span>;
}

function MasterDialog({ kind, initial, onClose, onSave }: { kind: DialogKind; initial?: Row; onClose(): void; onSave(payload: Record<string, unknown>): Promise<void> }) {
  const [draft, setDraft] = useState<Record<string, string>>(() => ({
    code: value(initial || {}, 'code'), name: value(initial || {}, 'name'),
    latitude: value(initial || {}, 'latitude'), longitude: value(initial || {}, 'longitude'),
    geofenceRadiusMeters: value(initial || {}, 'geofenceRadiusMeters'), address: value(initial || {}, 'address'), description: value(initial || {}, 'description'),
    startTime: value(initial || {}, 'startTime') || '07:00', endTime: value(initial || {}, 'endTime') || '19:00',
    hours: value(initial || {}, 'hours') || '12', color: value(initial || {}, 'color') || '#2F80FF',
    isOvernight: String(Boolean(initial?.isOvernight)), isActive: String(initial?.isActive ?? true)
  }));
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const title = `${initial ? 'แก้ไข' : 'เพิ่ม'}${kind === 'site' ? 'จุดปฏิบัติงาน' : kind === 'shift' ? 'รูปแบบกะ' : 'ประเภทหน้าที่'}`;
  const update = (key: string, next: string) => setDraft((current) => ({ ...current, [key]: next }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validation = kind === 'site' ? validateSiteDraft(draft) : kind === 'shift' ? validateShiftDraft(draft) : (!draft.code.trim() || !draft.name.trim() ? 'กรุณาระบุรหัสและชื่อประเภทหน้าที่' : undefined);
    if (validation) { setError(validation); return; }
    setSaving(true); setError(undefined);
    try {
      const payload = kind === 'site'
        ? { code: draft.code.trim(), name: draft.name.trim(), latitude: Number(draft.latitude), longitude: Number(draft.longitude), geofenceRadiusMeters: Number(draft.geofenceRadiusMeters), address: draft.address.trim() || null, description: draft.description.trim() || null, isActive: draft.isActive === 'true' }
        : kind === 'shift'
          ? { code: draft.code.trim(), name: draft.name.trim(), startTime: draft.startTime, endTime: draft.endTime, hours: Number(draft.hours), color: draft.color.trim() || '#2F80FF', isOvernight: draft.isOvernight === 'true', isActive: draft.isActive === 'true' }
          : { code: draft.code.trim(), name: draft.name.trim(), description: draft.description.trim() || null, isActive: draft.isActive === 'true' };
      await onSave(payload);
      onClose();
    } catch (reason) { setError(toRequestErrorState(reason, 'บันทึกข้อมูลไม่สำเร็จ').message); }
    finally { setSaving(false); }
  };
  return <div className="attendance-dialog-backdrop" role="presentation"><section className="attendance-dialog" role="dialog" aria-modal="true" aria-label={title}><header><div><p>Attendance Configuration</p><h2>{title}</h2></div><button className="btn-icon-only" type="button" aria-label="ปิด" onClick={onClose}>×</button></header>{error && <div className="attendance-form-error">{error}</div>}<form onSubmit={submit}><div className="attendance-form-grid"><label><span>รหัส <b>*</b></span><input required value={draft.code} maxLength={kind === 'shift' ? 20 : 50} onChange={(event) => update('code', event.target.value)} /></label><label><span>{kind === 'shift' ? 'ชื่อกะ' : kind === 'duty' ? 'ชื่อประเภทหน้าที่' : 'ชื่อจุดปฏิบัติงาน'} <b>*</b></span><input required value={draft.name} onChange={(event) => update('name', event.target.value)} /></label>{kind === 'site' && <><label><span>ละติจูด <b>*</b></span><input required inputMode="decimal" value={draft.latitude} onChange={(event) => update('latitude', event.target.value)} /></label><label><span>ลองจิจูด <b>*</b></span><input required inputMode="decimal" value={draft.longitude} onChange={(event) => update('longitude', event.target.value)} /></label><label><span>รัศมี GPS (เมตร) <b>*</b></span><input required type="number" min="10" max="100000" value={draft.geofenceRadiusMeters} onChange={(event) => update('geofenceRadiusMeters', event.target.value)} /></label><label><span>ที่อยู่</span><input value={draft.address} maxLength={500} onChange={(event) => update('address', event.target.value)} /></label></>}{kind === 'shift' && <><label><span>เวลาเริ่ม <b>*</b></span><input required type="time" value={draft.startTime} onChange={(event) => update('startTime', event.target.value)} /></label><label><span>เวลาเลิก <b>*</b></span><input required type="time" value={draft.endTime} onChange={(event) => update('endTime', event.target.value)} /></label><label><span>ชั่วโมง <b>*</b></span><input required type="number" min="0.25" max="24" step="0.25" value={draft.hours} onChange={(event) => update('hours', event.target.value)} /></label><label><span>สี</span><input value={draft.color} onChange={(event) => update('color', event.target.value)} /></label><label className="attendance-checkbox"><input type="checkbox" checked={draft.isOvernight === 'true'} onChange={(event) => update('isOvernight', String(event.target.checked))} /><span>กะข้ามวัน</span><small>{overnightPreview(draft.startTime, draft.endTime, draft.isOvernight === 'true')}</small></label></>}{(kind === 'site' || kind === 'duty') && <label className="attendance-form-wide"><span>รายละเอียด</span><textarea rows={3} value={draft.description} onChange={(event) => update('description', event.target.value)} /></label>}<label className="attendance-checkbox"><input type="checkbox" checked={draft.isActive === 'true'} onChange={(event) => update('isActive', String(event.target.checked))} /><span>เปิดใช้งาน</span><small>ข้อมูลย้อนหลังยังคงอยู่ และรายการใหม่จะใช้เฉพาะ master ที่เปิดใช้งาน</small></label></div><footer><button type="button" className="btn-neutral" onClick={onClose}>ยกเลิก</button><button className="btn-primary" disabled={saving} type="submit">{saving ? 'กำลังบันทึก…' : 'บันทึก'}</button></footer></form></section></div>;
}

export function AttendanceConfigurationPage({ token, role }: { token?: string; role?: string }) {
  const [section, setSection] = useState<Section>('sites');
  const [sites, setSites] = useState<Row[]>([]); const [shifts, setShifts] = useState<Row[]>([]); const [duties, setDuties] = useState<Row[]>([]); const [settings, setSettings] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string>(); const [dialog, setDialog] = useState<{ kind: DialogKind; record?: Row }>();
  const [search, setSearch] = useState(''); const [savingPolicy, setSavingPolicy] = useState(false); const [policyError, setPolicyError] = useState<string>();
  const [offlineHours, setOfflineHours] = useState('24'); const [localRetentionDays, setLocalRetentionDays] = useState('7');
  const isAdmin = role === 'ADMIN';
  const load = async () => {
    if (!token || !isAdmin) { setLoading(false); return; }
    setLoading(true); setError(undefined);
    try {
      const [siteResponse, shiftResponse, dutyResponse, settingResponse] = await Promise.all([api.attendanceSites(token), api.shiftTypes(token), api.attendanceDuties(token), api.systemSettings(token)]);
      setSites(rows(siteResponse)); setShifts(rows(shiftResponse)); setDuties(rows(dutyResponse));
      const policySettings = rows(settingResponse); setSettings(policySettings);
      const offlineMinutes = Number(policySettings.find((item) => value(item, 'key') === OFFLINE_SYNC_KEY)?.value || 1440);
      setOfflineHours(String(offlineMinutes / 60)); setLocalRetentionDays(value(policySettings.find((item) => value(item, 'key') === LOCAL_RETENTION_KEY) || {}, 'value') || '7');
    } catch (reason) { setError(toRequestErrorState(reason, 'ไม่สามารถอ่านการตั้งค่าการลงเวลาได้').message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [token, isAdmin]);
  const currentRows = section === 'sites' ? sites : section === 'shifts' ? shifts : duties;
  const filtered = useMemo(() => currentRows.filter((item) => `${value(item, 'code')} ${value(item, 'name')}`.toLowerCase().includes(search.trim().toLowerCase())), [currentRows, search]);
  const toggle = async (kind: DialogKind, item: Row) => {
    if (!token) return;
    const nextActive = !Boolean(item.isActive);
    if (!nextActive && !window.confirm('ปิดใช้งานข้อมูลนี้หรือไม่? รายการใหม่จะเลือกไม่ได้ แต่ข้อมูลย้อนหลังจะไม่ถูกลบ')) return;
    const payload = { isActive: nextActive };
    try {
      if (kind === 'site') await api.updateAttendanceSite(token, value(item, 'id'), payload);
      else if (kind === 'shift') await api.updateShiftType(token, value(item, 'id'), payload);
      else await api.updateAttendanceDuty(token, value(item, 'id'), payload);
      await load();
    } catch (reason) { setError(toRequestErrorState(reason, 'เปลี่ยนสถานะไม่สำเร็จ').message); }
  };
  const saveMaster = async (kind: DialogKind, record: Row | undefined, payload: Record<string, unknown>) => {
    if (!token) return;
    if (kind === 'site') record ? await api.updateAttendanceSite(token, value(record, 'id'), payload) : await api.createAttendanceSite(token, payload);
    else if (kind === 'shift') record ? await api.updateShiftType(token, value(record, 'id'), payload) : await api.createShiftType(token, payload);
    else record ? await api.updateAttendanceDuty(token, value(record, 'id'), payload) : await api.createAttendanceDuty(token, payload);
    await load();
  };
  const savePolicies = async () => {
    if (!token) return;
    const hours = Number(offlineHours); const days = Number(localRetentionDays);
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) { setPolicyError('หน้าต่าง sync ต้องอยู่ระหว่าง 1 ถึง 168 ชั่วโมง'); return; }
    if (!Number.isInteger(days) || days < 1 || days > 30) { setPolicyError('การเก็บข้อมูลในเครื่องต้องอยู่ระหว่าง 1 ถึง 30 วัน'); return; }
    setSavingPolicy(true); setPolicyError(undefined);
    try {
      await Promise.all([
        api.updateSystemSetting(token, OFFLINE_SYNC_KEY, { value: String(hours * 60), description: 'Maximum age for normal attendance offline synchronization in minutes.' }),
        api.updateSystemSetting(token, LOCAL_RETENTION_KEY, { value: String(days), description: 'Future client-local attendance evidence retention in days.' })
      ]);
      await load();
    } catch (reason) { setPolicyError(toRequestErrorState(reason, 'บันทึกนโยบายไม่สำเร็จ').message); }
    finally { setSavingPolicy(false); }
  };
  if (!isAdmin) return <section className="view-pane attendance-config-page"><div className="attendance-access-denied"><h1>ตั้งค่าระบบลงเวลา</h1><p>หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</p></div></section>;
  const labels: Record<Section, string> = { sites: 'จุดปฏิบัติงาน', shifts: 'รูปแบบกะ', duties: 'ประเภทหน้าที่', policies: 'นโยบายการลงเวลา' };
  const kind: DialogKind = section === 'sites' ? 'site' : section === 'shifts' ? 'shift' : 'duty';
  return <section className="view-pane attendance-config-page"><div className="page-heading attendance-config-heading"><div><p className="eyebrow">Attendance Administration</p><h1>ตั้งค่าระบบลงเวลา</h1><p>กำหนด Site, กะ, หน้าที่ และนโยบายให้พร้อมก่อนเปิดใช้การลงเวลาพนักงาน</p></div><span className="record-chip">Configuration only · ยังไม่เปิด Check-in</span></div><div className="attendance-config-tabs" role="tablist">{(Object.keys(labels) as Section[]).map((item) => <button key={item} className={section === item ? 'is-active' : ''} type="button" role="tab" aria-selected={section === item} onClick={() => { setSection(item); setSearch(''); }}>{labels[item]}</button>)}</div>{error && <div className="attendance-form-error">{error}</div>}{section === 'policies' ? <div className="attendance-policy-grid"><article><span>Normal Offline Sync Window</span><h2>หน้าต่าง sync ปกติ</h2><p>กำหนดอายุสูงสุดของข้อมูล offline ก่อนต้องเข้าสู่การทบทวน ไม่ได้ยืนยันเวลาจากอุปกรณ์โดยอัตโนมัติ</p><label>ชั่วโมง<input type="number" min="1" max="168" value={offlineHours} onChange={(event) => setOfflineHours(event.target.value)} /></label></article><article><span>Future Client Retention</span><h2>เก็บหลักฐานในเครื่อง</h2><p>ใช้กับหลักฐานที่ยังไม่ sync ในอนาคตเท่านั้น ไม่ใช่ระยะเก็บหลักฐานบน Server</p><label>วัน<input type="number" min="1" max="30" value={localRetentionDays} onChange={(event) => setLocalRetentionDays(event.target.value)} /></label></article><article className="attendance-invariant-card"><span>Governance invariant</span><h2>หลักฐานบน Server</h2><p>เก็บแบบ rolling 1 ปีจาก capturedAt และไม่เป็นตัวเลือกตั้งค่าทั่วไปของ Admin</p></article>{policyError && <div className="attendance-form-error">{policyError}</div>}<div className="attendance-policy-actions"><button className="btn-primary" type="button" disabled={savingPolicy} onClick={savePolicies}>{savingPolicy ? 'กำลังบันทึก…' : 'บันทึกนโยบาย'}</button></div></div> : <><div className="toolbar attendance-master-toolbar"><div className="search-box"><input aria-label={`ค้นหา${labels[section]}`} placeholder={`ค้นหา${labels[section]}…`} value={search} onChange={(event) => setSearch(event.target.value)} /></div><span className="toolbar-count">{filtered.length} รายการ</span><button className="btn-primary compact" type="button" onClick={() => setDialog({ kind })}>+ เพิ่ม{labels[section]}</button></div><div className="table-card attendance-master-table">{loading ? <div className="loading-row">กำลังอ่านข้อมูล…</div> : <div className="table-scroll"><table className="data-table"><thead><tr><th>รหัส</th><th>ชื่อ</th>{section === 'sites' && <><th>พิกัด</th><th>รัศมี GPS</th></>}{section === 'shifts' && <><th>เวลา</th><th>ข้ามวัน</th></>}<th>สถานะ</th><th className="table-action-header">จัดการ</th></tr></thead><tbody>{filtered.length ? filtered.map((item) => <tr key={value(item, 'id')}><td><code>{value(item, 'code')}</code></td><td className="employee-name">{value(item, 'name')} {section === 'duties' && value(item, 'description') ? <small className="cell-note">{value(item, 'description')}</small> : null}</td>{section === 'sites' && <><td>{value(item, 'latitude')}, {value(item, 'longitude')}</td><td>{value(item, 'geofenceRadiusMeters')} ม.</td></>}{section === 'shifts' && <><td>{value(item, 'startTime')} – {value(item, 'endTime')}<small className="cell-note">{overnightPreview(value(item, 'startTime'), value(item, 'endTime'), Boolean(item.isOvernight))}</small></td><td>{item.isOvernight ? 'ใช่' : 'ไม่ใช่'}</td></>}<td>{status(item.isActive)}</td><td className="row-actions data-row-actions"><button className="btn-neutral small-action" type="button" onClick={() => setDialog({ kind, record: item })}>แก้ไข</button><button className="btn-neutral small-action" type="button" onClick={() => void toggle(kind, item)}>{item.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button></td></tr>) : <tr><td className="no-rows" colSpan={section === 'sites' ? 6 : section === 'shifts' ? 6 : 4}>ยังไม่มี{labels[section]} — เพิ่มข้อมูลเพื่อเตรียมระบบลงเวลา</td></tr>}</tbody></table></div>}</div></>}{dialog && <MasterDialog kind={dialog.kind} initial={dialog.record} onClose={() => setDialog(undefined)} onSave={(payload) => saveMaster(dialog.kind, dialog.record, payload)} />}</section>;
}
