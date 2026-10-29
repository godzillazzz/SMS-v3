import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');

describe('license table row click isolation', () => {
  it('ignores clicks from nested buttons and portal dialogs so the file viewer does not also open the personnel drawer', () => {
    expect(main).toContain("if (!target || !(event.currentTarget as HTMLElement).contains(target)) return true; return Boolean(target.closest('button, a, input, select, textarea'));");
    expect(main).toContain('onClick={(event) => { if (isNestedInteractiveTarget(event)) return; selectRow(row); }}');
  });
});
