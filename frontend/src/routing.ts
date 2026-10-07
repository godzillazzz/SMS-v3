export const ROUTE_CHANGE_EVENT = 'sms-v3:route-change';

export const PAGE_PATHS = {
  dashboard: '/app',
  employees: '/app/employees',
  licenses: '/app/licenses',
  attendance: '/app/time-clock',
  attendanceSupervisor: '/app/attendance',
  attendanceDevice: '/app/devices',
  attendanceHistory: '/app/time-clock/history',
  employeeSchedule: '/app/time-clock/schedule',
  profile: '/app/profile',
  schedule: '/app/roster',
  approvals: '/app/roster/approvals',
  shiftSetup: '/app/shift-codes',
  users: '/app/users',
  securitySite: '/app/sites',
  leave: '/app/leave',
  leavePending: '/app/leave/approvals',
  leaveHistory: '/app/leave/history',
  quota: '/app/leave/quotas',
  approvalCenter: '/app/approvals',
  rules: '/app/rules',
  audit: '/app/audit',
  dataQuality: '/app/data-quality',
  systemHealth: '/app/system-health',
  reportCenter: '/app/reports',
  reports: '/app/reports/details',
  executiveReport: '/app/reports/executive',
  attendanceReport: '/app/reports/attendance',
  settings: '/app/settings/overview'
} as const;

export type RoutePage = keyof typeof PAGE_PATHS;
export type RouteResolution = { kind: 'page'; page: RoutePage } | { kind: 'not-found'; pathname: string };

export const SETTINGS_SECTIONS = [
  { id: 'overview', path: 'overview', label: 'ภาพรวม', description: 'สถานะและรายการค่าที่ระบบเปิดให้ดูแล' },
  { id: 'attendance-location', path: 'attendance-location', label: 'การลงเวลาและตำแหน่ง', description: 'นโยบายเวลา GPS และตำแหน่ง' },
  { id: 'leave-policy', path: 'leave-policy', label: 'นโยบายการลา', description: 'ค่าเริ่มต้นและเงื่อนไขคำขอลา' },
  { id: 'leave-types', path: 'leave-types', label: 'ประเภทการลา', description: 'ชื่อและสถานะประเภทการลา' },
  { id: 'auto-schedule', path: 'auto-schedule', label: 'รูปแบบจัดกะอัตโนมัติ', description: 'รูปแบบและลำดับการจัดกะ' },
  { id: 'departments-positions', path: 'departments-positions', label: 'หน่วยงานและตำแหน่ง', description: 'ข้อมูลหน่วยงานและตำแหน่งที่ใช้ในระบบ' },
  { id: 'approval-permissions', path: 'approval-permissions', label: 'สิทธิ์อนุมัติ', description: 'ผู้ตรวจคำขอและเกณฑ์เวลาอนุมัติ' },
  { id: 'data-retention', path: 'data-retention', label: 'การเก็บรักษาข้อมูล', description: 'ระยะเวลาเก็บข้อมูลภายใต้ขั้นตอนกำกับ' },
  { id: 'notifications', path: 'notifications', label: 'การแจ้งเตือน', description: 'ช่องทางและข้อความแจ้งเตือน' }
] as const;

export type SettingsSectionId = typeof SETTINGS_SECTIONS[number]['id'];
const SETTINGS_BASE_PATH = '/app/settings';
const SETTINGS_SECTION_BY_PATH = new Map<string, SettingsSectionId>(SETTINGS_SECTIONS.map(({ id, path }) => [`${SETTINGS_BASE_PATH}/${path}`, id]));

export function settingsSectionFromPath(pathname: string): SettingsSectionId {
  return SETTINGS_SECTION_BY_PATH.get(normalizePath(pathname)) ?? 'overview';
}

export function settingsSectionPath(section: SettingsSectionId): string {
  const definition = SETTINGS_SECTIONS.find((item) => item.id === section)!;
  return `${SETTINGS_BASE_PATH}/${definition.path}`;
}

export function navigateSettingsSection(section: SettingsSectionId, options: { replace?: boolean; preserveQuery?: boolean } = {}): URL {
  const current = new URL(window.location.href);
  const next = new URL(settingsSectionPath(section), current.origin);
  if (options.preserveQuery !== false) next.search = current.search;
  next.hash = current.hash;
  const target = `${next.pathname}${next.search}${next.hash}`;
  const state = { ...(window.history.state ?? {}), smsPage: 'settings', smsSettingsSection: section };
  if (options.replace) window.history.replaceState(state, '', target);
  else window.history.pushState(state, '', target);
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
  return next;
}

const PAGE_TITLES: Record<RoutePage, string> = {
  dashboard: 'ภาพรวม',
  employees: 'ข้อมูลพนักงาน',
  licenses: 'ใบอนุญาต รปภ.',
  attendance: 'ลงเวลา',
  attendanceSupervisor: 'ลงเวลาแทนพนักงาน',
  attendanceDevice: 'อุปกรณ์ลงเวลา',
  attendanceHistory: 'ประวัติการลงเวลา',
  employeeSchedule: 'ตารางงาน',
  profile: 'โปรไฟล์',
  schedule: 'ตารางกะรายเดือน',
  approvals: 'อนุมัติตารางกะ',
  shiftSetup: 'รหัสกะและเวลา',
  users: 'ผู้ใช้และสิทธิ์',
  securitySite: 'จุดรักษาความปลอดภัย',
  leave: 'คำขอลา',
  leavePending: 'อนุมัติคำขอลา',
  leaveHistory: 'ประวัติการลา',
  quota: 'โควต้าวันลา',
  approvalCenter: 'ศูนย์อนุมัติ',
  rules: 'กฎการทำงาน',
  audit: 'บันทึกการใช้งานระบบ',
  dataQuality: 'คุณภาพข้อมูล',
  systemHealth: 'สถานะระบบ',
  reportCenter: 'รายงานและวิเคราะห์',
  reports: 'รายละเอียดรายงาน',
  executiveReport: 'รายงานผู้บริหาร',
  attendanceReport: 'รายงานการลงเวลา',
  settings: 'ตั้งค่าระบบ'
};

const PATH_PAGES = new Map<string, RoutePage>(Object.entries(PAGE_PATHS).map(([page, path]) => [path, page as RoutePage]));
const PWA_PAGES = new Set<RoutePage>(['attendance', 'attendanceHistory', 'employeeSchedule', 'attendanceDevice', 'leave', 'profile', 'attendanceSupervisor']);

function normalizePath(pathname: string): string {
  if (pathname === '/' || pathname === '/index.html') return '/app';
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export function pageFromPath(pathname: string): RoutePage | null {
  const normalized = normalizePath(pathname);
  if (normalized === SETTINGS_BASE_PATH) return 'settings';
  if (normalized.startsWith(`${SETTINGS_BASE_PATH}/`)) return SETTINGS_SECTION_BY_PATH.has(normalized) ? 'settings' : null;
  return PATH_PAGES.get(normalized) ?? null;
}

export function pageFromLocation(location: Pick<Location, 'pathname' | 'search'> = window.location): RouteResolution {
  const params = new URLSearchParams(location.search);
  if (params.get('pwa') === '1') {
    const requestedPwaPage = params.get('page') as RoutePage | null;
    return { kind: 'page', page: requestedPwaPage && PWA_PAGES.has(requestedPwaPage) ? requestedPwaPage : 'attendance' };
  }
  const page = pageFromPath(location.pathname);
  return page ? { kind: 'page', page } : { kind: 'not-found', pathname: location.pathname };
}

export function pageTitle(page: RoutePage): string {
  return PAGE_TITLES[page];
}

export function updateDocumentTitle(page: RoutePage | null, kind: 'page' | 'not-found' | 'forbidden' = 'page', settingsSection: SettingsSectionId = 'overview'): void {
  const title = kind === 'not-found' ? 'ไม่พบหน้าที่ต้องการ' : kind === 'forbidden' ? 'ไม่มีสิทธิ์เข้าถึง' : page === 'settings' ? SETTINGS_SECTIONS.find((section) => section.id === settingsSection)?.label || pageTitle(page) : page ? pageTitle(page) : 'ระบบจัดการงาน';
  document.title = `${title} | SMS-v3`;
}

export function navigate(page: RoutePage, options: { replace?: boolean; preserveQuery?: boolean; query?: Record<string, string | undefined> } = {}): URL {
  const current = new URL(window.location.href);
  const next = new URL(PAGE_PATHS[page], current.origin);
  if (options.preserveQuery !== false) next.search = current.search;
  next.hash = current.hash;
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === '') next.searchParams.delete(key);
    else next.searchParams.set(key, value);
  }
  const state = { ...(window.history.state ?? {}), smsPage: page };
  const target = `${next.pathname}${next.search}${next.hash}`;
  if (options.replace) window.history.replaceState(state, '', target);
  else window.history.pushState(state, '', target);
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
  return next;
}

export function updateRouteQuery(query: Record<string, string | undefined>, options: { replace?: boolean } = {}): URL {
  const next = new URL(window.location.href);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') next.searchParams.delete(key);
    else next.searchParams.set(key, value);
  }
  const target = `${next.pathname}${next.search}${next.hash}`;
  const state = { ...(window.history.state ?? {}) };
  if (options.replace === false) window.history.pushState(state, '', target);
  else window.history.replaceState(state, '', target);
  return next;
}

export function subscribeToRouteChanges(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(ROUTE_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(ROUTE_CHANGE_EVENT, onChange);
  };
}

export function routeQueryNumber(key: string, fallback = 1, search = window.location.search): number {
  const value = Number(new URLSearchParams(search).get(key));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function routeQueryMonth(search = window.location.search): string | undefined {
  const params = new URLSearchParams(search);
  const value = params.get('month') ?? '';
  if (!/^\d{4}-(0?[1-9]|1[0-2])$/.test(value)) {
    const year = params.get('year') ?? '';
    const legacyMonth = Number(value);
    if (/^\d{4}$/.test(year) && Number.isInteger(legacyMonth) && legacyMonth >= 1 && legacyMonth <= 12) {
      return `${year}-${String(legacyMonth).padStart(2, '0')}`;
    }
    return undefined;
  }
  return /^\d{4}-(0?[1-9]|1[0-2])$/.test(value) ? `${value.slice(0, 4)}-${value.slice(5).padStart(2, '0')}` : undefined;
}

export function canViewRoutePage(page: RoutePage, auth: { user?: { role?: string }; isViewingAs: boolean }): boolean {
  if (page === 'approvalCenter') return ['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(auth.user?.role || '') && !auth.isViewingAs;
  if (page === 'leavePending' || page === 'attendanceSupervisor') return ['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(auth.user?.role || '');
  if (page === 'attendanceReport') return auth.user?.role === 'ADMIN';
  if (page === 'audit') return auth.user?.role === 'ADMIN';
  if (page === 'dataQuality') return auth.user?.role === 'ADMIN';
  if (page === 'systemHealth') return auth.user?.role === 'ADMIN';
  if (page === 'securitySite') return auth.user?.role === 'ADMIN';
  if (page === 'settings') return auth.user?.role === 'ADMIN';
  if (page === 'users') return ['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(auth.user?.role || '');
  if (page === 'quota') return auth.user?.role === 'ADMIN';
  if (['licenses', 'reportCenter', 'reports', 'executiveReport'].includes(page)) return ['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(auth.user?.role || '');
  return true;
}
