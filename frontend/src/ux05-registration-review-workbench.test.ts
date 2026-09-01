import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(__dirname);
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const panel = read('pages/access-management/RegistrationReviewPanel.tsx');
const css = read('styles/registration-review.css');
const api = read('api.ts');
const apiSha256 = crypto.createHash('sha256').update(read('api.ts')).digest('hex');

describe('G04.2 UX-05 Registration Review workbench contract', () => {
  it('keeps the exact authorized request-list API and selection behavior while adding local mobile detail presentation', () => {
    expect(panel).toContain('await api.registrationRequests(token)');
    expect(panel).toContain("setSelectedId((current) => next.some((row) => row.id === current) ? current : next[0]?.id || '')");
    expect(panel).toContain('const selectRequest = (id: string) => { setSelectedId(id); setMobileDetail(true); };');
    expect(panel).toContain('aria-pressed={row.id === selectedId}');
    expect(panel).toContain("onClick={() => selectRequest(row.id)}");
    expect(panel).toContain('onClick={() => setMobileDetail(false)}');
  });

  it('keeps candidate search API behavior including automatic empty search and manual minimum length two', () => {
    expect(panel).toContain("api.registrationCandidates(token, selected.id, manual ? search.trim() : '')");
    expect(panel).toContain("if (selected && ['PENDING', 'MATCHED'].includes(selected.status)) void runSearch(false)");
    expect(panel).toContain('disabled={candidateLoading || search.trim().length < 2}');
    expect(panel).toContain('onClick={() => void runSearch(true)}');
    expect(panel).toContain('ค้นหาชื่อหรือรหัสพนักงาน (อย่างน้อย 2 ตัวอักษร)');
  });

  it('adds explicit local candidate selection and human comparison before the unchanged match API action', () => {
    expect(panel).toContain("const [selectedCandidateId, setSelectedCandidateId] = useState('')");
    expect(panel).toContain('aria-pressed={isSelected}');
    expect(panel).toContain("{isSelected ? 'เลือกแล้ว' : 'เลือกพนักงาน'}");
    expect(panel).toContain('เปรียบเทียบก่อนจับคู่');
    expect(panel).toContain('ข้อมูลผู้สมัคร');
    expect(panel).toContain('Employee Master');
    expect(panel).toContain("await api.matchRegistrationRequest(token, selected.id, employeeId)");
    expect(panel).toContain("onClick={() => void match(selectedCandidate.id)}");
    expect(panel).toContain("'จับคู่พนักงาน'");
  });

  it('does not add auto-match, fuzzy scoring, identity confidence, or verified identity claims', () => {
    expect(panel).not.toMatch(/auto.?match/i);
    expect(panel).not.toMatch(/fuzzy/i);
    expect(panel).not.toMatch(/phonetic/i);
    expect(panel).not.toMatch(/edit.?distance/i);
    expect(panel).not.toMatch(/confidence/i);
    expect(panel).not.toContain('best match');
    expect(panel).not.toContain('verified match');
    expect(panel).not.toContain('ยืนยันแล้วว่าเป็นพนักงาน');
    expect(panel).toContain('ไม่ใช่การยืนยันตัวตนอัตโนมัติ');
  });

  it('clearly distinguishes applicant submission from authoritative Employee Master information', () => {
    expect(panel).toContain('ข้อมูลที่ผู้สมัครแจ้ง');
    expect(panel).toContain('ใช้ประกอบการตรวจสอบเท่านั้น ไม่ใช่ข้อมูลยืนยันตัวบุคคลจาก Employee Master');
    expect(panel).toContain('ชื่อที่ผู้สมัครแจ้ง');
    expect(panel).toContain('รหัสภายใน');
    expect(panel).not.toContain('employeeCode เป็นตัวตน');
  });

  it('presents the current matched Employee and explicitly separates matching from account approval', () => {
    expect(panel).toContain('selected.matchedEmployee');
    expect(panel).toContain('จับคู่ Employee Master แล้ว');
    expect(panel).toContain('selected.matchedEmployee.employeeCode');
    expect(panel).toContain('การจับคู่พนักงานยังไม่ใช่การอนุมัติบัญชี');
  });

  it('preserves Employee-not-found behavior and ADMIN-only Employee Master navigation', () => {
    expect(panel).toContain("matchState === 'EMPLOYEE_NOT_FOUND'");
    expect(panel).toContain('ไม่พบพนักงานใน Employee Master');
    expect(panel).toContain('คำขอยังคงรอตรวจสอบ');
    expect(panel).toContain("role === 'ADMIN'");
    expect(panel).toContain('onClick={onOpenEmployeeMaster}');
    expect(panel).not.toContain('api.createEmployee');
    expect(panel).not.toContain('api.updateEmployee');
  });

  it('keeps exact ADMIN/MANAGER reviewer gating and does not broaden public Employee exposure', () => {
    expect(panel).toContain("if (!['ADMIN', 'MANAGER'].includes(role)) return null");
    expect(panel).toContain("if (['ADMIN', 'MANAGER'].includes(role)) void load()");
    expect(panel).not.toContain('/auth/register/available-employees');
    expect(panel).not.toContain('registrationEmployees');
  });

  it('keeps approval VIEWER-only with the exact matchedEmployeeId enablement requirement and unchanged approve API', () => {
    expect(panel).toContain("selected?.status !== 'MATCHED' || !selected?.matchedEmployeeId");
    expect(panel).toContain('await api.approveRegistrationRequest(token, selected.id)');
    expect(panel).toContain('สิทธิ์เริ่มต้นหลังอนุมัติ');
    expect(panel).toContain('VIEWER');
    expect(panel).toContain('อนุมัติเป็น VIEWER');
    expect(panel).not.toContain('<select');
    expect(panel).not.toContain('name="role"');
  });

  it('replaces window.prompt/window.confirm with an accessible rejection dialog', () => {
    expect(panel).not.toContain('window.prompt');
    expect(panel).not.toContain('window.confirm');
    expect(panel).toContain('role="dialog"');
    expect(panel).toContain('aria-modal="true"');
    expect(panel).toContain('aria-labelledby="registration-reject-title"');
    expect(panel).toContain('htmlFor="registration-reject-reason"');
    expect(panel).toContain('ref={rejectTextareaRef}');
    expect(panel).toContain('ไม่อนุมัติคำขอ');
  });

  it('keeps rejection validation at least as strict as the previous minimum and sends the same reason payload semantic', () => {
    expect(panel).toContain('if (reason.length < 3)');
    expect(panel).toContain('กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร');
    expect(panel).toContain('await api.rejectRegistrationRequest(token, selected.id, reason)');
    expect(api).toContain("rejectRegistrationRequest: (token: string, id: string, reason: string) => call(`/registration-requests/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify({ reason }), headers: { Authorization: `Bearer ${token}` } })");
  });

  it('provides Escape, backdrop close, body scroll lock, initial focus, and focus restoration for reject dialog', () => {
    expect(panel).toContain('const releaseScrollLock = acquireDocumentScrollLock()');
    expect(panel).toContain("if (event.key === 'Escape') closeReject()");
    expect(panel).toContain('rejectTextareaRef.current?.focus()');
    expect(panel).toContain('rejectTriggerRef.current?.focus()');
    expect(panel).toContain('if (event.target === event.currentTarget) closeReject()');
    expect(panel).toContain('releaseScrollLock()');
  });

  it('keeps refresh, match, approve, reject, and onChanged mutation sequencing intact', () => {
    expect(panel).toContain('onClick={() => void load()}');
    expect(panel).toContain("setMessage('จับคู่ Employee Master แล้ว'); setSelectedCandidateId(''); await load(); onChanged();");
    expect(panel).toContain("setMessage('อนุมัติบัญชีแล้ว — สิทธิ์เริ่มต้น VIEWER'); await load(); onChanged();");
    expect(panel).toContain("setMessage('บันทึกการไม่อนุมัติแล้ว')");
    expect(panel).toContain('await load(); onChanged();');
  });

  it('keeps terminal APPROVED/REJECTED rows read-only without adding new queue filters', () => {
    expect(panel).toContain("const terminal = selected && ['APPROVED', 'REJECTED'].includes(selected.status)");
    expect(panel).toContain('รายการนี้เป็นประวัติการตรวจสอบและไม่มีการดำเนินการเพิ่มเติมจากหน้านี้');
    expect(panel).not.toContain('registrationRequests(token,');
    expect(panel).not.toContain('statusFilter');
  });

  it('uses one semantic-token workbench layer for Light/Dark with readable text and reduced motion', () => {
    expect(css).toContain('authoritative Registration Review workbench presentation');
    expect(css).toContain('var(--color-surface)');
    expect(css).toContain('var(--color-primary)');
    expect(css).toContain('var(--color-success-soft)');
    expect(css).toContain('var(--color-danger-soft)');
    expect(css).toContain('[data-theme="dark"] .registration-review__requests');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(css).not.toMatch(/font-size:\s*(?:10|11)px/);
  });

  it('keeps 40px-plus controls and mobile list-to-detail workbench behavior without squeezed columns', () => {
    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('.registration-review__grid.is-mobile-detail .registration-review__requests { display: none; }');
    expect(css).toContain('.registration-review__grid.is-mobile-detail .registration-review__detail { display: grid; }');
    expect(css).toContain('min-height: 40px;');
    expect(css).toContain('min-height: 42px;');
    expect(css).toContain('grid-template-columns: 1fr;');
    expect(css).toContain('max-height: 92dvh;');
  });

  it('locks the authorized API source after Attachment Optimizer V1 and preserves all five Registration Review API signatures', () => {
    expect(apiSha256).toBe('4e6b4953f72b6cae6dd3ad717fe1bb89df01aca59d68f2e0af3cb2ae8e8c1610');
    expect(api).toContain('registrationRequests: (token: string, status?: string)');
    expect(api).toContain('registrationCandidates: (token: string, id: string, search = \'\')');
    expect(api).toContain('matchRegistrationRequest: (token: string, id: string, employeeId: string)');
    expect(api).toContain('approveRegistrationRequest: (token: string, id: string)');
    expect(api).toContain('rejectRegistrationRequest: (token: string, id: string, reason: string)');
  });

  it('does not add Employee/User mutations, role pickers, demo records, fake statuses, or new dependencies', () => {
    for (const forbidden of ['api.createEmployee', 'api.updateEmployee', 'api.createUser', 'api.updateUser', 'best match', 'confidence score', 'บัญชีทดสอบ', 'demo account']) {
      expect(panel).not.toContain(forbidden);
    }
    expect(panel).not.toContain('<select');
    expect(panel).not.toContain('fake status');
  });
});
