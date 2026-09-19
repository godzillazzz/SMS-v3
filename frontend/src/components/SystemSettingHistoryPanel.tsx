import { useState } from 'react';
import { systemSettingHistoryClient, type SettingHistoryData } from './system-setting-history-client';
import { useActionDialog } from './useActionDialog';

type Props = {
  token: string;
  settings: Array<Record<string, unknown>>;
  onRestored(): void;
};

export function SystemSettingHistoryPanel({ token, settings, onRestored }: Props) {
  const actionDialog = useActionDialog();
  const [selected, setSelected] = useState('');
  const [data, setData] = useState<SettingHistoryData>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const registered = settings.filter((item) => item.registryStatus === 'REGISTERED');

  const load = async (key: string) => {
    setSelected(key);
    setBusy(true);
    setNotice('');
    try {
      setData(await systemSettingHistoryClient.get(token, key));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'โหลดประวัติไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const restore = async (id: string) => {
    const reason = (await actionDialog.prompt({
      title: 'Restore ค่าการตั้งค่า',
      message: 'ระบบจะสร้างการเปลี่ยนแปลงใหม่และบันทึก Audit เพิ่ม โดยไม่แก้ไขประวัติเดิม',
      context: selected,
      fieldLabel: 'เหตุผลในการ Restore',
      placeholder: 'ระบุเหตุผลอย่างน้อย 3 ตัวอักษร',
      helperText: 'เหตุผลนี้จะถูกบันทึกใน Audit',
      minLength: 3,
      maxLength: 500,
      multiline: true,
      confirmLabel: 'ยืนยัน Restore',
      tone: 'warning'
    }))?.trim();
    if (!reason) return;

    setBusy(true);
    setNotice('');
    try {
      await systemSettingHistoryClient.restore(token, selected, id, reason);
      await load(selected);
      onRestored();
      setNotice('Restore สำเร็จและบันทึก Audit ใหม่แล้ว');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Restore ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return <>
    <section className="configuration-history-card">
      <div>
        <p className="eyebrow">CFG-11 · IMMUTABLE HISTORY</p>
        <h2>Configuration Change History</h2>
        <p>ดู Before → After จาก Audit และ Restore เฉพาะค่าที่ไม่ใช่ secret โดยการ Restore จะสร้างการเปลี่ยนแปลงใหม่ ไม่แก้ไขประวัติเดิม</p>
      </div>
      <label className="field-group">
        <span>Setting</span>
        <select value={selected} onChange={(event) => void load(event.target.value)}>
          <option value="">เลือกการตั้งค่า</option>
          {registered.map((item) => <option key={String(item.key)} value={String(item.key)}>{String(item.label || item.key)}</option>)}
        </select>
      </label>
      {busy && <div className="loading-row">กำลังอ่านประวัติ…</div>}
      {notice && <div className="settings-notice">{notice}</div>}
      {data && <div className="configuration-history-list">
        {data.history.length ? data.history.map((row) => <article key={row.id} className="configuration-history-item">
          <div>
            <strong>{new Date(row.createdAt).toLocaleString('th-TH')}</strong>
            <small>{row.actor?.displayName || 'System'} · {row.event || row.action}</small>
          </div>
          <div className="configuration-history-values">
            <span><b>Before</b><code>{row.beforeValue ?? 'ไม่ถูกบันทึกใน Audit รุ่นเดิม'}</code></span>
            <span><b>After</b><code>{row.afterValue ?? 'ไม่ถูกบันทึกใน Audit รุ่นเดิม'}</code></span>
          </div>
          {row.reason && <p>เหตุผล: {row.reason}</p>}
          <button
            className="btn-neutral small-action"
            disabled={busy || !row.restorable}
            title={row.restorable ? 'Restore เป็นค่าหลังการเปลี่ยนแปลงรายการนี้' : 'ประวัติรายการนี้ไม่มีค่าที่ Restore ได้'}
            onClick={() => void restore(row.id)}
          >
            Restore ค่านี้
          </button>
        </article>) : <div className="no-rows">ยังไม่มีประวัติการเปลี่ยนค่านี้</div>}
      </div>}
    </section>
    {actionDialog.dialog}
  </>;
}
