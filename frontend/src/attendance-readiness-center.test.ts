import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const center=fs.readFileSync(path.join(__dirname,'components/personnel/AttendanceReadinessCenter.tsx'),'utf8');
const page=fs.readFileSync(path.join(__dirname,'pages/personnel/PersonnelDirectoryPage.tsx'),'utf8');
const table=fs.readFileSync(path.join(__dirname,'components/personnel/PersonnelTable.tsx'),'utf8');
const api=fs.readFileSync(path.join(__dirname,'api.ts'),'utf8');
describe('ATT-RDY-01 Attendance Readiness Center',()=>{
 it('uses one server aggregate endpoint instead of client-derived readiness',()=>{expect(api).toContain('employeeReadinessCenter');expect(api).toContain('/employees/readiness/center');expect(center).toContain('api.employeeReadinessCenter');expect(center).not.toContain('server authority');});
 it('starts collapsed and shows Thai counts, statuses, and filters from server readiness data',()=>{expect(center).toContain("useState(false)");expect(center).toContain('พร้อม {data.summary.ready} · ไม่พร้อม {data.summary.notReady}');expect(center).toContain("row.status === 'READY' ? 'พร้อม' : 'ไม่พร้อม'");expect(center).toContain('<button type="button" aria-pressed={filter === \'ALL\'');expect(center).toContain("filter === 'NOT_READY'");expect(center).toContain('row.blockers');});
 it('adds a table status column from the authoritative endpoint result and does not infer status',()=>{expect(table).toContain('readinessByEmployeeId[employee.id]');expect(table).toContain("if (status === 'READY') return 'พร้อม'");expect(table).toContain("if (status === 'NOT_READY') return 'ไม่พร้อม'");expect(table).toContain('ไม่มีผลตรวจ');expect(table).not.toContain('employee.isActive ? \'พร้อม\'');});
 it('is integrated into Personnel Directory only for roles authorized by the endpoint',()=>{expect(page).toContain('enabled={canViewReadiness}');expect(page).toContain("role === 'ADMIN' || role === 'MANAGER' || role === 'SUPERVISOR'");expect(page).toContain('readinessByEmployeeId={tableReadiness.byEmployeeId}');});
});
