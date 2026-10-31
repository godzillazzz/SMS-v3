// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DisplaySettingsPanel } from './components/DisplaySettingsPanel';
import { SETTINGS_SECTIONS, settingsSectionFromPath } from './routing';
import { DEFAULT_UI_PALETTE } from './ui-palette';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; });

function render(node: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('batch12 B display settings (การแสดงผล)', () => {
  it('adds a Thai display section to settings routing', () => {
    const section = SETTINGS_SECTIONS.find((item) => item.id === 'display');
    expect(section?.label).toBe('การแสดงผล');
    expect(settingsSectionFromPath('/app/settings/display')).toBe('display');
  });

  it('renders the mockup structure: 7 colour rows, live preview, contrast status, reset and mode radios', () => {
    const el = render(<DisplaySettingsPanel canEdit palette={DEFAULT_UI_PALETTE} onSave={vi.fn()} />);
    expect(el.querySelectorAll('.display-color-row')).toHaveLength(7);
    expect(el.textContent).toContain('สีของระบบ');
    expect(el.textContent).toContain('ตัวอย่างสด');
    expect(el.textContent).toContain('คืนค่าเริ่มต้น');
    expect(el.textContent).toContain('โหมดการแสดงผล');
    expect(el.textContent).toContain('ผ่านเกณฑ์ contrast 4.5:1');
    expect(el.querySelectorAll('input[name="display-mode"]')).toHaveLength(3);
  });

  it('blocks saving when contrast is below 4.5:1 or HEX is invalid', () => {
    const onSave = vi.fn();
    const el = render(<DisplaySettingsPanel canEdit palette={DEFAULT_UI_PALETTE} onSave={onSave} />);
    const warning = el.querySelector<HTMLInputElement>('#display-color-warning')!;
    setInput(warning, '#FFD166');
    expect(el.textContent).toContain('ความต่างสีน้อยกว่า 4.5:1');
    const save = el.querySelector<HTMLButtonElement>('[data-display-save]')!;
    expect(save.disabled).toBe(true);
    setInput(warning, '#12');
    expect(el.textContent).toContain('รหัส HEX ไม่ถูกต้อง');
    expect(save.disabled).toBe(true);
  });

  it('reset restores defaults and save sends the palette', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const el = render(<DisplaySettingsPanel canEdit palette={{ ...DEFAULT_UI_PALETTE, primary: '#123456' }} onSave={onSave} />);
    act(() => el.querySelector<HTMLButtonElement>('[data-display-reset]')!.click());
    expect(el.querySelector<HTMLInputElement>('#display-color-primary')!.value).toBe('#2563EB');
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-display-save]')!.click(); });
    expect(onSave).toHaveBeenCalledWith(DEFAULT_UI_PALETTE);
  });

  it('non-ADMIN sees a read-only palette without save/reset', () => {
    const el = render(<DisplaySettingsPanel canEdit={false} palette={DEFAULT_UI_PALETTE} onSave={vi.fn()} />);
    expect(el.querySelector('[data-display-save]')).toBeNull();
    expect(el.querySelector('[data-display-reset]')).toBeNull();
    expect(el.querySelector<HTMLInputElement>('#display-color-primary')!.readOnly).toBe(true);
    expect(el.textContent).toContain('เฉพาะผู้ดูแลระบบ');
  });

  it('uses no window.confirm and keeps labels at least 12px', () => {
    const source = readFileSync(join(__dirname, 'components/DisplaySettingsPanel.tsx'), 'utf8');
    const css = readFileSync(join(__dirname, 'styles/display-settings.css'), 'utf8');
    expect(source).not.toMatch(/window\.confirm|\bconfirm\(/);
    for (const match of css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) expect(Number(match[1])).toBeGreaterThanOrEqual(12);
  });
});
