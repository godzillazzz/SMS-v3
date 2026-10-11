import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('CFG-01 Configuration Center shell contract', () => {
  const main = read('main.tsx');
  const settingsPage = read('pages/settings/SettingsPage.tsx');
  const routing = read('routing.ts');
  const registry = read('components/ConfigurationRegistryPanel.tsx');
  const api = read('api.ts');

  it('keeps Settings ADMIN-only and routes each Thai settings section to its own nested page', () => {
    expect(routing).toContain("if (page === 'settings') return auth.user?.role === 'ADMIN'");
    expect(routing).toContain("settings: '/app/settings/overview'");
    for (const section of ['overview', 'attendance-location', 'leave-policy', 'leave-types', 'auto-schedule', 'departments-positions', 'approval-permissions', 'data-retention', 'notifications']) {
      expect(routing).toContain(`path: '${section}'`);
      expect(settingsPage).toContain(`section === '${section}'`);
    }
    expect(settingsPage).toContain('title={currentSection.label}');
    expect(settingsPage).toContain('aria-label="หมวดตั้งค่าระบบ"');
    expect(settingsPage).toContain('{sectionContent}');
    expect(settingsPage).toContain('<ConfigurationRegistryPanel settings={settings} />');
    expect(settingsPage).toContain('<AttendancePolicySettingsCard settings={settings} onSave={onSaveAttendancePolicy} onRefresh={onRefresh} />');
    expect(settingsPage).toContain('ตั้งค่าการแจ้งเตือน LINE');
    expect(main).toContain('onSectionChange={setSettingsSection}');
  });

  it('shows current values and validation ranges while keeping raw keys in collapsed technical details', () => {
    expect(registry).toContain('ค่าปัจจุบัน');
    expect(registry).toContain('ช่วง / ตัวเลือก');
    expect(registry).toContain('รายละเอียดทางเทคนิค');
    expect(registry).toContain('<details className="configuration-setting-technical">');
    expect(registry).toContain('key ที่ยังไม่ได้ register จะไม่สามารถสร้างหรือแก้ผ่าน API ตั้งค่าระบบได้');
    expect(registry).toContain('ใช้ค่าเริ่มต้น');
    expect(registry).toContain("if (typeof row.key === 'string' && row.key in knownDefaults)");
    expect(registry).not.toMatch(/<input[^>]+name=["']key["']/i);
    expect(registry).not.toMatch(/เพิ่ม.*key/i);
  });

  it('exports only registered configured values and keeps central SystemSetting API signatures unchanged', () => {
    expect(settingsPage).toContain("setting.registryStatus === 'REGISTERED' && Boolean(setting.configured)");
    expect(settingsPage).toContain("downloadCsv(exportableSettings, 'smsv3-governed-settings')");
    expect(api).toContain("systemSettings: (token: string) => call('/system-settings'");
    expect(api).toContain("updateSystemSetting: (token: string, key: string, data: unknown) => call(`/system-settings/");
  });

  it('states that secrets and operational authority are outside the SystemSetting control plane', () => {
    expect(settingsPage).toContain('ส่วน secret และสิทธิ์เชิงปฏิบัติการแยกจาก SystemSetting');
    expect(registry).toContain('ไม่แสดงค่า secret และไม่ใช่หน้าควบคุม deployment');
    expect(registry).toContain('ค่าเดิม · อ่านอย่างเดียว');
    expect(registry).toContain('อยู่ภายใต้ขั้นตอนกำกับ');
  });
});
