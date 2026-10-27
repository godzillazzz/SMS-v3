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
 it('keeps authoritative readiness available without presenting it in the personnel table',()=>{expect(center).toContain("row.status === 'READY' ? 'พร้อม' : 'ไม่พร้อม'");expect(center).toContain('row.blockers');expect(table).not.toContain('readinessByEmployeeId');expect(table).not.toContain('data-readiness-status');expect(table).not.toContain('ความพร้อม');});
 it('does not mount the personnel readiness panel or table presentation',()=>{expect(page).not.toContain('AttendanceReadinessCenter');expect(page).not.toContain('canViewReadiness');expect(page).not.toContain('readinessByEmployeeId');expect(table).not.toContain('personnel-mobile-readiness');});
});
