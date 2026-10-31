// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OperationsTodayPanel, type OperationsToday } from './components/dashboard/OperationsTodayPanel';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ''; });

const data: OperationsToday = {
  date: '2026-10-31', planned: 48, checkedIn: 42, lateNotCheckedIn: 3, assistOtherSite: 2, onLeave: 1, graceMinutes: 15,
  patrol: { scanned: 8, total: 12, round: 1, roundStart: '2026-10-31T00:00:00.000Z', roundEnd: '2026-10-31T03:00:00.000Z', incompleteDepartments: [{ department: 'C', missing: 4 }] },
  pendingLeave: 2,
  sites: [
    { id: 'b', name: 'ไซต์ B', planned: 15, checkedIn: 12, late: 3, status: 'URGENT' },
    { id: 'c', name: 'ไซต์ C', planned: 15, checkedIn: 12, late: 0, status: 'WATCH' },
    { id: 'a', name: 'ไซต์ A', planned: 18, checkedIn: 18, late: 0, status: 'NORMAL' }
  ],
  actions: [
    { type: 'LATE_NOT_CHECKED_IN', severity: 'URGENT', title: 'ยังไม่เช็กอินเลยเวลา', detail: 'ไซต์ B · เกินเวลาเริ่มกะ', count: 3, unit: 'คน', target: 'attendanceSupervisor' },
    { type: 'PATROL_INCOMPLETE', severity: 'WATCH', title: 'จุดตรวจยังไม่ครบในรอบนี้', detail: 'C · เหลือ 4 จุด', count: 4, unit: 'จุด', target: 'patrolCenter' },
    { type: 'LEAVE_PENDING', severity: 'INFO', title: 'คำขอลารออนุมัติ', detail: 'ตรวจสอบก่อนจัดกำลัง', count: 2, unit: 'รายการ', target: 'leavePending' }
  ],
  partialErrors: [], siteId: null, siteOptions: [{ id: 'a', name: 'ไซต์ A' }, { id: 'b', name: 'ไซต์ B' }], generatedAt: '2026-10-31T02:30:00.000Z'
};

async function mount(node: React.ReactElement) {
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(node); });
  return host;
}

describe('batch12 B dashboard ภาพรวมวันนี้', () => {
  it('renders mockup KPIs, actions, site status and site filter from real data', async () => {
    const el = await mount(<OperationsTodayPanel data={data} loading={false} siteId="" onSiteChange={vi.fn()} onNavigate={vi.fn()} announcements={<div>ประกาศล่าสุด</div>} />);
    expect(el.textContent).toContain('ภาพรวมวันนี้');
    expect(el.textContent).toContain('วันนี้มีพนักงานตามแผน 48 คน ใน 3 จุดปฏิบัติงาน');
    const kpis = [...el.querySelectorAll('.ops-kpi')].map((node) => node.textContent);
    expect(kpis[0]).toContain('เข้างานแล้ว'); expect(kpis[0]).toContain('42'); expect(kpis[0]).toContain('/ 48 คน');
    expect(kpis[1]).toContain('ยังไม่เช็กอินเลยเวลา'); expect(kpis[1]).toContain('3');
    expect(kpis[2]).toContain('รอบตรวจปัจจุบัน'); expect(kpis[2]).toContain('8'); expect(kpis[2]).toContain('/ 12 จุด'); expect(kpis[2]).toContain('07:00–10:00');
    expect(kpis[3]).toContain('ช่วยต่าง Site วันนี้'); expect(kpis[3]).toContain('2');
    expect(el.textContent).toContain('ต้องจัดการตอนนี้');
    expect(el.querySelector('.ops-actions .ops-badge')?.textContent).toBe('3 เรื่อง');
    expect(el.textContent).toContain('เร่งด่วน · 3 คน');
    expect(el.textContent).toContain('สถานะราย Site');
    expect([...el.querySelectorAll('.ops-site .ops-badge')].map((node) => node.textContent)).toEqual(['เร่งด่วน', 'เฝ้าระวัง', 'ปกติ']);
    expect(el.textContent).toContain('เข้างาน 12/15 · รอติดตาม 3 คน');
    expect(el.textContent).toContain('ประกาศล่าสุด');
    expect(el.querySelector<HTMLSelectElement>('select[aria-label="จุดปฏิบัติงาน"]')?.options[0].textContent).toBe('ทุกจุดปฏิบัติงาน');
  });

  it('never shows 0 for failed sources; shows — and a warning', async () => {
    const el = await mount(<OperationsTodayPanel data={{ ...data, planned: null, checkedIn: null, lateNotCheckedIn: null, assistOtherSite: null, patrol: null, sites: [], partialErrors: ['attendance', 'patrol'] }} loading={false} siteId="" onSiteChange={vi.fn()} onNavigate={vi.fn()} />);
    const kpis = [...el.querySelectorAll('.ops-kpi strong')].map((node) => node.textContent?.trim());
    expect(kpis.every((value) => value?.startsWith('—'))).toBe(true);
    expect(el.textContent).toContain('ข้อมูลบางส่วนไม่พร้อม');
  });

  it('actions deep-link to the right pages and filter change is reported', async () => {
    const onNavigate = vi.fn(); const onSiteChange = vi.fn();
    const el = await mount(<OperationsTodayPanel data={data} loading={false} siteId="" onSiteChange={onSiteChange} onNavigate={onNavigate} />);
    await act(async () => el.querySelector<HTMLButtonElement>('.ops-action-row')!.click());
    expect(onNavigate).toHaveBeenCalledWith('attendanceSupervisor');
    const select = el.querySelector<HTMLSelectElement>('select[aria-label="จุดปฏิบัติงาน"]')!;
    await act(async () => { select.value = 'b'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(onSiteChange).toHaveBeenCalledWith('b');
  });

  it('dashboard page mounts the panel for executives and keeps label fonts >= 12px', () => {
    const page = readFileSync(join(__dirname, 'pages/dashboard/DashboardPage.tsx'), 'utf8');
    expect(page).toContain('<OperationsTodaySection');
    expect(page).toContain('AnnouncementHomeCard');
    const css = readFileSync(join(__dirname, 'components/dashboard/operations-today.css'), 'utf8');
    for (const match of css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) expect(Number(match[1])).toBeGreaterThanOrEqual(12);
  });
});
