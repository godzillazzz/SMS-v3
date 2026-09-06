import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (relative: string) => fs.readFileSync(path.join(__dirname, relative), 'utf8').replace(/\r\n/g, '\n');
const main = read('main.tsx');
const client = read('approval-policy-client.ts');
const panel = read('components/ApprovalAuthorityMatrixPanel.tsx');
const approvalCenter = read('pages/approvals/ApprovalCenterPage.tsx');
const centralApi = read('api.ts');

describe('CFG-06 Approval Authority Matrix / SLA', () => {
  it('uses a dedicated governed client and does not expand central api.ts', () => {
    expect(client).toContain("getApprovalPolicies");
    expect(client).toContain("updateApprovalPolicy");
    expect(client).toContain("'/approval-policies'");
    expect(centralApi).not.toContain('approval-policies');
  });

  it('places an Admin-only matrix in Configuration Center', () => {
    expect(main).toContain("import { ApprovalAuthorityMatrixPanel }");
    expect(main).toContain('<ApprovalAuthorityMatrixPanel token={token} />');
    expect(panel).toContain('Approval Authority Matrix / SLA');
    expect(panel).toContain('Admin-only ถูกล็อกโดยระบบ');
    expect(panel).toContain('security ceiling');
  });

  it('keeps Admin mandatory and permits Manager only when the safe reviewer ceiling allows it', () => {
    expect(panel).toContain('<input type="checkbox" checked disabled /> Admin');
    expect(panel).toContain("policy.safeReviewerRoles.includes('MANAGER')");
    expect(panel).toContain("reviewerRoles: event.target.checked ? ['ADMIN', 'MANAGER'] : ['ADMIN']");
  });

  it('edits SLA per request type and blocks invalid threshold ordering in the UI', () => {
    expect(panel).toContain('dueSoonHours');
    expect(panel).toContain('overdueHours');
    expect(panel).toContain('draft.overdueHours <= draft.dueSoonHours');
    expect(approvalCenter).toContain('item.sla?.dueSoonHours');
    expect(approvalCenter).toContain('item.sla?.overdueHours');
    expect(approvalCenter).not.toContain('dueSoon24h');
    expect(approvalCenter).not.toContain('overdue48h');
  });

  it('keeps the specialist matrix readable on mobile without dropping policy fields', () => {
    expect(panel).toContain('approval-policy-mobile-list');
    expect(panel).toContain('approval-policy-mobile-card');
    expect(panel).toContain('ผู้มีอำนาจอนุมัติ');
    expect(panel).toContain('เกณฑ์ SLA');
    expect(panel).toContain('ข้อบังคับที่ลดไม่ได้');
    expect(panel).toContain('aria-label="Approval policy แบบรายการ"');
    expect(panel).toContain('role="alert"');
  });

  it('announces loading and result states while retaining table semantics', () => {
    expect(panel).toContain('role="status" aria-live="polite"');
    expect(panel).toContain('aria-describedby="approval-policy-description"');
    expect(panel).toContain('caption id="approval-policy-description"');
    expect(panel).toContain('<th scope="col">ประเภทคำขอ</th>');
    expect(panel).toContain('aria-live={notice.includes');
  });

  it('selects additive leave position aliases from Position Master and states protected invariants', () => {
    expect(panel).toContain('ตำแหน่ง Supervisor เพิ่มเติม');
    expect(panel).toContain('ตำแหน่ง Manager เพิ่มเติม');
    expect(panel).toContain('api.personnelMasters(token, true)');
    expect(panel).toContain('positionOptions.map');
    expect(panel).toContain('Legacy aliases ที่คงไว้เพื่อ compatibility');
    expect(panel).not.toContain('placeholder=\"เช่น หัวหน้าชุด');
    expect(panel).not.toContain('placeholder=\"เช่น section lead');
    expect(panel).toContain('ไม่สามารถลด guard เหล่านี้ได้');
  });
});
