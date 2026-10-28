import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.join(__dirname, 'styles/approval-center.css'), 'utf8');

// Owner request (2026-10-28): each request in "งานที่รอฉันดำเนินการ" should sit on a single row on desktop
// instead of stacking the buttons, the sender lines and the age under one another.
describe('approval queue desktop rows are single-line', () => {
  const block = css.slice(css.indexOf('/* owner-single-row */'));
  it('lays the detail and review buttons side by side', () => {
    expect(block).toMatch(/\.approval-queue-row-actions\{[^}]*display:flex[^}]*flex-wrap:nowrap/);
  });
  it('keeps cells on one line and truncates the summary', () => {
    expect(block).toMatch(/\.approval-queue-table td\{[^}]*white-space:nowrap[^}]*vertical-align:middle/);
    expect(block).toMatch(/\.approval-queue-summary\{[^}]*text-overflow:ellipsis/);
  });
  it('puts type, urgency and age on one line and shows only the requester name', () => {
    expect(block).toMatch(/\.approval-queue-type-cell\{[^}]*display:flex/);
    expect(block).toMatch(/\.approval-queue-table \.approval-person-copy small\{display:none\}/);
  });
});
