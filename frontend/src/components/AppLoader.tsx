import './app-loader.css';

export const loadingMessages = {
  session: 'กำลังเตรียมระบบ…',
  offlineCheck: 'กำลังตรวจสิทธิ์ออฟไลน์…',
  offlineOpen: 'กำลังเปิดระบบลงเวลาออฟไลน์…',
  readOnly: 'กำลังเตรียมโหมดตรวจสอบอย่างเดียว…',
  page: 'กำลังโหลดหน้า…'
};

export function AppLoader({ variant = 'fullscreen', message }: { variant?: 'fullscreen' | 'content'; message: string }) {
  return <div className={`sms-loader sms-loader--${variant}`} role="status" aria-live="polite">
    <div className="sms-loader__brand">
      <img className="sms-loader__light" src="/brand/sms-logo.webp" alt="SMS Security Management System" />
      <img className="sms-loader__dark" src="/brand/sms-logo-dark.webp" alt="SMS Security Management System" />
    </div>
    <p>{message}</p><span className="sms-loader__progress" aria-hidden="true" />
  </div>;
}
