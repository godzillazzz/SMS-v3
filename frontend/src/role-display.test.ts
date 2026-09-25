import { describe, expect, it } from 'vitest';
import { ROLE_DISPLAY_LABEL, ROLE_MANAGEMENT_LABEL, roleDisplayName } from './role-display';

describe('role display compatibility mapping', () => {
  it('renames current Manager to Supervisor and current Supervisor to Manager', () => {
    expect(ROLE_DISPLAY_LABEL.MANAGER).toBe('Supervisor');
    expect(ROLE_DISPLAY_LABEL.SUPERVISOR).toBe('Manager');
    expect(roleDisplayName('MANAGER')).toBe('Supervisor');
    expect(roleDisplayName('SUPERVISOR')).toBe('Manager');
  });

  it('keeps Admin and Viewer labels unchanged', () => {
    expect(roleDisplayName('ADMIN')).toBe('ADMIN');
    expect(roleDisplayName('VIEWER')).toBe('VIEWER');
    expect(ROLE_MANAGEMENT_LABEL.ADMIN).toBe('ผู้ดูแลระบบ');
    expect(ROLE_MANAGEMENT_LABEL.VIEWER).toBe('ผู้ใช้งาน');
  });
});
