import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.join(__dirname, 'styles/roster-compact.css'), 'utf8');

// Owner regression (2026-10-28): mobile landscape/Desktop-site view is ~980 CSS px. It must not fall
// back to the old cell that shows the time and the MANUAL text below D/N/AL/OFF.
describe('monthly roster compact codes across desktop-like mobile viewports', () => {
  it('applies the compact monthly grid at every viewport, including mobile portrait and Desktop-site landscape', () => {
    expect(css).not.toMatch(/@media \(min-width:/);
    expect(css).not.toContain('@media (min-width: 1025px)');
  });

  it('shows only the shift code while retaining status as compact corner markers', () => {
    expect(css).toMatch(/\.calendar-shift \.schedule-time \{ display: none !important; \}/);
    expect(css).toMatch(/\.calendar-shift \[data-label-type\][^{]*\{[^}]*font-size: 0 !important;/s);
  });
});
