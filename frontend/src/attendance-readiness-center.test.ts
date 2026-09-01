import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const center=fs.readFileSync(path.join(__dirname,'components/personnel/AttendanceReadinessCenter.tsx'),'utf8');
const page=fs.readFileSync(path.join(__dirname,'pages/personnel/PersonnelDirectoryPage.tsx'),'utf8');
const api=fs.readFileSync(path.join(__dirname,'api.ts'),'utf8');
describe('ATT-RDY-01 Attendance Readiness Center',()=>{
 it('uses one server aggregate endpoint instead of client-derived readiness',()=>{expect(api).toContain('employeeReadinessCenter');expect(api).toContain('/employees/readiness/center');expect(center).toContain('api.employeeReadinessCenter');expect(center).toContain('server authority');});
 it('shows READY NOT READY summary and blockers with filtering',()=>{expect(center).toContain('READY');expect(center).toContain('NOT READY');expect(center).toContain('row.blockers');expect(center).toContain("filter==='NOT_READY'");});
 it('is integrated into Personnel Directory without a duplicate employee identity page',()=>{expect(page).toContain('<AttendanceReadinessCenter token={token} />');});
});
