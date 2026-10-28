import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const main = fs.readFileSync(path.join(__dirname, 'main.tsx'), 'utf8');

// Owner request (2026-10-28): an OFF cell in the monthly roster shows only "OFF", without the Thai "วันหยุด" sub-label.
describe('monthly roster OFF cell label', () => {
  it('renders OFF cells with the code only', () => {
    expect(main).not.toContain("=== 'OFF' ? 'วันหยุด'");
    expect(main).toMatch(/text\(shiftType\.code\)\.toUpperCase\(\) !== 'OFF' && <small className="schedule-time">/);
  });
});
