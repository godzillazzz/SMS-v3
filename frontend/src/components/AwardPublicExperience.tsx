import type { ReactNode } from 'react';
import { SmsIcon } from './SmsIcon';

type AwardPublicExperienceProps = {
  showLanding: boolean;
  renderLogo: () => ReactNode;
};

export function AwardPublicExperience({ showLanding, renderLogo }: AwardPublicExperienceProps) {
  return (
    <>
      <div className="award-atmosphere" aria-hidden="true"><i /><i /><i /><span /></div>
      <header className="award-public-nav">
        <div className="award-public-brand">{renderLogo()}<span><b>SMS</b><small>SECURITY OPERATIONS</small></span></div>
        <nav><a href="#award-capabilities">Capabilities</a><a href="#award-trust">Trust</a><a href="#auth-login-form" className="award-nav-cta">เข้าสู่ระบบ</a></nav>
      </header>
      {showLanding && <section className="award-hero">
        <div className="award-hero-copy">
          <p className="award-kicker"><span /> SECURITY INTELLIGENCE · UNIFIED OPERATIONS</p>
          <h1>See the operation.<br /><em>Secure the moment.</em></h1>
          <p className="award-hero-lead">ศูนย์กลางการบริหารงานรักษาความปลอดภัยที่เชื่อมบุคลากร ตารางปฏิบัติงาน การลงเวลา การอนุมัติ และข้อมูลเชิงปฏิบัติการไว้ในประสบการณ์เดียว</p>
          <div className="award-hero-actions"><a className="award-primary" href="#auth-login-form">เข้าสู่ระบบ <span>↗</span></a><a className="award-secondary" href="#award-capabilities">สำรวจแพลตฟอร์ม</a></div>
          <div className="award-trustline" id="award-trust"><span><b>01</b> Role-based access</span><span><b>02</b> Operational visibility</span><span><b>03</b> Audit-ready workflow</span></div>
        </div>
        <div className="award-command-visual" aria-hidden="true">
          <div className="award-orbit award-orbit-a" /><div className="award-orbit award-orbit-b" />
          <div className="award-radar"><div className="award-radar-grid" /><div className="award-radar-sweep" /><span className="award-node n1" /><span className="award-node n2" /><span className="award-node n3" /><span className="award-node n4" /><div className="award-core">{renderLogo()}<b>SMS</b><small>LIVE OPERATIONS</small></div></div>
          <div className="award-float-card award-float-card-a"><span className="award-live-dot" /><div><small>OPERATION STATUS</small><b>Protected & connected</b></div></div>
          <div className="award-float-card award-float-card-b"><small>WORKFORCE</small><b>Unified command</b><span>Personnel · Schedule · Attendance</span></div>
        </div>
      </section>}
      {showLanding && <section className="award-capabilities" id="award-capabilities">
        <article><span>01</span><SmsIcon name="employees" size={22} /><h2>People</h2><p>บริหารข้อมูลบุคลากรและสิทธิ์อย่างเป็นระบบ</p></article>
        <article><span>02</span><SmsIcon name="calendar" size={22} /><h2>Operations</h2><p>วางตารางกะ ลงเวลา และติดตามงานใน flow เดียว</p></article>
        <article><span>03</span><SmsIcon name="approval" size={22} /><h2>Decisions</h2><p>รวม approval workflow และสถานะที่ต้องจัดการ</p></article>
        <article><span>04</span><SmsIcon name="shield" size={22} /><h2>Assurance</h2><p>สิทธิ์ การตรวจสอบ และหลักฐานพร้อมสำหรับการกำกับดูแล</p></article>
      </section>}
    </>
  );
}
