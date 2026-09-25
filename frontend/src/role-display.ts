export const ROLE_DISPLAY_LABEL: Record<string, string> = {
  ADMIN: 'ADMIN',
  MANAGER: 'Supervisor',
  SUPERVISOR: 'Manager',
  VIEWER: 'VIEWER'
};

export const ROLE_MANAGEMENT_LABEL: Record<string, string> = {
  ADMIN: 'ผู้ดูแลระบบ',
  MANAGER: 'Supervisor',
  SUPERVISOR: 'Manager',
  VIEWER: 'ผู้ใช้งาน'
};

export function roleDisplayName(role?: unknown, fallback = 'ไม่ระบุบทบาท') {
  const value = String(role || '').trim();
  if (!value) return fallback;
  return ROLE_DISPLAY_LABEL[value] || value;
}
