import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const main = read('./main.tsx');
const tabs = read('./components/AccessibleTabs.ts');
const history = read('./pages/pwa-attendance/AttendanceHistoryPwaPage.tsx');
const reports = read('./pages/reports/ReportCenterPage.tsx');
const licenses = read('./components/LicenseDocuments.tsx');
const qualityCss = read('./styles/ux-ui-quality-10.css');
const attendance = read('./pages/attendance/AttendancePage.tsx');
const actionState = read('./pages/attendance/attendance-action-state.ts');
const supervisor = read('./pages/attendance-supervisor/AttendanceSupervisorPage.tsx');
const officialReport = read('./pages/reports/AttendanceOfficialReport.tsx');

describe('UXUI-Q10 measurable quality contracts', () => {
  it('implements complete keyboard tab semantics on every current tablist surface', () => {
    expect(tabs).toContain("ArrowLeft");
    expect(tabs).toContain("ArrowRight");
    expect(tabs).toContain("Home");
    expect(tabs).toContain("End");
    for (const source of [history, reports, licenses]) {
      expect(source).toContain('role="tablist"');
      expect(source).toContain('role="tab"');
      expect(source).toContain('aria-selected=');
      expect(source).toContain('aria-controls=');
      expect(source).toContain('tabIndex=');
      expect(source).toContain('activateTabFromKeyboard');
    }
  });

  it('keeps employee and manager Attendance copy Thai-first without changing authority calls', () => {
    expect(actionState).toContain("actionText: checkOut ? 'แตะเพื่อเช็กเอาต์' : 'แตะเพื่อเช็กอิน'");
    expect(actionState).toContain("readyLine: checkOut ? 'พร้อมสำหรับเช็กเอาต์' : 'พร้อมสำหรับเช็กอิน'");
    expect(attendance).toContain('<small>พื้นที่ตามตาราง</small>');
    expect(history).toContain('พื้นที่ตามตาราง');
    expect(history).toContain('พื้นที่ที่บันทึกจริง');
    expect(history).toContain("LOCATION_RISK: 'ความเสี่ยงตำแหน่ง'");
    expect(history).toContain("PHOTO_RISK: 'ความเสี่ยงรูปภาพ'");
    expect(supervisor).toContain('<span>พื้นที่ตามตาราง</span>');
    expect(supervisor).toContain('<span>พื้นที่ที่บันทึกจริง</span>');
    expect(officialReport).toContain('<th>พื้นที่ตามตาราง</th><th>พื้นที่ที่บันทึกจริง</th>');
    expect(attendance).toContain('attendanceVerificationStart(token');
    expect(attendance).toContain('attendanceAcceptVerifiedEvent(token');
  });

  it('applies a readable operational floor to remaining PWA, supervisor and operational surfaces', () => {
    expect(main).toContain("import './styles/ux-ui-quality-10.css';");
    expect(qualityCss).toContain('.employee-v4-history-times span');
    expect(qualityCss).toContain('font-size: 12px !important;');
    expect(qualityCss).toContain('.attendance-supervisor-v4');
    expect(qualityCss).toContain('.system-health-warning > span');
    expect(qualityCss).toContain('.data-table th');
    expect(qualityCss).toContain('.pwa-bottom-nav button span');
  });

  it('uses the shared SVG icon authority for license viewing/closing controls', () => {
    expect(licenses).toContain('<SmsIcon name="eye"');
    expect(licenses).toContain('<SmsIcon name="close"');
    expect(licenses).not.toContain('>👁</button>');
    expect(licenses).not.toContain('>◉</button>');
    expect(licenses).not.toContain('>×</button>');
  });
});
