import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const read=(p:string)=>fs.readFileSync(path.join(__dirname,p),'utf8');
const editor=read('components/personnel/EmployeeGovernedEditModal.tsx');
const css=read('styles/employee-governed-edit.css');
describe('EMP-UX sticky action summary',()=>{
 it('summarizes changed fields from the same governed changes payload',()=>{expect(editor).toContain('Object.keys(changes).map');expect(editor).toContain('changedFieldSummary.join');expect(editor).toContain('กำลังเปลี่ยน ');});
 it('keeps role-specific action semantics visible',()=>{expect(editor).toContain('Admin: preflight → confirm');expect(editor).toContain('Manager: ส่งคำขอให้ Admin อนุมัติ');expect(editor).toContain('saveAdmin()');expect(editor).toContain('submitManager()');});
 it('keeps the action bar sticky and mobile reachable',()=>{expect(css).toContain('.employee-governed-actions{align-items:center;justify-content:space-between;z-index:2}');expect(css).toContain('.employee-action-buttons');expect(css).toContain('@media(max-width:760px){.employee-governed-actions{display:grid;grid-template-columns:1fr;gap:10px}');});
});
