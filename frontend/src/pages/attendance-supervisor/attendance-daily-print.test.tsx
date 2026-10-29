// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const mocks = vi.hoisted(() => ({ printDocument: vi.fn(async () => undefined) }));
vi.mock('../../schedule-print', () => ({ printDocument: mocks.printDocument }));

import { AttendanceDailyReport, dailyReportStatus, dailyReportSummary, type DailyReportRow } from './AttendanceDailyReport';

const base = { shift: { code: 'D1', name: 'Day' }, flags: [] as string[], attendanceStatus: 'COMPLETE' };
const rows: DailyReportRow[] = [
  { ...base, assignmentId: 'a1', employeeCode: 'EMP-101', employeeName: 'อนันต์ ตัวอย่าง', department: 'รปภ.', checkInAt: '2026-10-28T00:55:00.000Z', checkOutAt: '2026-10-28T10:05:00.000Z', workedMinutes: 550 },
  { ...base, assignmentId: 'a2', employeeCode: 'EMP-202', employeeName: 'บุญ ตัวอย่าง', department: null, checkInAt: '2026-10-28T01:20:00.000Z', checkOutAt: null, workedMinutes: null, attendanceStatus: 'LATE', flags: ['LATE', 'OUTSIDE_ALL_SITES', 'DEVICE_MISMATCH'] },
  { ...base, assignmentId: 'a3', employeeCode: null, employeeName: 'ชัย ตัวอย่าง', department: 'ธุรการ', checkInAt: null, checkOutAt: null, workedMinutes: null, attendanceStatus: 'NOT_CHECKED_IN_YET' },
  { ...base, assignmentId: 'a4', employeeCode: 'EMP-404', employeeName: 'ดาว ตัวอย่าง', department: 'ธุรการ', checkInAt: null, checkOutAt: null, workedMinutes: null, attendanceStatus: 'LEAVE', flags: ['LEAVE'] },
  { ...base, assignmentId: 'a5', employeeCode: 'EMP-505', employeeName: 'เอก ตัวอย่าง', department: 'รปภ.', checkInAt: '2026-10-28T01:00:00.000Z', checkOutAt: '2026-10-28T08:00:00.000Z', workedMinutes: 420, flags: ['EARLY_OUT'] }
];

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('AttendanceDailyReport (owner A4 reference)', () => {
  it('derives summary cards only from API rows', () => {
    expect(dailyReportSummary(rows)).toEqual({ total: 5, checkedIn: 3, late: 1, earlyOut: 1, leave: 1, noRecord: 1, offSite: 1 });
  });

  it('maps statuses to มาทำงาน / มาสาย / ลา / ไม่มีบันทึก', () => {
    expect(rows.map((row) => dailyReportStatus(row).label)).toEqual(['มาทำงาน', 'มาสาย', 'ไม่มีบันทึก', 'ลา', 'มาทำงาน']);
    expect(dailyReportStatus(rows[2]).tone).toBe('danger');
  });

  it('renders toolbar, bilingual title, Thai BE date with weekday, cards and table', () => {
    const onShow = vi.fn();
    render(<AttendanceDailyReport date="2026-10-28" rows={rows} onShow={onShow} />);
    expect(screen.getByText('กระดาษ A4 ปิด header/footer ของเบราว์เซอร์')).toBeTruthy();
    const report = document.querySelector<HTMLElement>('.attendance-daily-report__sheet')!;
    expect(within(report).getByRole('heading', { level: 1 }).textContent).toBe('รายงานการลงเวลาประจำวัน');
    expect(report.textContent).toContain('Daily Attendance');
    expect(report.textContent).toContain('วันพุธที่ 28 ตุลาคม พ.ศ. 2569');
    const cards = Array.from(report.querySelectorAll('.attendance-daily-report__card'), (card) => card.textContent);
    expect(cards).toEqual(['พนักงานทั้งหมด5', 'ลงเวลาเข้า3', 'มาสาย1', 'ออกก่อน1', 'ลา1', 'ไม่มีบันทึก1', 'นอกสถานที่1']);
    const headers = Array.from(report.querySelectorAll('thead th'), (th) => th.textContent);
    expect(headers).toEqual(['ลำดับ', 'รหัส', 'ชื่อ-สกุล', 'แผนก', 'เวลาเข้า', 'เวลาออก', 'ชั่วโมง', 'สถานะ']);
    const body = Array.from(report.querySelectorAll('tbody tr'), (tr) => Array.from(tr.querySelectorAll('td'), (td) => td.textContent));
    expect(body[0]).toEqual(['1', 'EMP-101', 'อนันต์ ตัวอย่าง', 'รปภ.', '07:55', '17:05', '9:10', 'มาทำงาน']);
    expect(body[1]).toEqual(['2', 'EMP-202', 'บุญ ตัวอย่าง', '–', '08:20', '–', '–', 'มาสาย · อุปกรณ์ไม่ตรง · นอกพื้นที่']);
    expect(body[2]).toEqual(['3', '–', 'ชัย ตัวอย่าง', 'ธุรการ', '–', '–', '–', 'ไม่มีบันทึก']);
    expect(report.querySelector('tbody tr:nth-child(3) .attendance-daily-report__status--danger')).not.toBeNull();
    expect(report.textContent).not.toContain('DEVICE_MISMATCH');

    fireEvent.change(screen.getByLabelText('วันที่รายงาน'), { target: { value: '2026-10-27' } });
    expect(onShow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'แสดง' }));
    expect(onShow).toHaveBeenCalledWith('2026-10-27');

    fireEvent.click(screen.getByRole('button', { name: 'พิมพ์ / บันทึก PDF' }));
    expect(mocks.printDocument).toHaveBeenCalledWith('.attendance-daily-report__sheet', 'รายงานการลงเวลาประจำวัน-2026-10-28.pdf', { orientation: 'portrait', margin: '10mm' });
  });

  it('shows explicit empty and loading states without fabricating rows', () => {
    const { rerender } = render(<AttendanceDailyReport date="2026-10-28" rows={[]} onShow={() => undefined} />);
    expect(document.querySelector('tbody')!.textContent).toContain('ไม่มีข้อมูลในระบบ');
    expect((screen.getByRole('button', { name: 'พิมพ์ / บันทึก PDF' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<AttendanceDailyReport date="2026-10-28" rows={rows} loading onShow={() => undefined} />);
    expect((screen.getByRole('button', { name: 'พิมพ์ / บันทึก PDF' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('blocks printing and hides values when the request fails', () => {
    render(<AttendanceDailyReport date="2026-10-28" rows={rows} error="โหลดไม่สำเร็จ" onShow={() => undefined} />);
    expect(screen.getByRole('alert').textContent).toBe('โหลดไม่สำเร็จ');
    expect((screen.getByRole('button', { name: 'พิมพ์ / บันทึก PDF' }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('tbody')!.textContent).not.toContain('EMP-101');
    expect(document.querySelector('.attendance-daily-report__card strong')!.textContent).toBe('–');
  });

  it('wires the report into the supervisor page daily mode and ships A4 print CSS', () => {
    const page = readFileSync('src/pages/attendance-supervisor/AttendanceSupervisorPage.tsx', 'utf8');
    expect(page).toContain("import { AttendanceDailyReport } from './AttendanceDailyReport'");
    expect(page).toContain('{mode === \'daily\' && dailyReportOpen && <AttendanceDailyReport');
    const css = readFileSync('src/pages/attendance-supervisor/attendance-supervisor-v4.css', 'utf8');
    expect(css).toContain('.attendance-daily-report__sheet');
    expect(css).toContain('.attendance-daily-report__status--danger');
  });
  it('counts employees distinctly and includes support sites', () => {
    const data = [{ ...rows[0], employeeId: 'one' }, { ...rows[0], assignmentId: 'second', employeeId: 'one', flags: ['ASSIST_OTHER_SITE'] }, { ...rows[1], employeeId: 'two' }];
    expect(dailyReportSummary(data).total).toBe(2);
    expect(dailyReportSummary(data).offSite).toBe(2);
  });

  it('prints filter context and all relevant anomalies', () => {
    render(<AttendanceDailyReport date="2026-10-28" rows={[{ ...rows[1], flags: ['LATE', 'WRONG_SHIFT', 'DEVICE_MISMATCH', 'OUTSIDE_ALL_SITES', 'TIME_ABNORMAL', 'MISSING_CHECK_OUT'] }]} filters={{ department: 'SECURITY', site: 'Site A', shift: 'Night', employee: 'EMP-202', status: 'มาสาย' }} onShow={() => undefined} />);
    const sheet = document.querySelector('.attendance-daily-report__sheet')!.textContent!;
    for (const text of ['SECURITY', 'Site A', 'Night', 'EMP-202', 'มาสาย', 'ผิดกะ', 'อุปกรณ์', 'นอกพื้นที่', 'เวลาผิดปกติ', 'ไม่ได้ลงเวลาออก']) expect(sheet).toContain(text);
  });

});
