// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnnouncementsPage } from './pages/announcements/AnnouncementsPage';
import { ANNOUNCEMENT_CATEGORY_LABELS, announcementDateLabel, type Announcement } from './pages/announcements/announcement-client';
import { PAGE_PATHS, canViewRoutePage, pageFromPath, pageTitle } from './routing';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; document.body.innerHTML = ''; });

const rows: Announcement[] = [
  { id: 'a1', title: 'แนวทางการส่งมอบเวร', body: 'โปรดตรวจสอบรายการส่งมอบ <script>x</script>', category: 'POLICY', pinned: true, expiresAt: null, expiresOn: null, expired: false, createdAt: '2026-10-12T02:00:00.000Z', updatedAt: null },
  { id: 'a2', title: 'แจ้งกำหนดตรวจอุปกรณ์', body: 'เตรียมอุปกรณ์', category: 'GENERAL', pinned: false, expiresAt: '2026-11-01T17:00:00.000Z', expiresOn: '2026-11-01', expired: false, createdAt: '2026-10-10T02:00:00.000Z', updatedAt: null },
  { id: 'a3', title: 'กิจกรรมอบรมประจำเดือน', body: 'พบกันในกิจกรรม', category: 'EVENT', pinned: false, expiresAt: null, expiresOn: null, expired: false, createdAt: '2026-10-08T02:00:00.000Z', updatedAt: null }
];

function client(overrides: Record<string, unknown> = {}) {
  return { list: vi.fn().mockResolvedValue(rows), create: vi.fn().mockResolvedValue(rows[0]), update: vi.fn().mockResolvedValue(rows[0]), remove: vi.fn().mockResolvedValue({ id: 'a1', deleted: true }), ...overrides };
}

async function render(node: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(node); });
  return host;
}

const buttons = (el: ParentNode, text: string) => [...el.querySelectorAll('button')].filter((button) => button.textContent?.trim() === text);

describe('batch12 B announcements page', () => {
  it('has a Thai route visible to every signed-in role', () => {
    expect(PAGE_PATHS.announcements).toBe('/app/announcements');
    expect(pageFromPath('/app/announcements')).toBe('announcements');
    expect(pageTitle('announcements')).toBe('ประกาศ');
    expect(canViewRoutePage('announcements', { user: { role: 'VIEWER' }, isViewingAs: false })).toBe(true);
  });

  it('renders mockup layout: heading, category tabs, cards with pinned badge and plain-text body', async () => {
    const el = await render(<AnnouncementsPage token="t" role="ADMIN" client={client()} />);
    expect(el.querySelector('h1')?.textContent).toBe('ประกาศ');
    expect(el.textContent).toContain('ข่าวสารและข้อมูลสำคัญสำหรับทีมปฏิบัติงาน');
    expect([...el.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(['ทั้งหมด', 'ทั่วไป', 'นโยบาย', 'กิจกรรม']);
    expect(el.querySelectorAll('.announcement-card')).toHaveLength(3);
    expect(el.querySelector('.announcement-card')?.textContent).toContain('ปักหมุด');
    expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toContain('หมดอายุ');
    expect(ANNOUNCEMENT_CATEGORY_LABELS.POLICY).toBe('นโยบาย');
    expect(announcementDateLabel('2026-10-12T02:00:00.000Z')).toMatch(/12 ต\.ค\. 2569/);
  });

  it('filters by category tab', async () => {
    const el = await render(<AnnouncementsPage token="t" role="VIEWER" client={client()} />);
    const tab = [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((item) => item.textContent === 'กิจกรรม')!;
    await act(async () => tab.click());
    expect(el.querySelectorAll('.announcement-card')).toHaveLength(1);
    expect(tab.getAttribute('aria-selected')).toBe('true');
  });

  it('non-ADMIN sees no compose/edit/delete actions', async () => {
    const el = await render(<AnnouncementsPage token="t" role="MANAGER" client={client()} />);
    expect(el.textContent).not.toContain('เขียนประกาศ');
    expect(buttons(el, 'แก้ไข')).toHaveLength(0);
    expect(buttons(el, 'ลบ')).toHaveLength(0);
    expect(buttons(el, 'ดู').length).toBe(3);
  });

  it('ADMIN delete goes through the action dialog, never window.confirm', async () => {
    const api = client();
    const confirmSpy = vi.spyOn(window, 'confirm');
    const el = await render(<AnnouncementsPage token="t" role="ADMIN" client={api} />);
    await act(async () => buttons(el, 'ลบ')[0].click());
    const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]');
    expect(dialog?.textContent).toContain('ลบประกาศ');
    const confirm = document.querySelector<HTMLButtonElement>('[data-action-dialog-confirm]')!;
    await act(async () => confirm.click());
    expect(api.remove).toHaveBeenCalledWith('t', 'a1');
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('ADMIN compose form submits a validated payload', async () => {
    const api = client();
    const el = await render(<AnnouncementsPage token="t" role="ADMIN" client={api} />);
    await act(async () => buttons(el, '+ เขียนประกาศ')[0].click());
    const form = document.querySelector<HTMLFormElement>('form.announcement-form')!;
    const setValue = (selector: string, value: string) => {
      const field = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
      const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await act(async () => { setValue('[name="title"]', 'หัวข้อใหม่'); setValue('[name="body"]', 'เนื้อหา'); });
    await act(async () => { form.requestSubmit(); });
    expect(api.create).toHaveBeenCalledWith('t', { title: 'หัวข้อใหม่', body: 'เนื้อหา', category: 'GENERAL', pinned: false, showPopup: false, expiresOn: null });
  });

  it('shows an error instead of fake data when loading fails', async () => {
    const el = await render(<AnnouncementsPage token="t" role="ADMIN" client={client({ list: vi.fn().mockRejectedValue(new Error('x')) })} />);
    expect(el.textContent).toContain('โหลดประกาศไม่สำเร็จ');
    expect(el.querySelectorAll('.announcement-card')).toHaveLength(0);
  });

  it('keeps label fonts at least 12px and no window.confirm in source', () => {
    const css = readFileSync(join(__dirname, 'pages/announcements/announcements.css'), 'utf8');
    for (const match of css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) expect(Number(match[1])).toBeGreaterThanOrEqual(12);
    const source = readFileSync(join(__dirname, 'pages/announcements/AnnouncementsPage.tsx'), 'utf8');
    expect(source).not.toMatch(/window\.confirm|dangerouslySetInnerHTML/);
  });
});
