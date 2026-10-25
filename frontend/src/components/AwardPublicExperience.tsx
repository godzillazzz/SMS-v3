import { type ReactNode } from 'react';
import { ThailandMap } from './ThailandMap';

type AwardPublicExperienceProps = {
  showLanding: boolean;
  renderLogo: () => ReactNode;
  accessContent?: ReactNode;
  onRequestRegister?(): void;
};

/* True, static facts about the system — no simulated telemetry (D-U5). */
const FACTS = [
  { value: '4', unit: 'ระดับ', label: 'สิทธิ์ตามบทบาท', meta: 'ผู้ดูแลระบบถึงพนักงาน' },
  { value: 'PWA', unit: '', label: 'ลงเวลาบนมือถือ', meta: 'บันทึกได้แม้ออฟไลน์' },
  { value: 'FIDO2', unit: '', label: 'เข้าสู่ระบบด้วย Passkey', meta: 'หรือกุญแจความปลอดภัย' }
];

/**
 * Public landing + login on one screen (Command Nexus style).
 * The login card (accessContent) sits beside the hero so nobody has to scroll to sign in.
 */
export function AwardPublicExperience({ showLanding, renderLogo, accessContent, onRequestRegister }: AwardPublicExperienceProps) {
  if (!showLanding) return null;

  return (
    <div className="nexus-public nexus-onescreen" data-design="sms-command-nexus-one-screen">
      <div className="nexus-grid-field" aria-hidden="true" />
      <div className="nexus-ambient nexus-ambient--north" aria-hidden="true" />
      <div className="nexus-ambient nexus-ambient--east" aria-hidden="true" />

      <header className="nexus-nav">
        <div className="nexus-shell nexus-nav__inner">
          <span className="nexus-brand" aria-label="SMS Security Management System">
            {renderLogo()}
          </span>
          {onRequestRegister && (
            <button type="button" className="nexus-onescreen__register" onClick={onRequestRegister}>ส่งคำขอลงทะเบียน</button>
          )}
        </div>
      </header>

      <div className="nexus-onescreen__main">
        <div className="nexus-hero__rail nexus-hero__rail--left" aria-hidden="true"><span>SMS / SECURITY OPERATIONS</span><b>04</b></div>
        <div className="nexus-hero__rail nexus-hero__rail--right" aria-hidden="true"><span>TH · UTC+7</span><b>BKK</b></div>
        <div className="nexus-shell nexus-onescreen__grid">
          <section className="nexus-hero__copy nexus-onescreen__copy" id="overview">
            <div className="nexus-hero__eyebrow"><i aria-hidden="true" /><span lang="en">SECURITY MANAGEMENT SYSTEM</span><em>ระบบบริหารงานรักษาความปลอดภัย</em></div>
            <h1>เห็นภาพรวมทุกงาน<span>มั่นใจในทุกการปฏิบัติ</span></h1>
            <p>ศูนย์บัญชาการงานรักษาความปลอดภัยที่รวมกำลังพล ตารางกะ จุดปฏิบัติงาน การลงเวลา การอนุมัติ และสิทธิ์การใช้งานไว้ในที่เดียว เห็นสถานะสำคัญได้ทันทีโดยไม่ลดทอนความปลอดภัยของข้อมูลจริง</p>
            <ul className="nexus-micro-metrics nexus-onescreen__facts" aria-label="ความสามารถหลักของระบบ">
              {FACTS.map((fact) => (
                <li key={fact.value} className="nexus-micro-metric">
                  <div><strong>{fact.value}</strong>{fact.unit && <span>{fact.unit}</span>}</div>
                  <small>{fact.label}</small>
                  <em>{fact.meta}</em>
                </li>
              ))}
            </ul>
          </section>

          <div className="nexus-onescreen__map">
            <ThailandMap />
          </div>

          {accessContent && <div className="nexus-public__access nexus-onescreen__access">{accessContent}</div>}
        </div>
      </div>

      <div className="nexus-hero__bottom-line nexus-onescreen__bottom" aria-hidden="true">
        <span>SMS COMMAND NEXUS</span><i /><span lang="th">ระบบบริหารงานรักษาความปลอดภัย</span><i /><span>Secure operations, designed for clarity.</span>
      </div>
    </div>
  );
}
