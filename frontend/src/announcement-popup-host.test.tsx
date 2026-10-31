// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnnouncementPopupHost } from './pages/announcements/AnnouncementPopupHost';
import { AnnouncementHomeCard } from './pages/announcements/AnnouncementHomeCard';
import { popupSnoozeKey } from './pages/announcements/announcement-popup-model';
import type { Announcement } from './pages/announcements/announcement-client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ''; vi.useRealTimers(); });

const row = (id: string, over: Partial<Announcement> = {}): Announcement => ({ id, title: `หัวข้อ ${id}`, body: 'เนื้อหา', category: 'GENERAL', pinned: false, showPopup: true, expiresAt: null, expiresOn: null, expired: false, createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z', ...over });
function memory() { const values = new Map<string, string>(); return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } }; }
async function mount(node: React.ReactElement) {
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(node); });
  await act(async () => { await Promise.resolve(); });
}

describe('announcement pop-up after login', () => {
  it('shows one aria-modal dialog that pages through several announcements', async () => {
    const client = { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), popups: vi.fn().mockResolvedValue([row('a'), row('b', { pinned: true })]) };
    await mount(<AnnouncementPopupHost token="t" userId="u1" client={client} storage={memory()} />);
    const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].textContent).toContain('หัวข้อ b');
    expect(dialogs[0].textContent).toContain('1 / 2');
    const next = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('ถัดไป'))!;
    await act(async () => next.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('หัวข้อ a');
  });

  it('Esc closes; "ไม่แสดงอีก 7 วัน" stores per-user keys', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-31T05:00:00Z'));
    const storage = memory();
    const client = { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), popups: vi.fn().mockResolvedValue([row('a')]) };
    await mount(<AnnouncementPopupHost token="t" userId="u1" client={client} storage={storage} />);
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(storage.values.size).toBe(0);
    act(() => root?.unmount()); root = undefined;
    await mount(<AnnouncementPopupHost token="t" userId="u1" client={client} storage={storage} />);
    const snooze = [...document.querySelectorAll('button')].find((b) => b.textContent === 'ไม่แสดงอีก 7 วัน')!;
    await act(async () => snooze.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(Number(storage.values.get(popupSnoozeKey('u1', row('a'))))).toBe(Date.parse('2026-10-31T05:00:00Z') + 7 * 86400000);
  });

  it('renders nothing when there are no pop-up announcements or the request fails', async () => {
    const client = { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), popups: vi.fn().mockRejectedValue(new Error('x')) };
    await mount(<AnnouncementPopupHost token="t" userId="u1" client={client} storage={memory()} />);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('home card lists latest announcements', async () => {
    const client = { list: vi.fn().mockResolvedValue([row('a', { pinned: true }), row('b')]), create: vi.fn(), update: vi.fn(), remove: vi.fn() };
    await mount(<AnnouncementHomeCard token="t" client={client} onOpenAll={vi.fn()} />);
    expect(document.body.textContent).toContain('ประกาศล่าสุด');
    expect(document.querySelectorAll('.announcement-home-row')).toHaveLength(2);
    expect(document.body.textContent).toContain('ดูทั้งหมด');
  });

  it('wires the pop-up host for every signed-in session and keeps the PWA bottom nav at 5 buttons', () => {
    const main = readFileSync(join(__dirname, 'main.tsx'), 'utf8');
    expect(main).toMatch(/<AnnouncementPopupHost token=\{auth\.token\} userId=\{auth\.user\.id\}/);
    expect(main).toMatch(/homeFooter=\{pwaShell \? <React\.Suspense fallback=\{null\}><AnnouncementHomeCard/);
    const nav = main.slice(main.indexOf('<nav className="pwa-bottom-nav"'), main.indexOf('</nav>', main.indexOf('<nav className="pwa-bottom-nav"')));
    expect(nav.match(/<button /g)).toHaveLength(5);
  });
});
