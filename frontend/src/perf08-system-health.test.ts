import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('PERF-08 Admin Performance & System Health contract', () => {
  const main = read('main.tsx');
  const api = read('api.ts');
  const client = read('system-health-client.ts');
  const page = read('pages/system-health/SystemHealthPage.tsx');

  it('adds an explicit ADMIN-only Performance & System Health navigation surface', () => {
    expect(main).toContain("'systemHealth'");
    expect(main).toContain("{ id: 'systemHealth', icon: 'dashboard', label: 'Performance & System Health' }");
    expect(main).toContain("if (page === 'systemHealth') return auth.user?.role === 'ADMIN'");
    expect(main).toContain("if (activePage === 'systemHealth' && auth.token) return <SystemHealthPage token={auth.token} />");
  });

  it('uses a dedicated read-only client without modifying the locked central API source', () => {
    expect(client).toContain("${baseUrl}/admin/system-health");
    expect(client).toContain("method: 'GET'");
    expect(client).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
    expect(api).not.toContain('systemHealth:');
  });

  it('labels telemetry scope honestly and does not claim global SLA metrics', () => {
    expect(page).toContain('CURRENT_RUNTIME_INSTANCE');
    expect(page).toContain('rolling runtime samples');
    expect(page).toContain('ไม่ใช่ global SLA');
    expect(page).toContain('ไม่มี query string, payload, request ID หรือข้อมูลผู้ใช้');
  });

  it('does not expose deployment, migration, environment mutation controls', () => {
    expect(page).toContain('Endpoint นี้เป็น read-only');
    expect(page).not.toMatch(/onClick=.*deploy/i);
    expect(page).not.toMatch(/onClick=.*migration/i);
    expect(page).not.toMatch(/onClick=.*environment/i);
    expect(page).not.toContain('api.update');
    expect(page).not.toContain('api.create');
    expect(page).not.toContain('api.delete');
  });
});
