import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const main=fs.readFileSync(path.join(__dirname,'main.tsx'),'utf8');
const api=fs.readFileSync(path.join(__dirname,'api.ts'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'styles.css'),'utf8');
describe('CFG-UX-01B Shift governance',()=>{
 it('preflights shift impact before deactivation',()=>{expect(api).toContain('shiftTypeImpact');expect(main).toContain('api.shiftTypeImpact');expect(main).toContain('Impact Preview ก่อนปิดใช้งาน');expect(main).toContain('assignmentCount');expect(main).toContain('attendanceCount');});
 it('requires reason and explicit impact acknowledgement at mutation boundary',()=>{expect(main).toContain('confirmImpact: true');expect(main).toContain('shiftDeactivationReason.trim()');expect(main).not.toContain('ยืนยัน${actionLabel}กะ');});
 it('adds search and status filter while keeping core shift lock',()=>{expect(main).toContain('shiftQuery');expect(main).toContain('shiftStatusFilter');expect(main).toContain('visibleShiftTypes');expect(main).toContain("['D', 'N', 'OFF', 'AL'].includes");expect(css).toContain('.shift-governance-toolbar');});
});
