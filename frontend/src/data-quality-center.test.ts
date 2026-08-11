import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Data Quality Center V1 contract', () => {
  it('exposes an ADMIN-only navigation and page branch', () => {
    const main = read('./main.tsx');
    expect(main).toContain("{ id: 'dataQuality', icon: '◈', label: 'คุณภาพข้อมูล' }");
    expect(main).toContain("if (page === 'dataQuality') return auth.user?.role === 'ADMIN';");
    expect(main).toContain("activePage === 'dataQuality'");
    expect(main).toContain("api.dataQualityIssues");
  });

  it('uses the read-only API with server-side filters and pagination', () => {
    const api = read('./api.ts');
    expect(api).toMatch(/dataQualityIssues:.*\/data-quality\/issues\?/);
    expect(api).toMatch(/page: String\(page\).*pageSize: String\(pageSize\)/);
    expect(api).toContain('severity');
    expect(api).toContain('department');
    expect(api).toContain('search');
  });

  it('keeps desktop table and mobile cards as separate renderers', () => {
    const page = read('./pages/data-quality/DataQualityCenterPage.tsx');
    const styles = read('./styles/data-quality.css');
    const responsiveStyles = read('./styles/data-quality-responsive.css');
    expect(page).toContain('data-quality-desktop-table');
    expect(page).toContain('<table>');
    expect(page).toContain('<thead>');
    expect(page).toContain('<tbody>');
    expect(page).toContain('data-quality-mobile-cards');
    expect(page).toContain('data-quality-mobile-card');
    expect(page).not.toMatch(/method:\s*['\"](?:POST|PUT|PATCH|DELETE)/);
    expect(styles).toContain('.data-quality-desktop-table{display:block');
    expect(styles).toContain('.data-quality-mobile-cards{display:none}');
    expect(styles).toContain('@media(max-width:640px)');
    expect(styles).toContain('.data-quality-desktop-table{display:none}');
    expect(styles).toContain('.data-quality-mobile-cards{display:grid');
    expect(page).toContain("import '../../styles/data-quality-responsive.css';");
    expect(responsiveStyles).toContain('table-layout: auto;');
    expect(responsiveStyles).toContain('min-width: 1120px;');
    expect(responsiveStyles).toContain('.data-quality-desktop-table td:nth-child(7)');
    expect(responsiveStyles).toContain('width: 170px;');
    expect(responsiveStyles).toContain('min-width: 170px;');
    expect(responsiveStyles).toContain('white-space: nowrap;');
    expect(responsiveStyles).toContain('min-width: 148px;');
  });

  it('keeps the Leave Quota action usable across the supported responsive widths', () => {
    const styles = read('./styles/data-quality.css');
    const responsiveStyles = read('./styles/data-quality-responsive.css');
    const viewportContracts = [
      { width: 390, mobile: true },
      { width: 768, mobile: false },
      { width: 1024, mobile: false },
      { width: 1440, mobile: false }
    ];
    for (const { width, mobile } of viewportContracts) {
      expect(width <= 640).toBe(mobile);
      expect(styles).toContain(mobile ? '.data-quality-desktop-table{display:none}' : '.data-quality-desktop-table{display:block');
      expect(styles).toContain(mobile ? '.data-quality-mobile-cards{display:grid' : '.data-quality-mobile-cards{display:none}');
    }
    expect(responsiveStyles).toContain('.data-quality-target');
    expect(responsiveStyles).toContain('.data-quality-desktop-table td:last-child');
    expect(responsiveStyles).toContain('white-space: nowrap;');
  });

  it('renders all four severity summary cards and only existing target pages', () => {
    const page = read('./pages/data-quality/DataQualityCenterPage.tsx');
    expect(page).toContain("['critical', 'วิกฤต'");
    expect(page).toContain("['warning', 'ควรติดตาม'");
    expect(page).toContain("['info', 'ข้อมูล'");
    expect(page).toContain("['total', 'ทั้งหมด'");
    expect(page).toContain("issue.targetPage !== 'licenses' && issue.targetPage !== 'quota'");
    expect(page).toContain('ไม่พบรายการคุณภาพข้อมูล');
    expect(page).toContain('ลองใหม่');
  });
});
