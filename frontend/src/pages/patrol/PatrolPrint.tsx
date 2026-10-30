import { coverageCellTone, summarizeByDepartment, thaiDate, thaiTime, type PatrolCheckpoint, type PatrolReport } from './patrol-model';

export type PatrolPrintKind = 'daily' | 'department' | 'all';

const TITLES: Record<PatrolPrintKind, [string, string]> = {
  daily: ['รายงานการตรวจจุดประจำวัน', 'DAILY PATROL REPORT'],
  department: ['รายงานการตรวจจุดรายแผนก', 'DEPARTMENT PATROL REPORT'],
  all: ['รายงานการตรวจจุดทุกแผนก', 'ALL DEPARTMENTS PATROL REPORT']
};

function Letterhead({ kind, report }: { kind: PatrolPrintKind; report: PatrolReport }) {
  const [thai, english] = TITLES[kind];
  const period = report.from === report.to ? thaiDate(report.from, { day: 'numeric', month: 'long', year: 'numeric' }) : `${thaiDate(report.from)} – ${thaiDate(report.to)}`;
  return <>
    <header className="leave-print-header-redesign patrol-print-header">
      <div className="leave-print-brand-left">
        <div className="leave-print-brand-square">SMS</div>
        <div className="leave-print-company-details"><strong>Security Management System</strong><small>ระบบบริหารงานรักษาความปลอดภัย</small></div>
      </div>
      <div className="leave-print-doc-meta">
        <h1 className="leave-print-main-title">{thai}</h1>
        <div className="leave-print-en-title">{english}</div>
        <div className="leave-print-doc-no">{period}</div>
      </div>
    </header>
    <div className="leave-print-divider"><div className="leave-print-divider-accent" /></div>
    <p className="patrol-print-filter">แผนก: {report.department || 'ทุกแผนก'} · พิมพ์เมื่อ {thaiDate(report.generatedAt.slice(0, 10))} {thaiTime(report.generatedAt)} น.</p>
  </>;
}

function SummaryCards({ report }: { report: PatrolReport }) {
  const { summary } = report.coverage;
  const cards: Array<[string, string | number]> = [['จุดตรวจ', summary.checkpoints], ['ตรวจแล้ว', summary.scanned], ['ยังไม่ตรวจ', summary.pending], ['จำนวนสแกน', summary.scans], ['ครอบคลุม', `${summary.percent}%`]];
  return <section className="patrol-print-cards">{cards.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>;
}

function Signatures() {
  return <div className="patrol-print-signatures">
    <div><span>ลงชื่อ ......................................................... ผู้จัดทำ</span><small>( ......................................................... )</small><small>วันที่ ........../........../..........</small></div>
    <div><span>ลงชื่อ ......................................................... ผู้ตรวจสอบ</span><small>( ......................................................... )</small><small>วันที่ ........../........../..........</small></div>
  </div>;
}

function ScanTable({ report }: { report: PatrolReport }) {
  return <table className="patrol-print-table">
    <thead><tr><th>ลำดับ</th><th>เวลา</th><th>วันที่</th><th>แผนกจุด</th><th>รหัสจุด</th><th>ชื่อจุดตรวจ</th><th>ผู้ตรวจ</th><th>แผนกผู้ตรวจ</th><th>หมายเหตุ</th></tr></thead>
    <tbody>{report.scans.length === 0 ? <tr><td colSpan={9} className="patrol-print-empty">ไม่มีการสแกนในช่วงที่เลือก</td></tr> : report.scans.map((scan, index) => <tr key={scan.id}>
      <td>{index + 1}</td><td>{thaiTime(scan.scannedAt)}</td><td>{thaiDate(scan.workDate, { day: 'numeric', month: 'short' })}</td><td>{scan.checkpointDepartment}</td><td>{scan.checkpointCode || '—'}</td><td>{scan.checkpointName || '—'}</td>
      <td>{scan.employeeName || '—'}{scan.employeeCode ? ` (${scan.employeeCode})` : ''}</td><td>{scan.employeeDepartment || '—'}</td><td>{scan.note || '—'}</td>
    </tr>)}</tbody>
  </table>;
}

function DailyCheckpointTable({ report, today }: { report: PatrolReport; today: string }) {
  const day = report.to;
  return <table className="patrol-print-table">
    <thead><tr><th>ลำดับ</th><th>แผนก</th><th>รหัสจุด</th><th>ชื่อจุดตรวจ</th><th>สถานะ</th><th>จำนวนครั้ง</th><th>ตรวจล่าสุด</th><th>ผู้ตรวจล่าสุด</th></tr></thead>
    <tbody>{report.coverage.departments.flatMap((group) => group.checkpoints.map((item) => ({ group, item }))).map(({ group, item }, index) => {
      const cell = item.days[day];
      const tone = coverageCellTone(cell, day, today);
      return <tr key={item.id}>
        <td>{index + 1}</td><td>{group.department}</td><td>{item.code}</td><td>{item.name}</td>
        <td><span className={`patrol-print-status patrol-print-status--${tone}`}>{tone === 'done' ? 'ตรวจแล้ว' : tone === 'pending' ? 'รอตรวจ' : 'ไม่ได้ตรวจ'}</span></td>
        <td>{cell?.count || 0}</td><td>{cell?.lastScanAt ? `${thaiTime(cell.lastScanAt)} น.` : '—'}</td><td>{cell?.lastEmployeeName || '—'}</td>
      </tr>;
    })}</tbody>
  </table>;
}

function CoverageMatrix({ report, today }: { report: PatrolReport; today: string }) {
  const dates = report.coverage.dates;
  return <table className="patrol-print-table patrol-print-matrix">
    <thead><tr><th>จุดตรวจ</th>{dates.map((day) => <th key={day}>{Number(day.slice(8))}</th>)}<th>รวม</th></tr></thead>
    {report.coverage.departments.map((group) => <tbody key={group.department}>
      <tr className="patrol-print-group"><td colSpan={dates.length + 2}>{group.department} — ตรวจแล้ว {group.scanned}/{group.total}</td></tr>
      {group.checkpoints.map((item) => <tr key={item.id}>
        <td className="patrol-print-matrix__name">{item.code} {item.name}</td>
        {dates.map((day) => { const tone = coverageCellTone(item.days[day], day, today); return <td key={day} className={`patrol-print-cell--${tone}`}>{tone === 'done' ? (item.days[day].count > 1 ? item.days[day].count : '✓') : tone === 'future' ? '' : tone === 'pending' ? '•' : '✕'}</td>; })}
        <td>{item.scannedDays}/{dates.length}</td>
      </tr>)}
    </tbody>)}
  </table>;
}

export function PatrolReportPrint({ kind, report, today }: { kind: PatrolPrintKind; report: PatrolReport; today: string }) {
  const departments = summarizeByDepartment(report.coverage.departments);
  return <article className={`print-only patrol-report-print patrol-report-print--${kind}`} aria-hidden="true">
    <Letterhead kind={kind} report={report} />
    <SummaryCards report={report} />
    {kind === 'daily' && <>
      <h2 className="patrol-print-h2">สถานะจุดตรวจ</h2>
      <DailyCheckpointTable report={report} today={today} />
      <h2 className="patrol-print-h2">รายการสแกนตามเวลา</h2>
      <ScanTable report={report} />
    </>}
    {kind !== 'daily' && <>
      {kind === 'all' && <table className="patrol-print-table patrol-print-dept">
        <thead><tr><th>แผนก</th><th>จุด-วันทั้งหมด</th><th>ตรวจแล้ว</th><th>ยังไม่ตรวจ</th><th>ครอบคลุม</th></tr></thead>
        <tbody>{departments.map((item) => <tr key={item.department}><td>{item.department}</td><td>{item.total}</td><td>{item.scanned}</td><td>{item.pending}</td><td>{item.percent}%</td></tr>)}</tbody>
      </table>}
      <h2 className="patrol-print-h2">ตารางสถานะการตรวจ</h2>
      <CoverageMatrix report={report} today={today} />
      <h2 className="patrol-print-h2 patrol-print-break">รายการสแกน</h2>
      <ScanTable report={report} />
    </>}
    <Signatures />
  </article>;
}

export function PatrolCheckpointQrSheet({ items }: { items: Array<PatrolCheckpoint & { dataUrl: string }> }) {
  return <section className="print-only patrol-qr-sheet" aria-hidden="true">
    {items.map((item) => <article className="patrol-qr-card" key={item.id}>
      <header><span className="patrol-qr-card__brand">SMS</span><div><strong>จุดตรวจ · PATROL CHECKPOINT</strong><small>Security Management System</small></div></header>
      <img src={item.dataUrl} alt={`QR ${item.code}`} width={512} height={512} />
      <h2>{item.code}</h2>
      <p className="patrol-qr-card__name">{item.name}</p>
      <p className="patrol-qr-card__meta">แผนก {item.department}{item.locationNote ? ` · ${item.locationNote}` : ''}</p>
      <footer>สแกนด้วยเมนู “สแกนจุดตรวจ” ในแอป SMS แล้วถ่ายรูปจุดตรวจ · QR v{item.qrVersion}</footer>
    </article>)}
  </section>;
}
