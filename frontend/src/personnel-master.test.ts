import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const read = (relative: string) => fs.readFileSync(path.join(__dirname, relative), 'utf8');
const main = read('main.tsx');
const panel = read('components/PersonnelMasterPanel.tsx');
const editor = read('components/personnel/EmployeeGovernedEditModal.tsx');
const api = read('api.ts');

describe('EMP-UX Department / Position Master frontend authority', () => {
  it('mounts Admin master management in Configuration Center without delete capability', () => {
    expect(main).toContain("import { PersonnelMasterPanel }");
    expect(main).toContain('<PersonnelMasterPanel token={token} />');
    expect(panel).toContain('Department / Position Master');
    expect(panel).toContain('api.createPersonnelMaster');
    expect(panel).toContain('api.updatePersonnelMaster');
    expect(panel).not.toContain('deletePersonnelMaster');
  });
  it('new Employee Department and Position fields are Master-backed selects', () => {
    const block = main.slice(main.indexOf('const openEmployeeEditor'), main.indexOf('const [shiftEditorTarget'));
    expect(block).toContain('api.personnelMasters(auth.token, true)');
    expect(block).toContain("name: 'department', label: 'หน่วยงาน', type: 'select'");
    expect(block).toContain("name: 'jobTitle', label: 'ตำแหน่ง', type: 'select'");
  });
  it('existing Employee critical changes fail closed to active master selectors', () => {
    expect(editor).toContain('เลือก Department Master');
    expect(editor).toContain('เลือก Position Master');
    expect(editor).toContain('Boolean(personnelMastersError)');
  });
  it('central API explicitly exposes only list create update master calls', () => {
    expect(api).toContain('personnelMasters:');
    expect(api).toContain('createPersonnelMaster:');
    expect(api).toContain('updatePersonnelMaster:');
    expect(api).not.toContain('deletePersonnelMaster:');
  });
});
