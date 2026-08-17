import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');

describe('G03.1 annual quota page wiring', () => {
  it('keeps create control Admin-only while adding a validated selected-year selector', () => {
    expect(main).toContain("page === 'quota' && canProvisionLeaveQuota(role)");
    expect(main).toContain("activePage === 'quota' && auth.user?.role === 'ADMIN'");
    expect(main).toContain('const [quotaYear, setQuotaYear] = useState(currentBangkokQuotaYear)');
    expect(main).toContain('aria-label="ปีสิทธิ์โควตาวันลา"');
    expect(main).toContain('thaiQuotaYearLabel(quotaYear)');
    expect(main).toContain('buildLeaveQuotaProvisioningPayload({ ...form, quotaYear })');
  });

  it('uses 30/3/6 defaults and does not expose a free-text year in the create modal', () => {
    const quotaCreate = main.slice(main.indexOf("if (activePage === 'quota' && auth.user?.role === 'ADMIN')"), main.indexOf("if (activePage === 'licenses')"));
    expect(quotaCreate).toContain('values: { ...LEAVE_QUOTA_DEFAULTS, quotaYear: String(quotaYear) }');
    expect(quotaCreate).not.toContain("name: 'quotaYear'");
    expect(quotaCreate).toContain('กำหนดโควตาวันลา ปี');
  });

  it('keeps null-year legacy rows visible and requires explicit year when linking', () => {
    expect(main).toContain("api.leaveQuotas(auth.token, operationPage, showLegacyQuotas ? { legacy: true } : { year: quotaYear })");
    expect(main).toContain('ข้อมูลเดิม — ยังไม่ระบุปี');
    const link = main.slice(main.indexOf("action === 'link' && activePage === 'quota'"), main.indexOf("action === 'document'"));
    expect(link).toContain("name: 'quotaYear'");
    expect(link).toContain('quotaYearOptions');
    expect(link).toContain('Number(form.quotaYear)');
    expect(link).toContain("row.employeeId ? 'จัดประเภทปีให้ข้อมูลโควตาเดิม'");
    expect(link).toContain('employeeOptions.filter((option) => option.value === String(row.employeeId))');
  });

  it('keeps Manager/Viewer out of the quota administration page', () => {
    expect(main).toContain("if (page === 'quota') return auth.user?.role === 'ADMIN'");
  });
});
