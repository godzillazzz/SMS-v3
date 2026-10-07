import { describe, expect, it } from 'vitest';
import { shouldPollApprovalCenter } from './approval-center-polling';

describe('approval center visibility polling', () => {
  it('polls only while the document is visible', () => {
    expect(shouldPollApprovalCenter('visible')).toBe(true);
    expect(shouldPollApprovalCenter('hidden')).toBe(false);
    expect(shouldPollApprovalCenter('prerender')).toBe(false);
  });
});
