import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./attendance-supervisor-v4.css', import.meta.url), 'utf8');
const page = readFileSync(new URL('./AttendanceSupervisorPage.tsx', import.meta.url), 'utf8');

function block(selector: string) {
  const index = css.indexOf(`${selector} {`);
  expect(index, `missing CSS block ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(index, css.indexOf('}', index));
}

function px(rule: string, prop: string) {
  const match = rule.match(new RegExp(`${prop}:\\s*(\\d+(?:\\.\\d+)?)px`));
  return match ? Number(match[1]) : NaN;
}

describe('Attendance detail governance actions readability (owner 2026-10-30)', () => {
  it('renders the ADMIN void action with its own danger class instead of an overridden btn-danger', () => {
    expect(page).toContain('attendance-supervisor-v4__governance-void');
    const rule = block('.attendance-supervisor-v4__governance-actions .attendance-supervisor-v4__governance-void');
    expect(rule).toContain('color: #b42318');
    expect(rule).toContain('background: #fef3f2');
    expect(rule).toContain('border-color: #f4b4ae');
  });

  it('keeps governance button text and the explanatory note at a readable size', () => {
    expect(px(block('.attendance-supervisor-v4__governance-actions button'), 'font-size')).toBeGreaterThanOrEqual(13);
    expect(px(block('.attendance-supervisor-v4__governance-actions small'), 'font-size')).toBeGreaterThanOrEqual(12);
  });

  it('explains the request workflow in plain Thai', () => {
    expect(page).toContain('การกดปุ่มเป็นการส่งคำขอ ยังไม่มีผลกับการลงเวลา จนกว่า ADMIN จะอนุมัติ');
  });
});
