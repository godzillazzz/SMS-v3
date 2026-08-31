import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
const shiftTypeClient = readFileSync(new URL('./shift-type-client.ts', import.meta.url), 'utf8');

describe('CFG-04 Shift Type governed edit controls', () => {
  it('keeps Shift Code immutable after creation and exposes full editable operational fields', () => {
    expect(main).toContain("fields: shiftTypeEditorFields.filter((field) => field.name !== 'code'");
    expect(main).toContain("name: 'name', label: 'ชื่อกะ'");
    expect(main).toContain("name: 'startTime', label: 'เวลาเริ่ม'");
    expect(main).toContain("name: 'endTime', label: 'เวลาเลิก'");
    expect(main).toContain("name: 'hours', label: 'ชั่วโมง'");
    expect(main).toContain("name: 'color', label: 'สี HEX'");
    expect(main).toContain("name: 'isActive', label: 'สถานะใช้งาน'");
    expect(main).toContain("Shift Code เป็นรหัสอ้างอิงถาวรและแก้ไม่ได้หลังสร้าง");
  });

  it('locks core active state while allowing governed custom activation changes', () => {
    expect(main).toContain("const isCoreShiftType = ['D', 'N', 'OFF', 'AL'].includes");
    expect(main).toContain("(!isCoreShiftType || field.name !== 'isActive')");
    expect(main).toContain("const toggleShiftTypeActive = async (shiftType: DataRow)");
    expect(main).toContain("await api.updateShiftType(auth.token, String(shiftType.id), { isActive: nextActive })");
    expect(main).toContain("ตารางเดิมจะไม่ถูกแก้ไข");
    expect(main).toContain("ล็อกสถานะ");
  });

  it('does not offer destructive delete in the normal Shift Setup UI', () => {
    const tableStart = main.indexOf('<div className="table-card"><div className="table-scroll"><table className="data-table"><thead><tr><th>Shift Code</th>');
    const tableEnd = main.indexOf('</table></div></div>', tableStart);
    const shiftTable = main.slice(tableStart, tableEnd);
    expect(tableStart).toBeGreaterThan(-1);
    expect(shiftTable).toContain('onClick={() => openShiftTypeEditor(shiftType)}>แก้ไข</button>');
    expect(shiftTable).toContain('onClick={() => toggleShiftTypeActive(shiftType)}');
    expect(shiftTable).not.toContain('api.deleteShiftType');
    expect(shiftTable).not.toContain('>ลบ</button>');
  });

  it('shows Admin inactive master rows but operational selectors use only active shift types', () => {
    expect(api).toContain("shiftTypes: (token: string) => call('/shift-types'");
    expect(shiftTypeClient).toContain("export async function getShiftTypes");
    expect(shiftTypeClient).toContain("?includeInactive=true");
    expect(main).toContain("getShiftTypes(auth.token, { includeInactive: auth.user?.role === 'ADMIN' })");
    expect(main).toContain("const activeShiftTypes = shiftTypes.filter((item) => item.isActive !== false)");
    expect(main).toContain("const shiftTypeOptions = activeShiftTypes.map");
    expect(main).toContain("shiftTypes={activeShiftTypes}");
    expect(main).toContain("const defaultType = activeShiftTypes.find");
  });

  it('retains an existing historical inactive shift in the schedule editor without reopening it for new use', () => {
    expect(main).toContain("const historicalShiftTypeId = String(historicalShiftType.id || shift?.shiftTypeId || '')");
    expect(main).toContain('const selectableShiftTypes = historicalShiftTypeId && !shiftTypes.some');
    expect(main).toContain('? [{ ...historicalShiftType, id: historicalShiftTypeId, isActive: false }, ...shiftTypes]');
    expect(main).toContain('{selectableShiftTypes.map((t) => (');
  });

  it('explains that master edits do not rewrite existing schedule snapshots', () => {
    expect(main).toContain('การแก้ชื่อ เวลา ชั่วโมง หรือสีจะมีผลกับการจัดกะใหม่เท่านั้น');
    expect(main).toContain('ตารางเดิมยังเก็บเวลา/ชั่วโมง snapshot เดิม');
    expect(main).toContain('บริหารชื่อ เวลา ชั่วโมง สี และสถานะใช้งานของกะ โดยไม่เขียนทับ snapshot ตารางเดิม');
  });
});
