export const ROLE_DISPLAY_LABEL: Record<string, string> = {
  ADMIN: 'ผู้ดูแลระบบ',
  MANAGER: 'ผู้จัดการ',
  SUPERVISOR: 'หัวหน้างาน',
  VIEWER: 'ผู้ใช้งาน'
};

export const ROLE_MANAGEMENT_LABEL: Record<string, string> = ROLE_DISPLAY_LABEL;

export function roleDisplayName(role?: unknown, fallback = 'ไม่ระบุบทบาท') {
  const value = String(role || '').trim();
  if (!value) return fallback;
  return ROLE_DISPLAY_LABEL[value] || value;
}
