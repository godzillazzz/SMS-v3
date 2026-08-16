import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');

describe('Leave quota provisioning page wiring', () => {
  it('keeps provisioning on the existing Admin quota page and opens the shared modal with no year field', () => {
    expect(main).toContain("page === 'quota' && canProvisionLeaveQuota(role)");
    expect(main).toContain("activePage === 'quota' && auth.user?.role === 'ADMIN'");
    expect(main).toContain("title: 'กำหนดโควตาวันลา'");
    expect(main).toContain("'+ กำหนดโควตา'");
    expect(main).toContain("values: { ...LEAVE_QUOTA_DEFAULTS }");
    const quotaCreate = main.slice(main.indexOf("if (activePage === 'quota' && auth.user?.role === 'ADMIN')"), main.indexOf("if (activePage === 'licenses')"));
    expect(quotaCreate).toContain("employeeId");
    expect(quotaCreate).toContain("sickLeave");
    expect(quotaCreate).toContain("personalLeave");
    expect(quotaCreate).toContain("vacationLeave");
    expect(quotaCreate).not.toContain("year");
  });

  it('shows the legacy-review warning and keeps successful-close/error-stays-open behavior in the shared editor', () => {
    expect(main).toContain('showQuotaLegacyWarning');
    expect(main).toContain('จับคู่พนักงาน');
    const editor = main.slice(main.indexOf('const runEditor ='), main.indexOf('const licenseDocumentServices'));
    expect(editor).toContain('await action(values, files)');
    expect(editor).toContain('setEditor(undefined)');
    expect(editor).toContain("setOperationRefresh((value) => value + 1)");
    expect(editor).toContain("setEditorError(toRequestErrorState(reason, 'บันทึกข้อมูลไม่สำเร็จ'))");
  });

  it('removes unsupported annual entitlement wording', () => {
    expect(main).not.toContain('ตามสิทธิ์ประจำปี (วัน)');
    expect(main).toContain('ตามสิทธิ์ที่กำหนด (วัน)');
  });
});
