import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const css = fs.readFileSync(path.join(root, 'frontend/src/styles/operational-layer.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'frontend/src/main.tsx'), 'utf8');
const marker = '/* Duty roster typography contract:';
const contract = css.slice(css.lastIndexOf(marker));

describe('monthly roster font contract', () => {
  it('keeps the schedule-only guard after the legacy roster styles', () => {
    expect(css.lastIndexOf(marker)).toBeGreaterThan(css.indexOf('.nexus-roster-workspace{'));
    expect(main).toContain('className="view-pane schedule-calendar-page nexus-roster-workspace"');
    expect(main).toContain('className={`schedule-grid schedule-grid--compact${showScheduleTimes ?');
    expect(contract).not.toMatch(/font-family\s*:[^;}]*\b(?:Inter|Noto Sans Thai|IBM Plex Mono|Arial)\b/i);
  });

  it('covers employee names, code, times, table headers and telemetry', () => {
    for (const selector of [
      '.schedule-grid .employee-sticky strong',
      '.schedule-grid .employee-sticky small',
      '.schedule-grid .calendar-shift',
      '.calendar-shift b',
      '.calendar-shift small',
      '.calendar-shift .shift-note',
      '.schedule-grid thead th',
      '.schedule-workbench > div:first-child',
      '.roster-telemetry-strip small',
      '.preview-table code',
      '.page-heading .eyebrow',
      '.roster-command-kicker'
    ]) {
      expect(contract, selector).toContain(selector);
    }
    expect(contract).toContain('font-family: "Kanit", "Plus Jakarta Sans", sans-serif !important;');
    expect(contract).toContain('font-family: "JetBrains Mono", "Kanit", monospace !important;');
  });

  it('covers calendar controls and portalled shift editor', () => {
    expect(contract).toContain('.nexus-roster-workspace :is(button, input, select, textarea)');
    expect(contract).toContain('.shift-editor-modal__viewport .shift-editor-modal__dialog :is(button, input, select, textarea)');
    expect(contract).toContain('.shift-editor-modal__viewport .shift-editor-modal__dialog :is(h1, h2, h3)');
    expect(contract).toContain('font-family: "Plus Jakarta Sans", "Kanit", sans-serif !important;');
    expect(main).toContain('className="shift-editor-modal__viewport"');
    expect(main).not.toContain('<ScheduleRosterOrderModal');
  });
});