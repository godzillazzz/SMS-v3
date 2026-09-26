import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CyberGlobe } from './CyberGlobe';

type AwardPublicExperienceProps = { showLanding: boolean; renderLogo: () => ReactNode };

type PublicTelemetry = {
  bkk: number;
  tyo: number;
  sin: number;
  lon: number;
  satellites: number;
  personnel: number;
  personnelTotal: number;
  checkpoints: number;
  approvals: number;
  geofence: number;
  uptime: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const drift = (value: number, min: number, max: number, delta = 1) => clamp(value + Math.floor(Math.random() * (delta * 2 + 1)) - delta, min, max);

const initialTelemetry: PublicTelemetry = {
  bkk: 1.1,
  tyo: 3.4,
  sin: 2.1,
  lon: 18.6,
  satellites: 24,
  personnel: 1428,
  personnelTotal: 1450,
  checkpoints: 48,
  approvals: 12,
  geofence: 0.3,
  uptime: 99.999
};

export function AwardPublicExperience({ showLanding, renderLogo }: AwardPublicExperienceProps) {
  const [live, setLive] = useState<PublicTelemetry>(initialTelemetry);

  useEffect(() => {
    if (!showLanding) return;
    const timer = window.setInterval(() => {
      setLive((value) => ({
        ...value,
        bkk: Number(clamp(value.bkk + (Math.random() - 0.5) * 0.12, 0.8, 1.8).toFixed(1)),
        tyo: Number(clamp(value.tyo + (Math.random() - 0.5) * 0.2, 2.8, 4.2).toFixed(1)),
        sin: Number(clamp(value.sin + (Math.random() - 0.5) * 0.16, 1.6, 2.9).toFixed(1)),
        lon: Number(clamp(value.lon + (Math.random() - 0.5) * 0.35, 16.4, 21.2).toFixed(1)),
        satellites: drift(value.satellites, 22, 26),
        personnel: drift(value.personnel, 1418, 1436, 3),
        checkpoints: drift(value.checkpoints, 46, 50),
        approvals: drift(value.approvals, 8, 14),
        geofence: Number(clamp(value.geofence + (Math.random() - 0.5) * 0.04, 0.2, 0.5).toFixed(1))
      }));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [showLanding]);

  const personnelPct = useMemo(
    () => Number(((live.personnel / live.personnelTotal) * 100).toFixed(2)),
    [live.personnel, live.personnelTotal]
  );

  if (!showLanding) return null;

  return (
    <div className="nexus-public" data-design="sms-command-nexus-v4.8-full-bleed">
      <div className="nexus-grid-field" aria-hidden="true" />
      <div className="nexus-ambient nexus-ambient--north" aria-hidden="true" />
      <div className="nexus-ambient nexus-ambient--east" aria-hidden="true" />

      <section className="nexus-mesh-strip" aria-label="ข้อมูล telemetry จำลองสำหรับหน้า public">
        <div className="nexus-shell nexus-mesh-strip__inner">
          <div className="nexus-mesh-strip__cluster">
            <span className="nexus-live-dot"><i />GLOBAL MESH: SYNCHRONIZED</span>
            <span className="nexus-mesh-divider">/</span>
            <span>SLA {live.uptime.toFixed(3)}%</span>
            <span className="nexus-mesh-divider">/</span>
            <span>{live.satellites} SAT-LINKS ACTIVE</span>
            <span className="nexus-mesh-divider">/</span>
            <span className="is-positive">BKK &lt;{live.bkk.toFixed(1)}ms</span>
            <span className="nexus-mesh-divider">/</span>
            <span>TYO &lt;{live.tyo.toFixed(1)}ms</span>
            <span className="nexus-mesh-divider">/</span>
            <span>SIN &lt;{live.sin.toFixed(1)}ms</span>
          </div>
          <div className="nexus-mesh-strip__status"><span>PUBLIC DEMO FEED</span><b>NODE MATRIX 01</b></div>
        </div>
      </section>

      <header className="nexus-nav">
        <div className="nexus-shell nexus-nav__inner">
          <a className="nexus-brand" href="#overview" aria-label="SMS Security Management System">
            <span className="nexus-brand__mark">{renderLogo()}</span>
            <span className="nexus-brand__copy"><strong>SMS <em>v4.8</em></strong><small>ระบบบริหารงานรักษาความปลอดภัย</small></span>
          </a>
          <nav className="nexus-nav__links" aria-label="เมนูหน้า public">
            <a className="is-active" href="#overview">ภาพรวมระบบ</a>
            <a href="#operations">Command Telemetry</a>
            <a href="#access">Identity Hub</a>
          </nav>
          <a className="nexus-command-button" href="#auth-login-form"><span>เข้าสู่ระบบ</span><i aria-hidden="true">↗</i></a>
        </div>
      </header>

      <main>
        <section className="nexus-hero" id="overview">
          <div className="nexus-hero__rail nexus-hero__rail--left" aria-hidden="true"><span>SMS / SECURITY OPERATIONS</span><b>04</b></div>
          <div className="nexus-hero__rail nexus-hero__rail--right" aria-hidden="true"><span>ZERO TRUST / ACTIVE</span><b>TH-BKK</b></div>
          <div className="nexus-shell nexus-hero__grid">
            <div className="nexus-hero__copy">
              <div className="nexus-hero__eyebrow"><i />DEFENSE MATRIX VER 4.8.19 <span>ENCRYPTED / ZERO-TRUST ACTIVE</span></div>
              <div className="nexus-simulated-pill"><b>SIMULATED LIVE DATA</b><span>ข้อมูลจำลองสำหรับหน้า Public — ไม่ใช่ข้อมูลปฏิบัติการจริง</span></div>
              <h1>เห็นภาพรวมทุกงาน<span>มั่นใจในทุกการปฏิบัติ</span></h1>
              <p>ศูนย์บัญชาการงานรักษาความปลอดภัยระดับองค์กรที่รวมกำลังพล ตารางกะ จุดตรวจ การลงเวลา การอนุมัติ และการกำกับสิทธิ์ไว้ในประสบการณ์เดียว — ออกแบบให้เห็นสถานะสำคัญได้ทันทีโดยไม่ลดทอนความปลอดภัยของข้อมูลจริง</p>
              <div className="nexus-hero__actions">
                <a className="nexus-hero__primary" href="#auth-login-form">เข้าสู่ระบบศูนย์บัญชาการ <span aria-hidden="true">→</span></a>
                <a className="nexus-hero__secondary" href="#operations"><i aria-hidden="true">⌁</i> สำรวจ Command Surface</a>
              </div>
              <div className="nexus-micro-metrics" aria-label="ตัวชี้วัดจำลอง">
                <Metric value={`< ${live.bkk.toFixed(1)}`} unit="ms" label="LATENCY SYNC" meta="SIMULATED" />
                <Metric value={live.uptime.toFixed(3)} unit="%" label="SYSTEM UPTIME" meta="DEMO SLA" />
                <Metric value="256" unit="-BIT" label="ENCRYPTION" meta="SECURE CHANNEL" />
              </div>
            </div>

            <CyberGlobe
              bkkLatency={live.bkk}
              tyoLatency={live.tyo}
              sinLatency={live.sin}
              lonLatency={live.lon}
              satelliteCount={live.satellites}
            />
          </div>
          <div className="nexus-hero__bottom-line" aria-hidden="true"><span>COMMAND NEXUS</span><i /><span>MISSION-CRITICAL INTERFACE</span><i /><span>PUBLIC SURFACE / SIMULATION</span></div>
        </section>

        <section id="operations" className="nexus-telemetry-section">
          <div className="nexus-shell">
            <div className="nexus-section-heading">
              <div><span className="nexus-section-kicker"><i />LIVE TELEMETRY / PUBLIC SIMULATION</span><h2>สถานะระบบในภาษาของศูนย์บัญชาการ</h2></div>
              <p>ตัวเลขด้านล่างถูกจำลองเพื่อสื่อสารประสบการณ์ของผลิตภัณฑ์บนหน้า Public เท่านั้น ข้อมูลหลังเข้าสู่ระบบจึงค่อยใช้ข้อมูลจริงตามสิทธิ์ของผู้ใช้</p>
            </div>

            <div className="nexus-command-deck">
              <Kpi
                featured
                index="01"
                title="PERSONNEL ON DUTY"
                thai="กำลังพลปฏิบัติหน้าที่"
                badge={`SIM ${personnelPct.toFixed(2)}%`}
                badgeTone="emerald"
                value={live.personnel.toLocaleString()}
                suffix={`/ ${live.personnelTotal.toLocaleString()} นาย`}
                progress={personnelPct}
                foot="DAY / NIGHT DISTRIBUTION · PUBLIC DEMO"
              />
              <Kpi
                index="02"
                title="CRITICAL SURVEILLANCE"
                thai="จุดตรวจภารกิจ"
                badge="SIMULATED"
                value={String(live.checkpoints)}
                suffix="จุด"
                foot="RFID / NFC / GEOFENCE · DISPLAY ONLY"
              />
              <Kpi
                index="03"
                title="APPROVAL PROTOCOL"
                thai="คิวอนุมัติจำลอง"
                badge="DEMO QUEUE"
                badgeTone="indigo"
                value={String(live.approvals)}
                suffix="รายการ"
                foot="ROLE-GOVERNED FLOW · NO PUBLIC RECORDS"
              />
              <Kpi
                index="04"
                title="GEO-FENCE ACCURACY"
                thai="ความแม่นยำตำแหน่งจำลอง"
                badge="RTK MODEL"
                value={`±${live.geofence.toFixed(1)}`}
                suffix="เมตร"
                foot="BEIDOU / GPS / GALILEO · SIMULATION"
                accent
              />
            </div>

            <div className="nexus-signal-console" aria-label="สัญญาณ telemetry จำลอง">
              <div className="nexus-signal-console__head"><span>PUBLIC SIGNAL STREAM / 24H</span><b><i /> AUTO-SYNTH ACTIVE</b></div>
              <div className="nexus-signal-console__chart" aria-hidden="true">
                <svg viewBox="0 0 1200 180" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="signalArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#25b8d3" stopOpacity=".28"/><stop offset="1" stopColor="#25b8d3" stopOpacity="0"/></linearGradient>
                  </defs>
                  <g className="nexus-chart-grid"><path d="M0 36H1200M0 72H1200M0 108H1200M0 144H1200"/><path d="M120 0V180M240 0V180M360 0V180M480 0V180M600 0V180M720 0V180M840 0V180M960 0V180M1080 0V180"/></g>
                  <path className="nexus-chart-area" d="M0 142 C70 112 112 126 168 109 S260 89 320 106 S430 132 500 91 S610 56 676 77 S772 118 844 86 S955 52 1030 69 S1120 60 1200 38 L1200 180 L0 180Z" />
                  <path className="nexus-chart-line" d="M0 142 C70 112 112 126 168 109 S260 89 320 106 S430 132 500 91 S610 56 676 77 S772 118 844 86 S955 52 1030 69 S1120 60 1200 38" />
                </svg>
              </div>
              <div className="nexus-signal-console__legend"><span><i />SIMULATED EVENT FLOW</span><span>NO OPERATIONAL DATA EXPOSED</span><span>REFRESH / 5 SEC</span></div>
            </div>
          </div>
        </section>

        <section className="nexus-auth-transition" aria-label="ไปยังหน้าล็อกอิน">
          <div className="nexus-shell nexus-auth-transition__inner">
            <div><span>SECURE SURFACE / AUTHENTICATED ONLY</span><h2>ข้อมูลจริงเริ่มหลังการยืนยันตัวตน</h2></div>
            <a href="#auth-login-form">เข้าสู่ Zero-Trust Login Console <b aria-hidden="true">→</b></a>
          </div>
        </section>
      </main>
    </div>
  );
}

function Metric({ value, unit, label, meta }: { value: string; unit: string; label: string; meta: string }) {
  return <div className="nexus-micro-metric"><div><strong>{value}</strong><span>{unit}</span></div><small>{label}</small><em>{meta}</em></div>;
}

function Kpi({
  index,
  title,
  thai,
  badge,
  badgeTone = 'cyan',
  value,
  suffix,
  progress,
  foot,
  accent = false,
  featured = false
}: {
  index: string;
  title: string;
  thai: string;
  badge: string;
  badgeTone?: 'cyan' | 'emerald' | 'indigo';
  value: string;
  suffix: string;
  progress?: number;
  foot: string;
  accent?: boolean;
  featured?: boolean;
}) {
  return (
    <article className={`nexus-kpi ${featured ? 'is-featured' : ''} ${accent ? 'is-accent' : ''}`}>
      <div className="nexus-kpi__index">{index}</div>
      <div className="nexus-kpi__top"><span>{title}</span><b className={`tone-${badgeTone}`}>{badge}</b></div>
      <h3>{thai}</h3>
      <div className="nexus-kpi__value"><strong>{value}</strong><span>{suffix}</span></div>
      {progress !== undefined && <div className="nexus-kpi__progress"><i style={{ width: `${progress}%` }} /></div>}
      <div className="nexus-kpi__foot">{foot}</div>
    </article>
  );
}
