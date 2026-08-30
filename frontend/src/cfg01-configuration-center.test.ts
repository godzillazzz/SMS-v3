import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('CFG-01 Configuration Center shell contract', () => {
  const main = read('main.tsx');
  const registry = read('components/ConfigurationRegistryPanel.tsx');
  const api = read('api.ts');

  it('keeps Settings ADMIN-only while presenting the Configuration Center shell', () => {
    expect(main).toContain("if (page === 'settings') return auth.user?.role === 'ADMIN'");
    expect(main).toContain('<h1>Configuration Center</h1>');
    expect(main).toContain('<ConfigurationRegistryPanel settings={settings} />');
    expect(main).toContain('<AttendancePolicySettingsCard settings={settings} onSave={onSaveAttendancePolicy} onRefresh={onRefresh} />');
    expect(main).toContain('LINE Notification Settings');
  });

  it('shows governance domains, registry status and authority without generic arbitrary-key editor controls', () => {
    expect(registry).toContain('Configuration Registry');
    expect(registry).toContain('Legacy read-only');
    expect(registry).toContain('Protected');
    expect(registry).toContain('Authority');
    expect(registry).toContain('key ที่ยังไม่ได้ register จะไม่สามารถสร้างหรือแก้ผ่าน SystemSetting API ได้');
    expect(registry).not.toMatch(/<input[^>]+name=["']key["']/i);
    expect(registry).not.toMatch(/เพิ่ม.*key/i);
  });

  it('exports only registered configured values and keeps central SystemSetting API signatures unchanged', () => {
    expect(main).toContain("setting.registryStatus === 'REGISTERED' && Boolean(setting.configured)");
    expect(main).toContain("downloadCsv(exportableSettings, 'smsv3-governed-settings')");
    expect(api).toContain("systemSettings: (token: string) => call('/system-settings'");
    expect(api).toContain("updateSystemSetting: (token: string, key: string, data: unknown) => call(`/system-settings/");
  });

  it('states that secrets and operational authority are outside the SystemSetting control plane', () => {
    expect(main).toContain('แยก secret/operational authority ออกจาก SystemSetting อย่างชัดเจน');
    expect(registry).toContain('secret และ operational settings เป็น read-only หรือใช้ protected workflow เท่านั้น');
    expect(registry).toContain('Registry นี้ไม่ใช่ secret store และไม่ใช่ deployment control plane');
  });
});
