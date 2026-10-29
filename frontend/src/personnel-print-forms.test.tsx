// @vitest-environment jsdom
import React from 'react';
import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { EmployeeRecordPrint, EmployeeRegisterPrint, registerSummary, serviceLength } from './components/personnel/PersonnelPrintForms';
import type { PersonnelRecord } from './components/personnel/types';

afterEach(cleanup);
const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const NOW = new Date('2026-10-29T03:00:00Z');
const rows: PersonnelRecord[] = [
  { id: 'internal-1', employeeCode: 'EMP-001', firstName: 'นิรันดร์', lastName: 'สมศรี', department: 'WCS', jobTitle: 'เจ้าหน้าที่', isActive: true, phone: '0811111111', hiredAt: '2020-01-02' },
  { id: 'internal-2', employeeCode: 'EMP-002', firstName: 'มาลี', lastName: 'ดีใจ', department: 'PO11', jobTitle: undefined, isActive: false, phone: null, hiredAt: null }
];

describe('employee register print (A4 landscape)', () => {
  it('derives summary only from isActive and leaves unknown buckets as –', () => {
    expect(registerSummary(rows)).toEqual({ total: 2, active: 1, probation: '–', leave: '–', suspended: '–', separated: 1 });
  });

  it('computes service length from hiredAt', () => {
    expect(serviceLength('2020-01-02', NOW)).toBe('6 ปี 9 เดือน');
    expect(serviceLength('2026-10-01', NOW)).toBe('0 ปี 0 เดือน');
    expect(serviceLength(null, NOW)).toBe('–');
  });

  it('renders title, BE print date, count, summary, columns and signatures without internal ids', () => {
    const { container } = render(<EmployeeRegisterPrint rows={rows} now={NOW} />);
    const root = container.querySelector('#personnel-register-print')!;
    const text = root.textContent || '';
    expect(root.querySelector('h1')?.textContent).toBe('ทะเบียนรายชื่อพนักงาน');
    expect(text).toContain('2569');
    expect(text).toContain('จำนวน 2 คน');
    for (const label of ['ทั้งหมด', 'ปฏิบัติงานปกติ', 'ทดลองงาน', 'ลา', 'พักงาน', 'ไม่ใช้งาน']) expect(root.querySelector('.personnel-register-print__summary')?.textContent).toContain(label);
    const headers = Array.from(root.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(headers).toEqual(['รหัส', 'ชื่อ-สกุล', 'แผนก', 'ตำแหน่ง', 'ประเภท', 'วันเริ่มงาน', 'อายุงาน', 'โทรศัพท์', 'สถานะ']);
    const first = Array.from(root.querySelectorAll('tbody tr')[0].querySelectorAll('td')).map((td) => td.textContent);
    expect(first[0]).toBe('EMP-001'); expect(first[4]).toBe('–'); expect(first[6]).toBe('6 ปี 9 เดือน'); expect(first[7]).toBe('0811111111'); expect(first[8]).toBe('ปฏิบัติงาน');
    const second = Array.from(root.querySelectorAll('tbody tr')[1].querySelectorAll('td')).map((td) => td.textContent);
    expect(second[3]).toBe('–'); expect(second[5]).toBe('–'); expect(second[7]).toBe('–'); expect(second[8]).toBe('ไม่ใช้งาน');
    expect(text).toContain('ผู้จัดทำ'); expect(text).toContain('ผู้ตรวจสอบ'); expect(text).toContain('วันที่');
    expect(text).not.toContain('internal-1');
    expect(root.querySelectorAll('button, input')).toHaveLength(0);
  });
});

describe('individual employee record print (A4 portrait, confidential)', () => {
  const quota = { sickLeave: 30, sickLeaveUsed: 2, sickLeaveRemaining: 28, personalLeave: 6, personalLeaveUsed: 1, personalLeaveRemaining: 5, vacationLeave: 10, vacationLeaveUsed: 0, vacationLeaveRemaining: 10 };
  const leaves = [{ id: 'lr-1', leaveType: 'SICK', leaveTypeNameSnapshot: 'ลาป่วย', startDate: '2026-03-02', endDate: '2026-03-03', dayCount: 2, status: 'APPROVED' }];

  it('renders confidential header, quota table, leave history and – for data not in DB', () => {
    const { container } = render(<EmployeeRecordPrint employee={rows[0]} quota={quota} leaves={leaves} now={NOW} />);
    const root = container.querySelector('#personnel-record-print')!;
    const text = root.textContent || '';
    expect(text).toContain('ลับ CONFIDENTIAL');
    expect(text).toContain('นิรันดร์ สมศรี'); expect(text).toContain('EMP-001'); expect(text).toContain('WCS'); expect(text).toContain('เจ้าหน้าที่');
    for (const label of ['เลขประจำตัวประชาชน', 'วันเกิด', 'ที่อยู่', 'ผู้ติดต่อฉุกเฉิน', 'เงินเดือน']) {
      const row = Array.from(root.querySelectorAll('.personnel-record-print__field')).find((el) => el.querySelector('dt')?.textContent === label);
      expect(row?.querySelector('dd')?.textContent).toBe('–');
    }
    expect(text).toContain('พ.ศ. 2569');
    const quotaRows = Array.from(root.querySelectorAll('.personnel-record-print__quota tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent));
    expect(quotaRows).toEqual([['ลาป่วย', '30', '2', '28'], ['ลากิจ', '6', '1', '5'], ['ลาพักร้อน', '10', '0', '10']]);
    expect(root.querySelector('.personnel-record-print__history')?.textContent).toContain('ลาป่วย');
    expect(root.querySelector('.personnel-record-print__history')?.textContent).toContain('อนุมัติ');
    expect(root.querySelector('.personnel-record-print__training')?.textContent).toContain('–');
    expect(text).not.toContain('internal-1');
  });

  it('renders – rows when quota is unavailable and never fabricates salary', () => {
    const { container } = render(<EmployeeRecordPrint employee={{ ...rows[1], salary: 50000 } as PersonnelRecord} now={NOW} />);
    const text = container.textContent || '';
    expect(text).not.toContain('50000');
    const quotaRows = Array.from(container.querySelectorAll('.personnel-record-print__quota tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent));
    expect(quotaRows[0]).toEqual(['ลาป่วย', '–', '–', '–']);
  });
});

describe('print wiring', () => {
  it('directory exposes register print and drawer exposes record print; CSS stays in lazy personnel CSS', () => {
    const page = read('./pages/personnel/PersonnelDirectoryPage.tsx');
    const header = read('./components/personnel/PersonnelDirectoryHeader.tsx');
    const drawer = read('./components/personnel/PersonnelDetailDrawer.tsx');
    expect(header).toContain('พิมพ์ทะเบียน');
    expect(page).toContain("printDocument('#personnel-register-print'");
    expect(page).toContain("orientation: 'landscape'");
    expect(drawer).toContain('พิมพ์ทะเบียนประวัติ');
    expect(drawer).toContain("printDocument('#personnel-record-print'");
    expect(drawer).toContain("orientation: 'portrait'");
    expect(read('./styles/personnel-directory.css')).toContain('.personnel-record-print');
    expect(read('./styles.css')).not.toContain('personnel-record-print');
  });
});
