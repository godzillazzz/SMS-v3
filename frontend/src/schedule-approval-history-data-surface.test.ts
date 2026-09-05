import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
const dataSurfaceStyles = readFileSync(new URL('./styles/data-surfaces.css', import.meta.url), 'utf8');

describe('WAVE 4B Schedule Approval History responsive surface', () => {
  it('uses the shared responsive table contract with complete table semantics and states', () => {
    expect(main).toContain('const approvalSurface = <ResponsiveDataTable');
    expect(main).toContain('const approvalTableHeader = <tr>{config.columns.map((column) => <th key={column.label} scope="col">');
    expect(main).toContain('const shouldRenderApprovalSurface = () => page === \'approvals\';');
    expect(main).toContain('DataTableSkeletonRows');
    expect(main).toContain('DataTableSkeletonCards');
    expect(main).toContain('variant="empty"');
    expect(main).toContain('variant="error"');
    expect(main).toContain('aria-label="รายการประวัติการอนุมัติตารางกะ"');
    expect(main).toContain("page === 'approvals' ? 'แบ่งหน้าประวัติการอนุมัติตารางกะ'");
    expect(main).toContain('แบ่งหน้า');
  });

  it('keeps approve and reject actions reachable on desktop, mobile, and the detail drawer', () => {
    expect(main).toContain("if (page === 'approvals') return <><button className=\"btn-success compact\" onClick={() => onAction(row, 'approve')}>อนุมัติ</button><button className=\"btn-danger-outline compact\" onClick={() => onAction(row, 'reject')}>ไม่อนุมัติ</button></>");
    expect(main).toContain('className="approval-mobile-actions"');
    expect(main).toContain("secondaryActions.push({ label: 'ไม่อนุมัติ', tone: 'danger'");
    expect(main).toContain("api.updateScheduleApproval(auth.token, id, { status: action === 'approve' ? 'APPROVED' : 'REJECTED' })");
  });

  it('preserves schedule approval authority and meaningful row identity', () => {
    expect(main).toContain("approvals: api.scheduleApprovals");
    expect(main).toContain("const approvalRowLabel = (row: DataRow) => `เปิดรายละเอียดการอนุมัติตาราง");
    expect(main).toContain('Revision ${text(row.revision)}');
    expect(main).toContain("const canEditRows = canManage && (page !== 'approvals' || role === 'ADMIN')");
  });

  it('provides mobile wrapping and readable action geometry without changing business semantics', () => {
    expect(dataSurfaceStyles).toContain('.data-surface-page--approvals .signature-data-table');
    expect(dataSurfaceStyles).toContain('.data-surface-page--approvals .signature-data-row > td');
    expect(dataSurfaceStyles).toContain('.approval-mobile-record__open');
    expect(dataSurfaceStyles).toContain('.approval-mobile-actions button');
    expect(dataSurfaceStyles).toContain('overflow-wrap: anywhere');
    expect(dataSurfaceStyles).toContain('min-height: 40px');
  });
});
