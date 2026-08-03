import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mainSource = fs.readFileSync(path.join(__dirname, 'main.tsx'), 'utf-8');

describe('leave attachment size limit', () => {
  it('uses a 2 MB limit in both Leave upload flows', () => {
    expect(mainSource).toContain('const MAX_LEAVE_ATTACHMENT_BYTES = 2 * 1024 * 1024;');
    expect(mainSource).toContain('PDF, JPG หรือ PNG ขนาดไม่เกิน 2 MB');
    expect(mainSource).toContain('files.attachment.size > MAX_LEAVE_ATTACHMENT_BYTES');
    expect(mainSource).toContain('file.size > MAX_LEAVE_ATTACHMENT_BYTES');
    expect(mainSource).toContain('ไฟล์ต้องมีขนาดไม่เกิน 2 MB');
  });

  it('keeps the 2 MB check before the Leave API request', () => {
    const limitCheck = mainSource.indexOf('file.size > MAX_LEAVE_ATTACHMENT_BYTES');
    const submitCall = mainSource.indexOf('await onSubmit(payload, file);');
    expect(limitCheck).toBeGreaterThan(-1);
    expect(submitCall).toBeGreaterThan(limitCheck);
  });
});
