import { useEffect, useRef, useState } from 'react';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { api } from '../api';
import { SmsIcon } from './SmsIcon';

type PasskeyRecord = {
  id: string;
  displayName: string;
  createdAt: string;
  lastUsedAt?: string | null;
  deviceType?: string | null;
  backedUp?: boolean;
};

type Props = { token: string; onClose(): void };

const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(value)) : 'ยังไม่เคยใช้';

export function PasskeySecurityPanel({ token, onClose }: Props) {
  const [rows, setRows] = useState<PasskeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [displayName, setDisplayName] = useState('อุปกรณ์ของฉัน');
  const [currentPassword, setCurrentPassword] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<PasskeyRecord>();
  const [revokePassword, setRevokePassword] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = async () => {
    setLoading(true);
    setError(undefined);
    try { setRows((await api.passkeys(token)).data || []); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'ไม่สามารถโหลด Passkey ได้'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const enroll = async () => {
    setError(undefined); setMessage(undefined);
    if (!browserSupportsWebAuthn()) { setError('เบราว์เซอร์หรืออุปกรณ์นี้ยังไม่รองรับ Passkey'); return; }
    setBusy(true);
    try {
      const challenge = await api.passkeyRegistrationOptions(token, currentPassword, displayName);
      const response = await startRegistration({ optionsJSON: challenge.options });
      await api.passkeyRegistrationVerify(token, challenge.challengeId, response, challenge.displayName || displayName);
      setCurrentPassword('');
      setMessage('เพิ่ม Passkey สำเร็จ อุปกรณ์จะเป็นผู้ยืนยัน Face ID, ลายนิ้วมือ, Windows Hello หรือ PIN ตามที่รองรับ');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'เพิ่ม Passkey ไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const rename = async (row: PasskeyRecord) => {
    const name = window.prompt('ตั้งชื่อ Passkey', row.displayName)?.trim();
    if (!name || name === row.displayName) return;
    setBusy(true); setError(undefined); setMessage(undefined);
    try { await api.renamePasskey(token, row.id, name); setMessage('เปลี่ยนชื่อ Passkey แล้ว'); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'เปลี่ยนชื่อ Passkey ไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const revoke = async () => {
    if (!revokeTarget) return;
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      await api.revokePasskey(token, revokeTarget.id, revokePassword);
      setMessage(`ยกเลิก ${revokeTarget.displayName} แล้ว`);
      setRevokeTarget(undefined); setRevokePassword('');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'ยกเลิก Passkey ไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  return <div className="passkey-panel-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <aside className="passkey-panel operational-drawer" role="dialog" aria-modal="true" aria-labelledby="passkey-panel-title">
      <header className="passkey-panel__header">
        <div><p>ACCOUNT SECURITY</p><h2 id="passkey-panel-title">การเข้าสู่ระบบและ Passkey</h2><span>จัดการวิธีเข้าสู่ระบบที่ผูกกับบัญชีนี้</span></div>
        <button ref={closeRef} type="button" className="drawer-close overlay-close" onClick={onClose} aria-label="ปิดการตั้งค่า Passkey"><SmsIcon name="close" size={20} /></button>
      </header>
      <div className="passkey-panel__body">
        <section className="passkey-enroll-card">
          <div className="passkey-section-heading"><span><SmsIcon name="key" size={20} /></span><div><h3>เพิ่ม Passkey</h3><p>ใช้ Face ID, ลายนิ้วมือ, Windows Hello หรือการยืนยันตัวตนของอุปกรณ์ โดย SMS ไม่ได้รับข้อมูลชีวมิติ</p></div></div>
          <label>ชื่ออุปกรณ์ / Passkey<input value={displayName} maxLength={120} onChange={(event) => setDisplayName(event.target.value)} placeholder="เช่น iPhone ของฉัน" /></label>
          <label>ยืนยันรหัสผ่านปัจจุบัน<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <button type="button" className="btn-primary passkey-enroll-action" disabled={busy || !currentPassword || !displayName.trim()} onClick={enroll}><SmsIcon name="key" size={18} />{busy ? 'กำลังยืนยัน…' : 'เพิ่ม Passkey'}</button>
          <small className="passkey-privacy-note">Passkey เก็บ private key และข้อมูลชีวมิติไว้กับอุปกรณ์หรือผู้ให้บริการ Passkey เท่านั้น SMS จัดเก็บเฉพาะ public credential ที่ใช้ตรวจลายเซ็น</small>
        </section>
        <section className="passkey-list-section">
          <div className="passkey-section-heading"><span><SmsIcon name="shield" size={20} /></span><div><h3>Passkey ที่ใช้งานอยู่</h3><p>สามารถมีหลายอุปกรณ์และยกเลิกแยกกันได้</p></div></div>
          {loading ? <div className="passkey-state">กำลังโหลด Passkey…</div> : rows.length ? <div className="passkey-list">{rows.map((row) => <article className="passkey-item" key={row.id}>
            <div><strong>{row.displayName}</strong><span>{row.deviceType === 'multiDevice' ? 'Passkey ที่ซิงก์ข้ามอุปกรณ์ได้' : 'Passkey อุปกรณ์'}</span></div>
            <dl><div><dt>เพิ่มเมื่อ</dt><dd>{formatDate(row.createdAt)}</dd></div><div><dt>ใช้ล่าสุด</dt><dd>{formatDate(row.lastUsedAt)}</dd></div></dl>
            <footer><button type="button" className="btn-neutral" disabled={busy} onClick={() => rename(row)}>เปลี่ยนชื่อ</button><button type="button" className="btn-danger-outline" disabled={busy} onClick={() => { setRevokeTarget(row); setRevokePassword(''); }}>ยกเลิก</button></footer>
          </article>)}</div> : <div className="passkey-state passkey-state--empty"><strong>ยังไม่มี Passkey</strong><span>เพิ่ม Passkey เพื่อเข้าสู่ระบบได้เร็วขึ้นโดยยังคงรหัสผ่านเป็นวิธีกู้คืน</span></div>}
        </section>
        {revokeTarget && <section className="passkey-revoke-confirm" role="group" aria-label="ยืนยันยกเลิก Passkey"><h3>ยกเลิก {revokeTarget.displayName}?</h3><p>ยืนยันด้วยรหัสผ่านปัจจุบัน หลังยกเลิก Passkey นี้จะเข้าสู่ระบบไม่ได้อีก</p><input type="password" autoComplete="current-password" value={revokePassword} onChange={(event) => setRevokePassword(event.target.value)} placeholder="รหัสผ่านปัจจุบัน" /><div><button type="button" className="btn-neutral" onClick={() => setRevokeTarget(undefined)}>ยกเลิก</button><button type="button" className="btn-danger" disabled={busy || !revokePassword} onClick={revoke}>ยืนยันยกเลิก Passkey</button></div></section>}
        {message && <div className="settings-notice success" role="status">{message}</div>}
        {error && <div className="alert alert-error" role="alert">{error}</div>}
      </div>
    </aside>
  </div>;
}
