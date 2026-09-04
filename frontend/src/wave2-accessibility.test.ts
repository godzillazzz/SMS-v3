import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) => fs.readFileSync(path.join(__dirname, relativePath), 'utf8').replace(/\r\n/g, '\n');

const systemHealth = read('pages/system-health/SystemHealthPage.tsx');
const dataQuality = read('pages/data-quality/DataQualityCenterPage.tsx');
const attendanceSupervisor = read('pages/attendance-supervisor/AttendanceSupervisorPage.tsx');
const settingsTables = [
  read('components/ConfigurationRegistryPanel.tsx'),
  read('components/ApprovalAuthorityMatrixPanel.tsx'),
  read('components/AutoSchedulePatternPanel.tsx'),
  read('components/LeaveTypeMasterPanel.tsx'),
  read('components/DataRetentionCenterPanel.tsx'),
];
const tokens = read('styles/tokens.css');
const designSystem = read('design-system.css');

describe('WAVE 2 verified accessibility semantics', () => {
  it('marks every System Health route-table header as a column header', () => {
    expect((systemHealth.match(/<th scope="col"/g) ?? []).length).toBe(7);
    expect(systemHealth).toContain('className="ds-table-header"');
  });

  it('keeps the Data Quality page-size behavior while giving the select a visible label', () => {
    expect(dataQuality).toContain('<label htmlFor="data-quality-page-size">แสดงต่อหน้า</label>');
    expect(dataQuality).toContain('<select id="data-quality-page-size"');
    expect((dataQuality.match(/<th scope="col"/g) ?? []).length).toBe(7);
    expect(dataQuality).toContain('onPageSize(Number(event.target.value))');
  });

  it('marks Attendance Supervisor headers without changing attendance behavior', () => {
    expect((attendanceSupervisor.match(/<th scope="col"/g) ?? []).length).toBe(11);
    for (const label of ['Employee', 'Shift', 'Expected Site', 'Actual Site', 'Status', 'Action']) {
      expect(attendanceSupervisor).toContain(`>${label}</th>`);
    }
  });

  it('marks all verified Settings table headers as column headers', () => {
    for (const source of settingsTables) {
      expect(source).toContain('scope="col"');
    }
  });
});

describe('WAVE 2 shared design foundation', () => {
  it('exposes semantic Thai-aware type and spacing aliases on the existing scale', () => {
    for (const token of [
      '--font-size-supporting',
      '--font-size-metadata',
      '--font-size-helper',
      '--font-size-table-header',
      '--font-size-metric',
      '--line-height-heading',
      '--line-height-table',
      '--space-page',
      '--space-section',
      '--space-card',
      '--space-toolbar',
      '--space-field',
      '--space-table-cell',
      '--space-status',
    ]) {
      expect(tokens).toContain(token);
    }
  });

  it('provides opt-in semantic roles and preserves the shared focus-visible foundation', () => {
    for (const role of ['.ds-page-title', '.ds-section-title', '.ds-body-secondary', '.ds-metadata', '.ds-helper', '.ds-table-header', '.ds-metric-value', '.ds-status']) {
      expect(designSystem).toContain(role);
    }
    expect(designSystem).toContain(':focus-visible');
  });
});
