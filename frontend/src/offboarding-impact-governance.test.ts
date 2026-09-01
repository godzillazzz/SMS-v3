import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const modal=fs.readFileSync(path.join(__dirname,'components/personnel/EmployeeLifecycleModal.tsx'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'styles/employee-lifecycle.css'),'utf8');
describe('OFF-01 lifecycle impact governance',()=>{
 it('surfaces Attendance Device and Approval Authority impacts',()=>{expect(modal).toContain('activeAttendanceDevices');expect(modal).toContain('approvalAuthorityReferences');expect(modal).toContain('Attendance Device Active');expect(modal).toContain('Approval Authority');});
 it('groups impact into clear review and follow-up states',()=>{expect(modal).toContain('ไม่กระทบ');expect(modal).toContain('ต้องตรวจสอบ');expect(modal).toContain('ต้องติดตาม');expect(css).toContain('.lifecycle-impact-groups');});
 it('keeps existing warning acknowledgement gate',()=>{expect(modal).toContain('acknowledgeWarnings');expect(modal).toContain('ตรวจสอบคำเตือนและผลกระทบแล้ว');});
});
