import { describe, test, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

const stylesCss = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf-8');
const mainTsx = fs.readFileSync(path.join(__dirname, 'main.tsx'), 'utf-8');

describe('Leave Request Printing DOM & CSS Rules', () => {
  test('main.tsx renders "ทราบ /" and "ลงชื่อ" in a single signature line in the correct order', () => {
    // Assert DOM markup structure for signature line in LeavePrintDocument
    expect(mainTsx).toContain('className="leave-print-signature-line"');
    expect(mainTsx).toContain('className="leave-print-notice">ทราบ /</span>');
    expect(mainTsx).toContain('className="leave-print-sig-label">ลงชื่อ</span>');
    expect(mainTsx).toContain('className="leave-print-dots">');

    // Assert "ทราบ /" comes before "ลงชื่อ" in the second signature block
    const secondSigSegment = mainTsx.slice(mainTsx.indexOf('className="leave-print-notice"'));
    const noticeIndex = secondSigSegment.indexOf('ทราบ /');
    const labelIndex = secondSigSegment.indexOf('className="leave-print-sig-label">ลงชื่อ');
    const dotsIndex = secondSigSegment.indexOf('className="leave-print-dots"');

    expect(noticeIndex).toBeGreaterThan(-1);
    expect(labelIndex).toBeGreaterThan(noticeIndex);
    expect(dotsIndex).toBeGreaterThan(labelIndex);
  });

  test('leave printing uses an isolated document instead of hiding the application shell', () => {
    expect(mainTsx).toContain("printDocument('.leave-print-document', 'ใบขออนุมัติลางาน.pdf'");
    expect(mainTsx).not.toContain('window.print()');
    expect(mainTsx).not.toContain('printing-leave');
    expect(stylesCss).not.toContain('body.printing-leave .app-shell');
    expect(stylesCss).toContain('.leave-print-signature-line { display: flex;');
    expect(stylesCss).toContain('white-space: nowrap;');
    expect(mainTsx).toContain('leaveTypeDisplayText(row)');
  });
});

describe('Bug 3 — Approved Schedule PDF Export DOM & CSS Rules', () => {
  test('schedule printing copies only the print document and prevents leading page breaks', () => {
    expect(mainTsx).toContain("import { printDocument, printScheduleDocument, printTableReport } from './schedule-print';");
    expect(stylesCss).toContain('.print-only { display: none !important; }');
    expect(stylesCss).toContain('break-before: auto !important;');
    expect(stylesCss).toContain('page-break-before: auto !important;');
  });

  test('main.tsx includes approval revision, approvedBy, and heading in printable schedule DOM', () => {
    expect(mainTsx).toContain('Security Management System - ตารางกะที่อนุมัติแล้ว');
    expect(mainTsx).toContain('ฉบับแก้ไข:');
    expect(mainTsx).toContain('อนุมัติโดย:');
  });
});
