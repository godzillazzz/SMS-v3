import type { SVGProps } from 'react';

export type SmsIconName =
  | 'dashboard' | 'employees' | 'license' | 'calendar' | 'clock' | 'attendance' | 'leave' | 'approval'
  | 'history' | 'quota' | 'shield' | 'audit' | 'quality' | 'users' | 'report' | 'settings'
  | 'bell' | 'search' | 'menu' | 'more' | 'close' | 'logout' | 'sun' | 'moon' | 'system' | 'eye' | 'eyeOff'
  | 'plus' | 'edit' | 'key' | 'pause' | 'check' | 'refresh' | 'location' | 'qr' | 'face' | 'device';

const paths: Record<SmsIconName, React.ReactNode> = {
  dashboard: <><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/></>,
  employees: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
  license: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h6M7 17h4"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  attendance: <><circle cx="9.5" cy="9.5" r="6.5"/><path d="M9.5 6.5v3.5l2.2 1.4M14.5 16.5l2 2 4-4"/></>,
  leave: <><path d="M7 3h10v18H7z"/><path d="M9.5 7h5M9.5 11h5M9.5 15h3"/></>,
  approval: <><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.2 2.2 4.8-5"/></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></>,
  quota: <><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/></>,
  shield: <><path d="M12 3 4.5 6v5.5c0 4.4 3 7.4 7.5 9.5 4.5-2.1 7.5-5.1 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4"/></>,
  audit: <><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
  quality: <><path d="m12 3 2.4 4.9L20 9l-4 3.9.9 5.5L12 15.8 7.1 18.4 8 12.9 4 9l5.6-1.1L12 3Z"/></>,
  users: <><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20a5.5 5.5 0 0 1 11 0M13 20a4 4 0 0 1 8 0"/></>,
  report: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1V21h-4v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4H2v-4h.5a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.5 4.1a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1V2h4v.5a1.7 1.7 0 0 0 1.1 1.6 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.5c.16.37.36.7.6 1 .3.27.65.4 1 .4h1v4h-1a1.7 1.7 0 0 0-1.6 1.1Z"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  close: <><path d="m6 6 12 12M18 6 6 18"/></>,
  logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></>,
  moon: <><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/></>,
  system: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></>,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></>,
  eyeOff: <><path d="M3 3l18 18"/><path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3 3.7M6.1 6.1C3.7 7.7 2.5 12 2.5 12S6 18 12 18c1.8 0 3.4-.5 4.7-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  edit: <><path d="M4 20h4l11-11-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></>,
  key: <><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2 2M14 9l2 2"/></>,
  pause: <><circle cx="12" cy="12" r="9"/><path d="M9.5 8.5v7M14.5 8.5v7"/></>,
  check: <><path d="m5 12.5 4 4L19 7"/></>,
  refresh: <><path d="M20 11a8 8 0 1 0 1 4"/><path d="M20 4v7h-7"/></>,
  location: <><path d="M20 10c0 5.2-8 11-8 11S4 15.2 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
  qr: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M15 14h2v2h-2zM19 14h2v4h-2zM14 19h4v2h-4zM20 20h1v1h-1z"/></>,
  face: <><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/><circle cx="12" cy="11" r="4"/><path d="M9.5 16.5c.8-.7 1.6-1 2.5-1s1.7.3 2.5 1"/></>,
  device: <><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M10 5h4M11 18.5h2"/></>
};

export function SmsIcon({ name, size = 20, ...props }: { name: SmsIconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{paths[name]}</svg>;
}
