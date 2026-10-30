import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('./pages/attendance-supervisor/AttendanceSupervisorPage.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./pages/attendance-supervisor/attendance-supervisor-v4.css', import.meta.url), 'utf8');

describe('daily attendance status colors', () => {
  it('marks missing check-in as warning and applies explicit readable text colors', () => {
    expect(page).toContain("['LATE', 'EARLY_OUT', 'WRONG_SHIFT', 'NOT_CHECKED_IN_YET'].includes(status)");
    expect(css).toMatch(/__status\.is-warning\s*\{[^}]*color:\s*#92400e/i);
    expect(css).toMatch(/__status\.is-danger\s*\{[^}]*color:\s*#991b1b/i);
  });
});
