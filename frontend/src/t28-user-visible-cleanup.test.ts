import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { configurationDescriptionText } from './components/ConfigurationRegistryPanel';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('T28 user-visible cleanup', () => {
  it('removes the roster placeholders and masked credential from the schedule/settings shell', () => {
    const main = read('./main.tsx');
    const autoScheduleSettings = read('./components/AutoSchedulePatternPanel.tsx');
    expect(main).not.toContain('AWAITING DATA');
    expect(main).not.toContain('ROSTER READINESS');
    expect(main).not.toContain('SHIFT COVERAGE');
    expect(main).not.toContain('••••••••••••');
    expect(main).not.toContain('ไม้กายสิทธิ์');
    expect(autoScheduleSettings).not.toContain('ไม้กายสิทธิ์');
  });

  it('omits internal policy identifiers from configuration descriptions', () => {
    expect(configurationDescriptionText('CFG-06 reviewer roles for SCHEDULE; protected by a code-enforced security ceiling.'))
      .toBe('reviewer roles for SCHEDULE; protected by a code-enforced security ceiling.');
  });

  it('keeps the approval count unset until a summary value is received', () => {
    const main = read('./main.tsx');
    const dashboard = read('./pages/dashboard/DashboardPage.tsx');
    const workQueue = read('./components/dashboard/WorkQueueJourney.tsx');
    expect(main).toContain('useState<number | null>(null)');
    expect(main).toContain('setPendingApprovalCount(null)');
    expect(dashboard).toContain('pendingApprovalCount={pendingApprovalCount}');
    expect(workQueue).toMatch(/typeof pendingApprovalCount\s*===\s*['"]number['"].*pendingApprovalCount\s*>\s*0/);
  });
});
