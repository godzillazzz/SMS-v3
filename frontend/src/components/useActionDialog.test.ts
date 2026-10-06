import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isActionDialogPromptValid } from './useActionDialog';

describe('action dialog prompt confirmation', () => {
  it('requires the trimmed prompt value to meet the minimum length', () => {
    expect(isActionDialogPromptValid('    ', 5)).toBe(false);
    expect(isActionDialogPromptValid('  abcd  ', 5)).toBe(false);
    expect(isActionDialogPromptValid('  abcde  ', 5)).toBe(true);
  });

  it('disables the confirmation button while a minimum-length prompt is invalid', () => {
    const dialog = readFileSync(new URL('./useActionDialog.tsx', import.meta.url), 'utf8');
    expect(dialog).toContain('const promptValid = state.kind !== \'prompt\' || isActionDialogPromptValid(state.value, state.options.minLength);');
    expect(dialog).toContain('disabled={!promptValid}');
  });
});
