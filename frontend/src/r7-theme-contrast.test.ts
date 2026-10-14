import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('R7 T37 theme contrast contracts', () => {
  it('uses semantic tokens for the reported dark-theme surfaces and labels', () => {
    expect(read('./pages/attendance-supervisor/attendance-supervisor-v4.css')).toContain('background: var(--color-surface-muted)');
    expect(read('./pages/attendance-simple/attendance-simple.css')).toContain('background:var(--color-surface-muted)');
    expect(read('./styles.css')).toContain('background: var(--color-surface-muted)');
    expect(read('./styles/security-site-management.css')).toContain('background: var(--color-success-soft)');
    expect(read('./styles/report-center.css')).toContain('color:var(--color-text-secondary)');
    expect(read('./styles/executive-report.css')).toContain('color:var(--color-text-secondary)');
    expect(read('./styles/dashboard.css')).toContain('color:var(--color-text-secondary)');
    expect(read('./main.tsx')).toContain("color: 'var(--color-text-secondary)'");
  });

  it('does not retain the reported light-only values in the affected declarations', () => {
    const sources = [
      read('./pages/attendance-supervisor/attendance-supervisor-v4.css'),
      read('./pages/attendance-simple/attendance-simple.css'),
      read('./styles.css'),
      read('./styles/security-site-management.css'),
      read('./styles/report-center.css'),
      read('./styles/executive-report.css'),
      read('./styles/dashboard.css'),
      read('./main.tsx')
    ].join('\n');
    expect(sources).not.toContain('rgba(246, 249, 253, .92)');
    expect(sources).not.toContain('background:#e7eef6');
    expect(sources).not.toContain('background: #f4f6f9');
    expect(sources).not.toContain("color: '#64748b'");
  });
});
