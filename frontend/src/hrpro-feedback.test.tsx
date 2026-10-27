// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AVATAR_TONE_COUNT, avatarTone } from './avatar';
import { TOAST_DURATION_MS, showToast } from './toast';
import { ToastHost } from './components/ToastHost';

const read = (name: string) => fs.readFileSync(path.join(__dirname, name), 'utf8').replace(/\r\n/g, '\n');

describe('name avatars (8 colours, fixed per person)', () => {
  it('is stable per key and spreads across all 8 tones', () => {
    expect(avatarTone('EMP-001')).toBe(avatarTone('emp-001 '));
    const tones = new Set(Array.from({ length: 200 }, (_, index) => avatarTone(`EMP-${index}`)));
    expect(AVATAR_TONE_COUNT).toBe(8);
    expect(tones.size).toBe(8);
    for (const tone of tones) expect(tone).toBeGreaterThanOrEqual(0);
  });

  it('is applied in the employee table, licenses, users, audit log, PWA profile and shell', () => {
    expect(read('components/personnel/PersonnelTable.tsx')).toContain('data-avatar-tone={avatarTone(employee.employeeCode || employee.id)}');
    expect(read('pages/access-management/AccessManagementPage.tsx')).toContain('data-avatar-tone={avatarTone(account.id)}');
    expect(read('components/audit/AuditTable.tsx')).toContain('data-avatar-tone={avatarTone(row.actor?.id)}');
    expect(read('pages/pwa-profile/PwaProfilePage.tsx')).toContain('data-avatar-tone={avatarTone(user?.id)}');
    const main = read('main.tsx');
    expect(main).toContain('data-avatar-tone={avatarTone(employee.employeeCode || employee.id)}');
    expect(main).toContain('avatarTone={avatarTone(auth.user?.id)}');
    expect(main).not.toContain('% 5}');
    const css = read('styles/hrpro-shell.css');
    for (let tone = 0; tone < 8; tone += 1) expect(css).toContain(`[data-avatar-tone="${tone}"]`);
  });
});

describe('toasts', () => {
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

  it('auto-dismisses after 5 seconds', () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<ToastHost />));
    act(() => { showToast('บันทึกข้อมูลเรียบร้อยแล้ว'); });
    expect(document.body.textContent).toContain('บันทึกข้อมูลเรียบร้อยแล้ว');
    act(() => { vi.advanceTimersByTime(TOAST_DURATION_MS - 100); });
    expect(document.body.textContent).toContain('บันทึกข้อมูลเรียบร้อยแล้ว');
    act(() => { vi.advanceTimersByTime(200); });
    expect(document.body.textContent).not.toContain('บันทึกข้อมูลเรียบร้อยแล้ว');
    act(() => root.unmount());
  });

  it('reports generic save and delete outcomes', () => {
    const main = read('main.tsx');
    expect(TOAST_DURATION_MS).toBe(5000);
    expect(main).toContain("showToast('บันทึกข้อมูลเรียบร้อยแล้ว')");
    expect(main).toContain("showToast(action === 'delete' ? 'ลบรายการเรียบร้อยแล้ว' : 'ดำเนินการเรียบร้อยแล้ว')");
    expect(main).toContain('<ToastHost />');
  });
});

describe('confirm before delete', () => {
  it('never uses the native browser confirm', () => {
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path.join(dir, entry.name)] : []);
    for (const file of walk(__dirname)) expect(fs.readFileSync(file, 'utf8'), file).not.toMatch(/\b(window|globalThis|self)\.confirm\(/);
  });

  it('routes row deletes through the styled confirm dialog', () => {
    const main = read('main.tsx');
    const handler = main.slice(main.indexOf("title: action === 'delete' ? 'ยืนยันลบรายการ'") - 400, main.indexOf("await api.deleteLicense("));
    expect(handler).toContain('await actionDialog.confirm({');
    expect(handler).toContain('if (!confirmed) return;');
  });
});
