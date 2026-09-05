import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) => fs.readFileSync(path.join(__dirname, relativePath), 'utf8').replace(/\r\n/g, '\n');

describe('WAVE 4B System Health route-table responsive contract', () => {
  const page = read('pages/system-health/SystemHealthPage.tsx');
  const styles = read('styles/system-health.css');

  it('uses the shared data-surface shell without changing the read-only health client', () => {
    expect(page).toContain('ResponsiveDataTable');
    expect(page).toContain('DataTableSkeletonRows');
    expect(page).toContain('DataTableSkeletonCards');
    expect(page).toContain('DataTableState');
    expect(page).toContain('ariaLabel="API latency by route template"');
    expect(page).toContain('loadingLabel="กำลังอ่าน runtime samples…"');
    expect(page).toContain('errorLabel="ไม่สามารถอ่าน route samples ได้"');
    expect(page).not.toContain('api.update');
    expect(page).not.toContain('api.create');
    expect(page).not.toContain('api.delete');
  });

  it('retains all route metrics and semantic column headers on desktop', () => {
    expect((page.match(/<th scope="col"/g) ?? []).length).toBe(7);
    for (const label of ['Method', 'Route template', 'Samples', 'p50', 'p95', 'Max', '5xx']) {
      expect(page).toContain(`>${label}</th>`);
    }
    for (const field of ['route.method', 'route.route', 'route.requestCount', 'route.p50Ms', 'route.p95Ms', 'route.maxMs', 'route.serverErrorCount']) {
      expect(page).toContain(field);
    }
  });

  it('keeps loading, empty, and retryable read-only error states explicit', () => {
    expect(page).toContain('DataTableSkeletonRows columnCount={7}');
    expect(page).toContain('DataTableSkeletonCards count={3}');
    expect(page).toContain('variant="empty"');
    expect(page).toContain('variant="error"');
    expect(page).toContain("label: 'ลองใหม่'");
    expect(page).toContain("ลองอ่าน snapshot ใหม่ได้โดยไม่เปลี่ยนข้อมูลระบบ");
  });

  it('provides an equivalent mobile card representation and prevents route clipping', () => {
    expect(page).toContain('system-health-route-cards');
    expect(page).toContain('system-health-route-card');
    expect(styles).toContain('.system-health-route-surface > .data-table-desktop');
    expect(styles).toContain('.system-health-route-surface > .data-table-mobile');
    expect(styles).toContain('overflow-wrap: anywhere');
    expect(styles).toContain('min-width: 760px');
    for (const label of ['Samples', 'p50', 'p95', 'Max']) {
      expect(page).toContain(`<dt>${label}</dt>`);
    }
  });
});
