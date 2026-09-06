import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const main = read('main.tsx');
const approval = read('components/ApprovalAuthorityMatrixPanel.tsx');
const autoSchedule = read('components/AutoSchedulePatternPanel.tsx');

describe('WAVE 5D specialist workflow feedback semantics', () => {
  it('announces Leave queue loading and empty states without changing decision handlers', () => {
    expect(main).toContain('aria-busy={loading}');
    expect(main).toContain('role="status" aria-live="polite" aria-label="กำลังโหลดคำขอลา"');
    expect(main).toContain('role="status" aria-live="polite"><span aria-hidden="true">✓</span>');
    expect(main).toContain('onApprove(row)');
    expect(main).toContain('onReturnForCorrection(row)');
    expect(main).toContain('onReject(row)');
  });

  it('announces Approval Matrix empty state and exposes busy state on the specialist editor', () => {
    expect(approval).toContain('aria-busy={loading || Boolean(busyType)}');
    expect(approval).toContain('role="status" aria-live="polite"><strong>ไม่พบ Approval policy');
    expect(approval).toContain('updateApprovalPolicy(token, requestType, input)');
    expect(approval).toContain("reviewerRoles: draft.reviewerRoles");
  });

  it('keeps Auto Schedule specialist guard and API semantics while marking static guidance as a note', () => {
    expect(autoSchedule).toContain('aria-busy={loading || busy}');
    expect(autoSchedule).toContain('role="note"');
    expect(autoSchedule).toContain('targetGroup: row.targetGroup');
    expect(autoSchedule).toContain('createAutoSchedulePattern(token');
    expect(autoSchedule).toContain('updateAutoSchedulePattern(token, row.id');
    expect(autoSchedule).not.toContain('deleteAutoSchedulePattern');
  });
});
