import { PATROL_ROUNDS, buildRoundBoard, patrolRoundWindows, roundsByDay, thaiDate, thaiTime, type PatrolCheckpoint, type PatrolReport } from './patrol-model';

export type PatrolPrintKind = 'daily' | 'department' | 'all';

const TITLES: Record<PatrolPrintKind, [string, string]> = {
  daily: ['รายงานการตรวจจุดประจำวัน', 'DAILY PATROL REPORT'],
  department: ['รายงานการตรวจจุดรายจุดปฏิบัติงาน', 'DEPARTMENT PATROL REPORT'],
  all: ['รายงานการตรวจจุดทุกจุดปฏิบัติงาน', 'ALL DEPARTMENTS PATROL REPORT']
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
    <p className="patrol-print-filter">จุดปฏิบัติงาน: {report.department || 'ทุกจุดปฏิบัติงาน'} · พิมพ์เมื่อ {thaiDate(report.generatedAt.slice(0, 10))} {thaiTime(report.generatedAt)} น.</p>
  </>;
}

type Group = { department: string; checkpoints: Array<{ id: string; code: string; name: string }> };

function groupsOf(report: PatrolReport): Group[] {
  return report.coverage.departments.map((group) => ({ department: group.department, checkpoints: group.checkpoints.map((item) => ({ id: item.id, code: item.code, name: item.name })) }));
}

function rangeDays(report: PatrolReport) { return report.coverage.dates.filter((day) => day >= report.from && day <= report.to); }

function patrolScans(report: PatrolReport) { return report.patrolScans || report.scans; }

function SummaryCards({ report, now }: { report: PatrolReport; now: Date }) {
  const groups = groupsOf(report);
  const all = groups.flatMap((group) => group.checkpoints);
  const days = rangeDays(report);
  let due = 0; let done = 0;
  for (const day of days) {
    const board = buildRoundBoard({ day, now, checkpoints: all, scans: patrolScans(report) });
    due += board.summary.due; done += board.summary.done;
  }
  const cards: Array<[string, string | number]> = [['จุดปฏิบัติงาน', groups.length], ['จุดตรวจ', all.length], ['รอบ-จุดที่ต้องตรวจ', due], ['ตรวจแล้ว', done], ['ขาดตรวจ', Math.max(0, due - done)], ['ความครบถ้วน', `${due ? Math.round((done / due) * 100) : 0}%`]];
  return <section className="patrol-print-cards">{cards.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>;
}

function Signatures() {
  return <div className="patrol-print-signatures">
    <div><span>ลงชื่อ ......................................................... ผู้จัดทำ</span><small>( ......................................................... )</small><small>วันที่ ........../........../..........</small></div>
    <div><span>ลงชื่อ ......................................................... ผู้ตรวจสอบ</span><small>( ......................................................... )</small><small>วันที่ ........../........../..........</small></div>
  </div>;
}

function ScanTable({ report }: { report: PatrolReport }) {
  const scans = patrolScans(report);
  return <table className="patrol-print-table">
    <thead><tr><th>ลำดับ</th><th>วันที่</th><th>เวลา</th><th>จุดปฏิบัติงาน</th><th>รหัสจุด</th><th>ชื่อจุดตรวจ</th><th>ผู้ตรวจ</th><th>จุดปฏิบัติงานผู้ตรวจ</th><th>หมายเหตุ</th></tr></thead>
    <tbody>{scans.length === 0 ? <tr><td colSpan={9} className="patrol-print-empty">ไม่มีการสแกนในช่วงที่เลือก</td></tr> : scans.map((scan, index) => <tr key={scan.id}>
      <td>{index + 1}</td><td>{thaiDate(new Date(Date.parse(scan.scannedAt) + 7 * 3_600_000).toISOString().slice(0, 10), { day: 'numeric', month: 'short' })}</td><td>{thaiTime(scan.scannedAt)}</td><td>{scan.checkpointDepartment}</td><td>{scan.checkpointCode || '—'}</td><td>{scan.checkpointName || '—'}</td>
      <td>{scan.employeeName || '—'}</td><td>{scan.employeeDepartment || '—'}</td><td>{scan.note || '—'}</td>
    </tr>)}</tbody>
  </table>;
}

/** One patrol day: checkpoint x 8 rounds, each cell = scan time or ✕. */
function RoundMatrix({ report, day, now }: { report: PatrolReport; day: string; now: Date }) {
  const windows = patrolRoundWindows(day);
  return <table className="patrol-print-table patrol-print-matrix patrol-print-rounds">
    <thead><tr><th>จุดตรวจ</th>{windows.map((window) => <th key={window.round}>รอบ {window.round}<br /><small>{window.label}</small></th>)}<th>ครบ</th></tr></thead>
    {groupsOf(report).map((group) => {
      const board = buildRoundBoard({ day, now, checkpoints: group.checkpoints, scans: patrolScans(report) });
      return <tbody key={group.department}>
        <tr className="patrol-print-group"><td colSpan={PATROL_ROUNDS + 2}>{group.department} — ตรวจแล้ว {board.summary.done}/{board.summary.due} รอบ-จุด</td></tr>
        {board.rows.map((row) => <tr key={row.id}>
          <td className="patrol-print-matrix__name">{row.code} {row.name}</td>
          {row.cells.map((cell) => <td key={cell.round} className={`patrol-print-cell--${cell.tone === 'done' ? 'done' : cell.tone === 'missed' ? 'missed' : 'pending'}`}>{cell.tone === 'done' ? `${thaiTime(cell.lastScanAt)}${cell.count > 1 ? ` (${cell.count})` : ''}` : cell.tone === 'missed' ? '✕' : cell.tone === 'current' ? '•' : ''}</td>)}
          <td>{row.done}/{row.due}</td>
        </tr>)}
      </tbody>;
    })}
  </table>;
}

/** Multiple patrol days: completed rounds per checkpoint per day (e.g. 7/8). */
function DayRoundMatrix({ report, now }: { report: PatrolReport; now: Date }) {
  const days = rangeDays(report);
  return <table className="patrol-print-table patrol-print-matrix">
    <thead><tr><th>จุดตรวจ</th>{days.map((day) => <th key={day}>{Number(day.slice(8))}</th>)}<th>รวม</th></tr></thead>
    {groupsOf(report).map((group) => {
      const table = roundsByDay({ dates: days, now, checkpoints: group.checkpoints, scans: patrolScans(report) });
      return <tbody key={group.department}>
        <tr className="patrol-print-group"><td colSpan={days.length + 2}>{group.department}</td></tr>
        {group.checkpoints.map((item) => {
          const totals = days.reduce((sum, day) => ({ done: sum.done + (table[item.id]?.[day]?.done || 0), due: sum.due + (table[item.id]?.[day]?.due || 0) }), { done: 0, due: 0 });
          return <tr key={item.id}>
            <td className="patrol-print-matrix__name">{item.code} {item.name}</td>
            {days.map((day) => { const cell = table[item.id]?.[day]; const full = cell && cell.due > 0 && cell.done >= cell.due; return <td key={day} className={full ? 'patrol-print-cell--done' : cell && cell.done < cell.due ? 'patrol-print-cell--missed' : ''}>{cell && cell.due ? `${cell.done}/${cell.due}` : ''}</td>; })}
            <td>{totals.done}/{totals.due}</td>
          </tr>;
        })}
      </tbody>;
    })}
  </table>;
}

function DepartmentSummary({ report, now }: { report: PatrolReport; now: Date }) {
  const days = rangeDays(report);
  const rows = groupsOf(report).map((group) => {
    let due = 0; let done = 0;
    for (const day of days) { const board = buildRoundBoard({ day, now, checkpoints: group.checkpoints, scans: patrolScans(report) }); due += board.summary.due; done += board.summary.done; }
    return { department: group.department, checkpoints: group.checkpoints.length, due, done, missed: Math.max(0, due - done), percent: due ? Math.round((done / due) * 100) : 0 };
  });
  return <table className="patrol-print-table patrol-print-dept">
    <thead><tr><th>จุดปฏิบัติงาน</th><th>จุดตรวจ</th><th>รอบ-จุดที่ต้องตรวจ</th><th>ตรวจแล้ว</th><th>ขาดตรวจ</th><th>ความครบถ้วน</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.department}><td>{row.department}</td><td>{row.checkpoints}</td><td>{row.due}</td><td>{row.done}</td><td>{row.missed}</td><td>{row.percent}%</td></tr>)}</tbody>
  </table>;
}

export function PatrolReportPrint({ kind, report, now = new Date() }: { kind: PatrolPrintKind; report: PatrolReport; today?: string; now?: Date }) {
  const days = rangeDays(report);
  const single = days.length === 1;
  return <article className={`print-only patrol-report-print patrol-report-print--${kind}`} aria-hidden="true">
    <Letterhead kind={kind} report={report} />
    <SummaryCards report={report} now={now} />
    {kind === 'all' && <><h2 className="patrol-print-h2">สรุปรายจุดปฏิบัติงาน</h2><DepartmentSummary report={report} now={now} /></>}
    <h2 className="patrol-print-h2">{single || kind === 'daily' ? 'สถานะการตรวจ 8 รอบ (รอบละ 3 ชั่วโมง)' : 'จำนวนรอบที่ตรวจครบต่อวัน'}</h2>
    {single || kind === 'daily' ? <RoundMatrix report={report} day={report.to} now={now} /> : <DayRoundMatrix report={report} now={now} />}
    {kind !== 'all' && <><h2 className="patrol-print-h2 patrol-print-break">รายการสแกนเรียงตามเวลา</h2><ScanTable report={report} /></>}
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
      <p className="patrol-qr-card__meta">จุดปฏิบัติงาน {item.department}{item.locationNote ? ` · ${item.locationNote}` : ''}</p>
      <footer>สแกนด้วยเมนู “สแกนจุดตรวจ” ในแอป SMS แล้วถ่ายรูปจุดตรวจ · QR v{item.qrVersion}</footer>
    </article>)}
  </section>;
}
