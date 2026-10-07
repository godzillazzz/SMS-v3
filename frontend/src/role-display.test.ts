import { describe, expect, it } from 'vitest';
import { ROLE_DISPLAY_LABEL, ROLE_MANAGEMENT_LABEL, roleDisplayName } from './role-display';

describe('role display compatibility mapping', () => {
  it('uses established Thai labels for manager and supervisor roles', () => {
    expect(ROLE_DISPLAY_LABEL.MANAGER).toBe('หัวหน้างาน');
    expect(ROLE_DISPLAY_LABEL.SUPERVISOR).toBe('ผู้จัดการ');
    expect(roleDisplayName('MANAGER')).toBe('หัวหน้างาน');
    expect(roleDisplayName('SUPERVISOR')).toBe('ผู้จัดการ');
  });

  it('uses Thai labels for admin and viewer roles', () => {
    expect(roleDisplayName('ADMIN')).toBe('ผู้ดูแลระบบ');
    expect(roleDisplayName('VIEWER')).toBe('ผู้ใช้งาน');
    expect(ROLE_MANAGEMENT_LABEL.ADMIN).toBe('ผู้ดูแลระบบ');
    expect(ROLE_MANAGEMENT_LABEL.VIEWER).toBe('ผู้ใช้งาน');
  });
});
