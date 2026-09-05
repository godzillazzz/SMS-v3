import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('WAVE 4B Rule Checking responsive data surfaces', () => {
  const main = read('./main.tsx');
  const component = read('./components/RuleCheckingDataSurfaces.tsx');
  const styles = read('./styles/data-surfaces.css');

  it('uses the shared responsive contract while keeping the KPI page and domain handlers in main', () => {
    expect(main).toContain("import { RuleCheckingDataSurfaces } from './components/RuleCheckingDataSurfaces';");
    expect(main).toContain('<RuleCheckingDataSurfaces rules={rules} results={results} violations={violations}');
    expect(main).toContain('handleOperationAction(row, action)');
    expect(component).toContain('ResponsiveDataTable');
    expect(component).toContain('DataTableSkeletonRows');
    expect(component).toContain('DataTableSkeletonCards');
    expect(component).toContain('DataTableState');
    expect(component).toContain('RuleActions');
    expect(component).toContain('result.id');
    expect(component).toContain('result.ruleId');
  });

  it('keeps table semantics and equivalent mobile access to rule and violation data', () => {
    expect(component.match(/scope="col"/g)?.length).toBeGreaterThanOrEqual(10);
    expect(component).toContain('aria-label="ผลตรวจสอบกฎการทำงาน"');
    expect(component).toContain('aria-label="รายการที่ขัดกฎ"');
    expect(component).toContain('rule-checking-mobile-card data-mobile-card');
    expect(component).toContain('item.description');
    expect(component).toContain('item.severity');
    expect(component).toContain('violations.slice(0, 500)');
  });

  it('preserves rule edit/toggle actions and avoids fabricating pagination', () => {
    expect(component).toContain("onAction(rule, 'edit')");
    expect(component).toContain("onAction(rule, 'toggle')");
    expect(component).not.toContain('DataTablePagination');
    expect(component).not.toMatch(/fetch\(|axios|api\./);
  });

  it('contains a bounded desktop table and readable mobile policy', () => {
    expect(styles).toContain('.rule-checking-desktop-table .data-surface-table');
    expect(styles).toContain('overflow-wrap: anywhere;');
    expect(styles).toContain('.rule-checking-responsive-table > .data-table-desktop');
    expect(styles).toContain('.rule-checking-violations-responsive-table > .data-table-mobile');
    expect(styles).toContain('min-height: 40px;');
  });
});
