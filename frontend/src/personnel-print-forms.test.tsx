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

  it('renders a clear owner-reference document header before the employee table', () => {
    const { container } = render(<EmployeeRegisterPrint rows={rows} now={NOW} />);
    const root = container.querySelector('#personnel-register-print')!;
    const header = root.querySelector('.personnel-register-print__header')!;
    const titleBlock = header.querySelector('.personnel-register-print__title-block')!;

    expect(header.querySelector('.personnel-register-print__brand-mark')?.textContent).toBe('SMS');
    expect(header.querySelector('.personnel-register-print__brand-name')?.textContent).toBe('Security Management System');
    expect(titleBlock.querySelector('h1')?.textContent).toBe('ทะเบียนรายชื่อพนักงาน');
    expect(titleBlock.querySelector('.personnel-register-print__english-title')?.textContent).toBe('EMPLOYEE REGISTER');
    expect(titleBlock.textContent).toContain('ข้อมูล ณ วันที่');
    expect(titleBlock.textContent).toContain('2569');
    expect(titleBlock.textContent).toContain('จำนวน 2 คน');
    expect(root.querySelector('.personnel-register-print__accent-rule')).not.toBeNull();
    expect(header.compareDocumentPosition(root.querySelector('table')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders count, summary, columns and a separately spaced signature area without internal ids', () => {
    const { container } = render(<EmployeeRegisterPrint rows={rows} now={NOW} />);
    const root = container.querySelector('#personnel-register-print')!;
    const text = root.textContent || '';
    for (const label of ['ทั้งหมด', 'ใช้งาน', 'ทดลองงาน', 'ลา', 'พักงาน', 'ไม่ใช้งาน']) expect(root.querySelector('.personnel-register-print__summary')?.textContent).toContain(label);
    const headers = Array.from(root.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(headers).toEqual(['รหัส', 'ชื่อ-สกุล', 'จุดปฏิบัติงาน', 'ตำแหน่ง', 'ประเภท', 'วันเริ่มงาน', 'อายุงาน', 'โทรศัพท์', 'สถานะ']);
    const first = Array.from(root.querySelectorAll('tbody tr')[0].querySelectorAll('td')).map((td) => td.textContent);
    expect(first[0]).toBe('EMP-001'); expect(first[4]).toBe('–'); expect(first[6]).toBe('6 ปี 9 เดือน'); expect(first[7]).toBe('0811111111'); expect(first[8]).toBe('ใช้งาน');
    const second = Array.from(root.querySelectorAll('tbody tr')[1].querySelectorAll('td')).map((td) => td.textContent);
    expect(second[3]).toBe('–'); expect(second[5]).toBe('–'); expect(second[7]).toBe('–'); expect(second[8]).toBe('ไม่ใช้งาน');
    const signatures = root.querySelector('.personnel-register-print__signatures')!;
    expect(signatures.textContent).toContain('ผู้จัดทำ'); expect(signatures.textContent).toContain('ผู้ตรวจสอบ'); expect(signatures.textContent).toContain('วันที่');
    expect(root.querySelector('table')?.compareDocumentPosition(signatures) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(text).not.toContain('internal-1');
    expect(root.querySelectorAll('button, input')).toHaveLength(0);
  });

  it('keeps the signature block visibly separated while retaining compact print typography', () => {
    const css = read('./styles/personnel-directory.css');
    expect(css).toMatch(/\.personnel-register-print__signatures\s*\{[^}]*margin-top:\s*12mm;/s);
    expect(css).toMatch(/\.personnel-register-print__signatures\s*\{[^}]*break-inside:\s*avoid;/s);
    expect(css).toMatch(/\.personnel-register-print__table\s*\{[^}]*font-size:\s*8pt;/s);
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
