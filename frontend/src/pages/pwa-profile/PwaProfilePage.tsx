import { SmsIcon } from '../../components/SmsIcon';

export type PwaProfileUser = {
  displayName?: string;
  email?: string;
  role?: string;
  department?: string;
};

type Props = {
  user?: PwaProfileUser;
  online: boolean;
  readOnly?: boolean;
  onOpenPasskeys: () => void;
  onLogout: () => void;
};

function initials(name?: string) {
  return (name || 'SMS').split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'SM';
}

export function PwaProfilePage({ user, online, readOnly = false, onOpenPasskeys, onLogout }: Props) {
  return <section className="pwa-profile-page" aria-label="โปรไฟล์">
    <header className="pwa-profile-hero">
      <span className="pwa-profile-avatar">{initials(user?.displayName)}</span>
      <div><p>SMS EMPLOYEE</p><h1>{user?.displayName || 'ผู้ใช้งาน'}</h1><span>{user?.role || 'VIEWER'}</span></div>
    </header>

    {readOnly && <div className="settings-notice">กำลังอยู่ใน View As — การเปลี่ยนข้อมูลความปลอดภัยและการทำรายการถูกจำกัด</div>}

    <section className="pwa-profile-card">
      <h2>ข้อมูลบัญชี</h2>
      <dl>
        <div><dt>อีเมล</dt><dd>{user?.email || '-'}</dd></div>
        <div><dt>Role</dt><dd>{user?.role || 'VIEWER'}</dd></div>
        <div><dt>หน่วยงาน</dt><dd>{user?.department || '-'}</dd></div>
        <div><dt>การเชื่อมต่อ</dt><dd className={online ? 'is-online' : 'is-offline'}>{online ? 'ออนไลน์' : 'ออฟไลน์'}</dd></div>
      </dl>
    </section>

    <section className="pwa-profile-card">
      <h2>ความปลอดภัย</h2>
      <p>จัดการ Passkey และวิธีเข้าสู่ระบบของบัญชีนี้ โดยไม่เปลี่ยน Attendance device authority</p>
      <button type="button" className="btn-neutral pwa-profile-action" disabled={readOnly} onClick={onOpenPasskeys}><SmsIcon name="key" size={18} />การเข้าสู่ระบบและ Passkey</button>
    </section>

    <section className="pwa-profile-card pwa-profile-session">
      <div><h2>Session</h2><p>ออกจากระบบบนอุปกรณ์นี้เมื่อใช้งานเสร็จ</p></div>
      <button type="button" className="btn-danger-outline pwa-profile-action" onClick={onLogout}><SmsIcon name="logout" size={18} />ออกจากระบบ</button>
    </section>
  </section>;
}
