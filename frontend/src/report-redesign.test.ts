import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { kpiTarget, kpiValueText } from './pages/executive-report/ExecutiveReportCenterPage';
import { canViewRoutePage } from './routing';

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const page = read('pages/executive-report/ExecutiveReportCenterPage.tsx');
const styles = read('styles/executive-report.css');

const hexLuminance = (hex: string) => {
  const channels = hex.replace('#', '').match(/../g)!.map((part) => parseInt(part, 16) / 255).map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};
const contrast = (a: string, b: string) => { const [x, y] = [hexLuminance(a), hexLuminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

describe('Report Center redesign (OWNER mockup)', () => {
  it('renders 8 KPI cards in two groups of four, with the workforce count as a context line instead of a KPI', () => {
    expect(page).toContain("(['operations', 'action'] as const).map((group)");
    for (const label of ['งานปฏิบัติการ', 'ต้องจัดการ']) expect(page).toContain(label);
    expect(styles).toContain('.executive-report-kpis.executive-kpi-row { grid-template-columns:repeat(4,minmax(0,1fr));');
    expect(page).toContain('พนักงานที่ปฏิบัติงาน <strong>{thaiNumber(report.workforce.activeEmployees)} คน</strong>');
    expect(page).not.toContain("<Chart title=\"พนักงานที่ปฏิบัติงานตามหน่วยงาน\"");
  });

  it('shows "—" for no-base or out-of-scope values and never prints 0% for 0/0', () => {
    expect(kpiValueText({ value: null, unit: '%' })).toBe('—');
    expect(kpiValueText({ value: null, unit: 'รายการ' })).toBe('—');
    expect(kpiValueText({ value: 98.6, unit: '%' })).toBe('98.6%');
    expect(kpiValueText({ value: 0, unit: 'กะ' })).toBe('0');
  });

  it('marks KPI 7 as a current queue and shows "ไม่พร้อมใน scope" for withheld data-quality rules', () => {
    expect(page).toContain("case 'pendingQueue': return 'ณ ปัจจุบัน · คิวที่คุณดำเนินการได้';");
    expect(page).toContain('item.unavailableLabel');
  });

  it('links a KPI only to a page the role can actually open (data quality stays ADMIN-only)', () => {
    const auth = (role: string) => ({ user: { role }, isViewingAs: false });
    const map: Record<string, string> = { attendanceSupervisor: 'attendanceSupervisor', patrolCenter: 'patrolCenter', licenses: 'licenses', leavePending: 'leavePending', approvalCenter: 'approvalCenter', dataQuality: 'dataQuality' };
    for (const role of ['ADMIN', 'MANAGER', 'SUPERVISOR']) {
      for (const target of Object.keys(map)) {
        const linked = kpiTarget(target, role);
        if (linked) expect(canViewRoutePage(linked as never, auth(role))).toBe(true);
      }
    }
    expect(kpiTarget('dataQuality', 'SUPERVISOR')).toBeNull();
    expect(kpiTarget('dataQuality', 'MANAGER')).toBeNull();
    expect(kpiTarget('dataQuality', 'ADMIN')).toBe('dataQuality');
    expect(kpiTarget('attendanceReport', 'SUPERVISOR')).toBeNull();
    expect(kpiTarget(null, 'ADMIN')).toBeNull();
    expect(canViewRoutePage('reportCenter', auth('VIEWER'))).toBe(false);
  });

  it('keeps the per-department patrol chart, the leave/licence charts and the gap attention items', () => {
    for (const text of ['ความครบถ้วนการตรวจจุดรายแผนก', 'คำขอลาตามประเภท · รายการ', 'สถานะใบอนุญาต · รายการ', 'ประเด็นที่ผู้บริหารควรติดตาม']) expect(page).toContain(text);
  });

  it('reserves a grid column for the KPI icon/arrow so long licence titles cannot collide on mobile', () => {
    expect(styles).toContain('.executive-report-kpi.executive-kpi .executive-kpi-head { display:grid; grid-template-columns:28px minmax(0,1fr) 18px;');
    expect(styles).toContain('overflow-wrap:anywhere');
    expect(styles).toContain('@media (max-width:430px) { .executive-report-kpis.executive-kpi-row { grid-template-columns:1fr; }');
  });

  it('uses the secondary-text token for subtext and the token meets WCAG AA (≥ 4.5:1) on white', () => {
    expect(styles).toContain('.executive-report-kpi.executive-kpi .executive-kpi-detail { display:block; min-height:0; margin:0; color:var(--color-text-secondary);');
    const tokens = read('styles/tokens.css');
    const secondary = tokens.match(/--color-text-secondary: (#[0-9a-f]{6});/i)![1];
    expect(contrast(secondary, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});
