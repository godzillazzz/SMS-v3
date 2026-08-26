import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');

describe('Shift Setup edit action', () => {
  it('renders an edit action for every shift type and opens the shared editor', () => {
    expect(main).toContain('onClick={() => openShiftTypeEditor(shiftType)}>แก้ไข</button>');
    expect(main).toContain("title: `แก้ไขรหัสกะ ${text(shiftType.code)}`");
    expect(main).toContain("submitLabel: 'บันทึกการแก้ไข'");
    expect(main).toContain("isCoreShiftType ? shiftTypeEditorFields.filter((field) => field.name !== 'code')");
  });

  it('preloads editable shift values and persists them through PUT', () => {
    for (const field of ['code', 'name', 'startTime', 'endTime', 'hours', 'color']) {
      expect(main).toContain(`${field}: String(shiftType.${field}`);
    }
    expect(main).toContain('api.updateShiftType(auth.token!, String(shiftType.id)');
    expect(api).toContain("updateShiftType: (token: string, id: string, data: unknown) => call(`/shift-types/${id}`, { method: 'PUT'");
  });
});