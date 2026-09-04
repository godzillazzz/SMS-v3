import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AuditTable } from './components/audit/AuditTable';
import type { AuditEvent } from './components/audit/audit-types';
import { DataTablePagination, DataTableSkeletonCards, DataTableSkeletonRows, DataTableState, ResponsiveDataTable } from './components/ResponsiveDataTable';
import { PersonnelTable } from './components/personnel/PersonnelTable';
import type { PersonnelRecord } from './components/personnel/types';

describe('WAVE 3 ResponsiveDataTable contract', () => {
  it('provides a labelled desktop/mobile surface and announces loading without fabricating rows', () => {
    const html = renderToStaticMarkup(<ResponsiveDataTable ariaLabel="รายการ Audit Log" loading loadingLabel="กำลังโหลด Audit Log…" hasRows={false} className="audit-table-card" desktop={<table><tbody><DataTableSkeletonRows columnCount={6} rowCount={3} /></tbody></table>} mobile={<div><DataTableSkeletonCards count={2} /></div>} />);
    expect(html).toContain('class="data-table-shell data-surface-card audit-table-card"');
    expect(html).toContain('aria-label="รายการ Audit Log"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('กำลังโหลด Audit Log…');
    expect(html).toContain('class="data-table-desktop"');
    expect(html).toContain('class="data-table-mobile"');
    expect((html.match(/class="data-table-skeleton-row/g) ?? []).length).toBe(3);
    expect((html.match(/data-mobile-card/g) ?? []).length).toBe(2);
  });

  it('announces an error as an alert and exposes only a safe retry callback', () => {
    const retry = vi.fn();
    const html = renderToStaticMarkup(<ResponsiveDataTable ariaLabel="รายการบุคลากร" error errorLabel="โหลดบุคลากรไม่สำเร็จ" desktop={<DataTableState variant="error" title="ไม่สามารถโหลดข้อมูลบุคลากร" action={{ label: 'ลองใหม่', onClick: retry }} />} mobile={<DataTableState variant="error" title="ไม่สามารถโหลดข้อมูลบุคลากร" />} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('โหลดบุคลากรไม่สำเร็จ');
    expect(html).toContain('ไม่สามารถโหลดข้อมูลบุคลากร');
    expect(html).toContain('type="button"');
    expect(html).toContain('ลองใหม่');
    expect(retry).not.toHaveBeenCalled();
  });

  it('keeps empty state semantic text and filtered recovery action explicit', () => {
    const clear = vi.fn();
    const html = renderToStaticMarkup(<DataTableState variant="empty" title="ไม่พบผลการค้นหา" description="ลองล้างตัวกรองหรือใช้คำค้นหาอื่น" action={{ label: 'ล้างตัวกรอง', onClick: clear }} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('ไม่พบผลการค้นหา');
    expect(html).toContain('ลองล้างตัวกรองหรือใช้คำค้นหาอื่น');
    expect(html).toContain('ล้างตัวกรอง');
    expect(clear).not.toHaveBeenCalled();
  });

  it('normalizes pagination labels, current-page announcement and disabled boundaries', () => {
    const pageOne = renderToStaticMarkup(<DataTablePagination page={1} totalPages={3} onChange={vi.fn()} ariaLabel="แบ่งหน้า Audit Log" />);
    expect(pageOne).toContain('aria-label="แบ่งหน้า Audit Log"');
    expect(pageOne).toContain('aria-label="หน้าก่อนหน้า" disabled');
    expect(pageOne).toContain('หน้า 1 จาก 3');
    expect(pageOne).not.toContain('aria-label="หน้าถัดไป" disabled');

    const loading = renderToStaticMarkup(<DataTablePagination page={2} totalPages={3} loading onChange={vi.fn()} ariaLabel="แบ่งหน้าบุคลากร" />);
    expect(loading).toContain('aria-label="หน้าก่อนหน้า" disabled');
    expect(loading).toContain('aria-label="หน้าถัดไป" disabled');
    expect(loading).toContain('aria-live="polite"');
  });

  it('keeps Audit as a labelled table/card pair with safe long-content and state coverage', () => {
    const row: AuditEvent = { id: 'audit-1', createdAt: '2026-09-04T02:12:02.599Z', actor: { displayName: 'ผู้ดูแลระบบที่มีชื่อยาวเพื่อทดสอบการตัดบรรทัด', role: 'ADMIN' }, module: 'EMPLOYEE', action: 'UPDATE', entityType: 'Employee', entityId: 'employee-1', metadata: { note: 'รายละเอียดภาษาไทยยาวที่ต้องอ่านได้ครบผ่านรายละเอียดเหตุการณ์' } };
    const html = renderToStaticMarkup(<AuditTable rows={[row]} loading={false} hasActiveFilters={false} onSelect={vi.fn()} />);
    expect((html.match(/<th scope="col"/g) ?? []).length).toBe(6);
    expect(html).toContain('aria-label="รายการ Audit Log"');
    expect(html).toContain('ผู้ดูแลระบบที่มีชื่อยาวเพื่อทดสอบการตัดบรรทัด');
    expect(html).toContain('data-table-scroll');
    expect(html).toContain('audit-mobile-cards');
    expect(html).toContain('ดูรายละเอียด');

    const loading = renderToStaticMarkup(<AuditTable rows={[]} loading hasActiveFilters={false} onSelect={vi.fn()} />);
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('data-table-skeleton-row');

    const filteredEmpty = renderToStaticMarkup(<AuditTable rows={[]} loading={false} hasActiveFilters onSelect={vi.fn()} />);
    expect(filteredEmpty).toContain('ไม่พบรายการ Audit Log ตามเงื่อนไขที่เลือก');
    expect(filteredEmpty).toContain('ลองเปลี่ยนตัวกรองหรือขยายช่วงวันที่');
  });

  it('keeps Personnel table/card information equivalent and exposes safe retry/error states', () => {
    const employee: PersonnelRecord = { id: 'employee-1', employeeCode: 'EMP-001', firstName: 'ชื่อพนักงานที่ยาวมากสำหรับทดสอบการห่อข้อความ', lastName: 'นามสกุลภาษาไทย', department: 'หน่วยงานปฏิบัติการที่มีชื่อยาว', jobTitle: 'ตำแหน่งปฏิบัติการ', isActive: true };
    const html = renderToStaticMarkup(<PersonnelTable rows={[employee]} canManage selectedId={employee.id} onSelect={vi.fn()} onEdit={vi.fn()} />);
    expect((html.match(/<th scope="col"/g) ?? []).length).toBe(6);
    expect(html).toContain('aria-label="รายการบุคลากร"');
    expect(html).toContain('แก้ไขข้อมูล');
    expect(html).toContain('personnel-mobile-record');
    expect(html).toContain('ชื่อพนักงานที่ยาวมากสำหรับทดสอบการห่อข้อความ');

    const retry = vi.fn();
    const error = renderToStaticMarkup(<PersonnelTable rows={[]} canManage onSelect={vi.fn()} onEdit={vi.fn()} error onRetry={retry} />);
    expect(error).toContain('role="alert"');
    expect(error).toContain('ไม่สามารถโหลดข้อมูลบุคลากร');
    expect(error).toContain('ลองใหม่');

    const empty = renderToStaticMarkup(<PersonnelTable rows={[]} canManage onSelect={vi.fn()} onEdit={vi.fn()} hasActiveFilters emptyAction={{ label: 'ล้างตัวกรอง', onClick: vi.fn() }} />);
    expect(empty).toContain('ไม่พบผลการค้นหา');
    expect(empty).toContain('ล้างตัวกรอง');
  });
});
