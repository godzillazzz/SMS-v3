import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(__dirname);
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const main = read('main.tsx');
const personnelPage = read('pages/personnel/PersonnelDirectoryPage.tsx');
const personnelHeader = read('components/personnel/PersonnelDirectoryHeader.tsx');
const personnelTable = read('components/personnel/PersonnelTable.tsx');
const personnelDrawer = read('components/personnel/PersonnelDetailDrawer.tsx');
const lifecycle = read('components/personnel/EmployeeLifecycleModal.tsx');
const personnelCss = read('styles/personnel-directory.css');
const lifecycleCss = read('styles/employee-lifecycle.css');
const accessPage = read('pages/access-management/AccessManagementPage.tsx');
const accessUtils = read('components/access-management/access-management-utils.ts');
const accessCss = read('styles/access-management.css');
const reviewPanel = read('pages/access-management/RegistrationReviewPanel.tsx');
const smsIcon = read('components/SmsIcon.tsx');
const apiBytes = fs.readFileSync(path.join(root, 'api.ts'), 'utf8').replace(/\r\n/g, '\n');
const apiSha256 = crypto.createHash('sha256').update(apiBytes).digest('hex');

describe('G04.2 UX-06 Personnel + Access experience contract', () => {
  it('keeps Personnel search, department, status, page size, and pagination mathematics unchanged', () => {
    expect(personnelPage).toContain('[employee.employeeCode, employee.firstName, employee.lastName, employee.department, employee.jobTitle]');
    expect(personnelPage).toContain('employee.department === department');
    expect(personnelPage).toContain("status === 'active' ? employee.isActive : !employee.isActive");
    expect(personnelPage).toContain('const pageSize = 10;');
    expect(personnelPage).toContain('Math.ceil(filtered.length / pageSize)');
    expect(personnelPage).toContain('filtered.slice((page - 1) * pageSize, page * pageSize)');
    expect(personnelPage).toContain('<PersonnelPagination page={page} totalPages={totalPages} onChange={setPage} />');
  });

  it('keeps only real-backed Personnel metrics and does not restore the unavailable review metric', () => {
    expect(personnelPage).toContain('บุคลากรทั้งหมด');
    expect(personnelPage).toContain('บุคลากรที่ใช้งาน');
    expect(personnelPage).toContain('โปรไฟล์ไม่สมบูรณ์');
    expect(personnelPage).toContain("employees.filter((employee) => employee.isActive).length");
    expect(personnelPage).toContain("employees.filter((employee) => !employee.department || !employee.jobTitle).length");
    expect(personnelPage).not.toContain('รอตรวจสอบ');
  });

  it('keeps the Personnel edit gate while removing the obsolete dedicated lifecycle entry point', () => {
    expect(personnelHeader).toContain('{canManage &&');
    expect(personnelTable).toContain('{canManage &&');
    expect(personnelTable).not.toContain("{role === 'ADMIN' &&");
    expect(personnelDrawer).not.toContain("{role === 'ADMIN' &&");
    expect(personnelTable).not.toContain('จัดการสถานะพนักงาน');
    expect(personnelDrawer).not.toContain('จัดการสถานะพนักงาน');
    expect(main).not.toContain('setLifecycleTarget');
    expect(main).toContain('EmployeeGovernedEditModal');
  });

  it('keeps Personnel drawer selection and focus restoration while presenting only real Employee Master fields', () => {
    expect(personnelPage).toContain('data-personnel-id');
    expect(personnelPage).toContain('requestAnimationFrame(() => document.querySelector<HTMLElement>');
    for (const realField of ['employee.employeeCode', 'employee.firstName', 'employee.lastName', 'employee.department', 'employee.jobTitle', 'employee.isActive']) expect(personnelDrawer).toContain(realField);
    for (const forbidden of ['salary', 'attendance', 'managerName', 'licenseSummary']) expect(personnelDrawer).not.toContain(forbidden);
    expect(personnelDrawer).toContain('รหัสภายใน');
    expect(personnelDrawer).not.toContain('รหัสพนักงานองค์กรที่ยืนยันตัวตน');
  });

  it('keeps Employee create API unchanged while routing existing edit callbacks through governed edit authority', () => {
    for (const field of ["name: 'employeeCode'", "name: 'firstName'", "name: 'lastName'", "name: 'email'", "name: 'phone'", "name: 'department'", "name: 'jobTitle'", "name: 'hiredAt'"]) expect(main).toContain(field);
    expect(main).toContain("api.createEmployee(auth.token!, formPayload(form, ['email', 'phone', 'department', 'jobTitle', 'hiredAt']))");
    expect(main).toContain('setEmployeeGovernedEditTarget(employee)');
    expect(main).toContain('onEdit={openEmployeeEditor}');
    expect(main).toContain('onAdd={() => openEmployeeEditor()}');
    expect(personnelPage).toContain('onEdit={onEdit}');
    expect(main).not.toContain("api.updateEmployee(auth.token!, employee.id, formPayload(form, ['email', 'phone', 'hiredAt']))");
  });

  it('keeps Employee lifecycle preflight, idempotency, termination confirmation, and mutation APIs unchanged', () => {
    expect(lifecycle).toContain('api.employeeLifecycleHistory(token, employee.id)');
    expect(lifecycle).toContain('api.preflightEmployeeLifecycle(token, employee.id, { type, effectiveDate, changes: payloadChanges() })');
    expect(lifecycle).toContain('api.createEmployeeLifecycleEvent(token, employee.id, {');
    expect(lifecycle).toContain('expectedEmployeeUpdatedAt: preflight.expectedEmployeeUpdatedAt');
    expect(lifecycle).toContain('expectedLifecycleSequence: preflight.latestLifecycleSequence');
    expect(lifecycle).toContain('idempotencyKey');
    expect(lifecycle).toContain("type === 'EMPLOYMENT_TERMINATION' && confirmation !== employee.employeeCode");
  });

  it('adds accessible Personnel editor/drawer/lifecycle overlay behavior without changing business callbacks', () => {
    expect(main).toContain("experience?: 'personnel'");
    expect(main).toContain("experience: 'personnel'");
    expect(main).toContain("event.key === 'Escape' && !busyRef.current");
    expect(main).toContain('const releaseScrollLock = acquireDocumentScrollLock()');
    expect(main).toContain('releaseScrollLock()');
    expect(personnelDrawer).toContain('role="dialog" aria-modal="true"');
    expect(personnelDrawer).toContain("event.key === 'Escape'");
    expect(personnelDrawer).toContain("event.key !== 'Tab'");
    expect(lifecycle).toContain('role="dialog" aria-modal="true"');
    expect(lifecycle).toContain("event.key === 'Escape' && !busyRef.current");
    expect(lifecycle).toContain("event.key !== 'Tab'");
  });

  it('keeps Access state, summary, status logic, and visibleAccountActions as exact authorities', () => {
    expect(accessPage).toContain('const state = accessManagementState(role, loading, error, rows);');
    expect(accessPage).toContain('const summary = accessSummary(rows);');
    expect(accessPage).toContain('const actions = visibleAccountActions(role, account, originalUserId);');
    expect(accessPage).toContain('accountStatusTone(account)');
    expect(accessPage).toContain('accountStatusLabel(account)');
    expect(accessUtils).toContain("export function visibleAccountActions");
    expect(accessUtils).toContain("export function accessManagementState");
    expect(accessUtils).toContain("export function accessSummary");
  });

  it('retains every authorized Account drawer capability while reducing simultaneous visual actions', () => {
    for (const action of ['approve', 'edit', 'reset-password', 'view-as', 'suspend', 'activate']) expect(accessPage).toContain(`actions.includes('${action}')`);
    expect(accessPage).toContain('const moreActions: DataRowAction[] = [];');
    expect(accessPage).toContain('<DataRowActionMenu');
    expect(accessPage).toContain('account-danger-zone');
    expect(accessPage).toContain("const primary = actions.includes('approve') ? 'approve' : actions.includes('edit') ? 'edit' : actions.includes('activate') ? 'activate' : undefined;");
  });

  it('keeps Access edit, approve, suspend, and activate payloads unchanged', () => {
    const exactEdit = "onUpdate(target.id, { role: selectedRole, department: department || null, accountStatus: selectedStatus, isActive: selectedActive })";
    expect((accessPage.match(new RegExp(exactEdit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length).toBeGreaterThanOrEqual(2);
    expect(accessPage).toContain("onUpdate(target.id, { role: 'VIEWER', department: department || null, accountStatus: 'ACTIVE', isActive: true })");
    expect(accessPage).toContain("setSelectedStatus(isAccountActive(account) ? 'SUSPENDED' : 'ACTIVE')");
    expect(accessPage).toContain('setSelectedActive(!isAccountActive(account))');
  });

  it('keeps reset-password policy and sensitive value behavior unchanged while adding accessible visibility control', () => {
    expect(accessPage).toContain('onResetPassword(target.id, password)');
    expect(accessPage).toContain('minLength={8}');
    expect(accessPage).toContain('autoComplete="new-password"');
    expect(accessPage).toContain("type={showPassword ? 'text' : 'password'}");
    expect(accessPage).toContain("name={showPassword ? 'eyeOff' : 'eye'}");
    expect(accessPage).not.toContain('console.log(password');
    expect(accessPage).not.toContain('defaultValue={password');
  });

  it('keeps View As security confirmation and original-user protection unchanged', () => {
    expect(accessPage).toContain('executeConfirmedViewAs(target.id, onViewAs)');
    expect(accessPage).toContain('viewAsConfirmation.title');
    expect(accessPage).toContain('viewAsConfirmation.description');
    expect(accessPage).toContain('viewAsConfirmation.confirmLabel');
    expect(accessPage).toContain('visibleAccountActions(role, account, originalUserId)');
    expect(accessUtils).toContain("if (role !== 'ADMIN') return [];");
    expect(accessUtils).toContain('if (account.id !== originalUserId');
  });

  it('keeps manager/admin visibility and Audit navigation unchanged', () => {
    expect(accessPage).toContain("const manager = role === 'MANAGER';");
    expect(accessPage).toContain('onOpenAudit={() => { closeDetails(); onOpenAudit(); }}');
    expect(accessPage).toContain('ดู Audit &amp; Compliance');
    expect(main).toContain("if (page === 'users') return ['ADMIN', 'MANAGER'].includes(auth.user?.role || '')");
  });

  it('provides foreground-first dialog stacking, Escape suspension, body locking, and focus restoration', () => {
    expect(accessPage).toContain('suspendEscape={Boolean(dialog)}');
    expect(accessPage).toContain("if (!suspendEscape) window.addEventListener('keydown', onKey)");
    expect(accessPage).toContain('const releaseScrollLock = acquireDocumentScrollLock()');
    expect(accessPage).toContain('releaseScrollLock()');
    expect(accessPage).toContain("if (event.key === 'Escape')");
    expect(accessPage).toContain('window.setTimeout(() => dialogTriggerRef.current?.focus(), 0)');
    expect(accessCss).toContain('.account-drawer-backdrop{z-index:90');
    expect(accessCss).toContain('.account-modal-backdrop{z-index:110');
  });

  it('keeps mobile Personnel and Access capability reachable without horizontal document layouts', () => {
    expect(personnelCss).toContain('@media(max-width:700px)');
    expect(personnelCss).toContain('.personnel-detail-drawer{width:100%;border-left:0}');
    expect(personnelCss).toContain('.personnel-editor .dialog-grid{grid-template-columns:1fr}');
    expect(accessCss).toContain('@media(max-width:760px)');
    expect(accessCss).toContain('.access-mobile-cards{display:grid');
    expect(accessCss).toContain('.account-drawer{width:100%;border-left:0}');
    expect(accessCss).toContain('.account-danger-zone button{width:100%}');
  });

  it('uses semantic Light/Dark-capable styles with readable text and 40px-plus touched controls', () => {
    for (const css of [personnelCss, accessCss, lifecycleCss]) {
      expect(css).toContain('var(--color-surface');
      expect(css).toContain('var(--color-text');
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(css).not.toMatch(/font-size:\s*(?:10|11)px/);
    }
    expect(personnelCss).toContain('width:40px;height:40px');
    expect(accessCss).toContain('min-height:40px');
    expect(lifecycleCss).toContain('width:40px;height:40px');
  });

  it('uses internal SVG controls for new UX-06 actions instead of newly introduced Unicode control glyphs', () => {
    for (const icon of ["'plus'", "'edit'", "'key'", "'pause'", "'check'", "'refresh'"]) expect(smsIcon).toContain(icon);
    for (const source of [personnelHeader, personnelDrawer, accessPage]) {
      expect(source).not.toContain('>×</button>');
      expect(source).not.toContain('↻');
    }
  });

  it('does not add fake Personnel or Access data/capabilities', () => {
    for (const forbidden of ['fakeCount', 'demo account', 'attendanceScore', 'salary', 'confidenceScore']) {
      expect(personnelPage + personnelDrawer + accessPage).not.toContain(forbidden);
    }
    expect(accessPage).not.toContain('permissionMatrix');
  });

  it('preserves the accepted UX-05 Registration Review interaction contract', () => {
    expect(reviewPanel).toContain('เลือกพนักงาน');
    expect(reviewPanel).toContain('เปรียบเทียบก่อนจับคู่');
    expect(reviewPanel).toContain('api.matchRegistrationRequest(token, selected.id, employeeId)');
    expect(reviewPanel).toContain('อนุมัติเป็น VIEWER');
    expect(reviewPanel).toContain('role="dialog"');
    expect(reviewPanel).not.toContain('window.prompt');
    expect(reviewPanel).not.toContain('window.confirm');
  });

  it('locks the authorized V1.2 API source after the Passkey extension', () => {
    expect(apiSha256).toBe('762764230f03a4a5f70349b2c58c9b569f23b2a419cc016b79da05cdc77f229b');
  });
});
