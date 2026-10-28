import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./pages/attendance-supervisor/attendance-supervisor-v4.css', import.meta.url), 'utf8');

describe('Attendance supervisor typography', () => {
  it('keeps operational filters and table text at a readable 12px minimum', () => {
    for (const rule of [
      '.attendance-supervisor-v4__filters label > span {',
      '.attendance-supervisor-v4__filters input,',
      '.attendance-supervisor-v4 th {',
      '.attendance-supervisor-v4 td {',
      '.attendance-supervisor-v4 td strong {',
      '.attendance-supervisor-v4 td small {'
    ]) expect(css).toContain(rule);
    for (const selector of [
      '.attendance-supervisor-v4__filters label > span',
      '.attendance-supervisor-v4__filters input,\n.attendance-supervisor-v4__filters select',
      '.attendance-supervisor-v4 th {\n  color:',
      '.attendance-supervisor-v4 td {\n  color:',
      '.attendance-supervisor-v4 td strong {\n  color:',
      '.attendance-supervisor-v4 td small {\n  margin-top:'
    ]) {
      const block = css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)) + 1);
      expect(block).toContain('font-size: 12px;');
    }
  });
});
