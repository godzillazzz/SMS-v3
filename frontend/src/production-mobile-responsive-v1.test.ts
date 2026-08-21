import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { acquireDocumentScrollLock, documentScrollLockCount } from './document-scroll-lock';

const source = (file: string) => fs.readFileSync(path.resolve(process.cwd(), 'src', file), 'utf8');
const main = source('main.tsx');
const css = source('styles/production-mobile-responsive-v1.css');
const lockSource = source('document-scroll-lock.ts');
const lockUsers = [
  'main.tsx',
  'components/OperationalRecordDrawer.tsx',
  'components/LicenseDocuments.tsx',
  'components/audit/AuditEventPreview.tsx',
  'components/personnel/EmployeeLifecycleModal.tsx',
  'components/personnel/PersonnelDetailDrawer.tsx',
  'pages/access-management/AccessManagementPage.tsx',
  'pages/access-management/RegistrationReviewPanel.tsx'
];

describe('Production Mobile Responsive Hotfix V1', () => {
  test('reference-counts document locks and restores baseline styles only after the final release', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const fakeDocument = { body: { style: { overflow: 'auto' } }, documentElement: { style: { overflow: 'scroll' } } };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument });
    try {
      const releaseFirst = acquireDocumentScrollLock();
      const releaseSecond = acquireDocumentScrollLock();
      expect(documentScrollLockCount()).toBe(2);
      expect(fakeDocument.body.style.overflow).toBe('hidden');
      expect(fakeDocument.documentElement.style.overflow).toBe('hidden');
      releaseFirst();
      expect(documentScrollLockCount()).toBe(1);
      expect(fakeDocument.body.style.overflow).toBe('hidden');
      releaseSecond();
      expect(documentScrollLockCount()).toBe(0);
      expect(fakeDocument.body.style.overflow).toBe('auto');
      expect(fakeDocument.documentElement.style.overflow).toBe('scroll');
      releaseSecond();
      expect(documentScrollLockCount()).toBe(0);
    } finally {
      if (original) Object.defineProperty(globalThis, 'document', original);
      else Reflect.deleteProperty(globalThis, 'document');
    }
  });

  test('routes all known fullscreen overlays through one scroll-lock owner', () => {
    for (const file of lockUsers) {
      const content = source(file);
      expect(content, file).toContain('acquireDocumentScrollLock');
      expect(content, file).not.toMatch(/document\.(?:body|documentElement)\.style\.overflow\s*=\s*['"]hidden['"]/);
    }
    expect(lockSource).toContain('activeDocumentScrollLocks += 1');
    expect(lockSource).toContain('if (activeDocumentScrollLocks !== 0) return');
    expect(main).toContain('setMobileMenuOpen(false)');
    expect(main).toContain('setMobileUtilityOpen(false)');
  });

  test('renders Leave History as complete mobile cards while retaining its desktop table', () => {
    expect(main).toContain('leave-history-desktop-table');
    expect(main).toContain('leave-history-mobile-list');
    expect(main).toContain('leave-history-mobile-card');
    expect(main).toContain('employee.employeeCode');
    expect(main).toContain('row.substitute || row.substituteName');
    expect(main).toContain("'ไม่มีรายการ', true)");
    expect(css).toContain('.leave-history-card .leave-history-desktop-table');
  });

  test('keeps the mobile header safe-area aware without adding a duplicate content offset', () => {
    expect(css).toContain('--sms-mobile-header-height: 60px');
    expect(css).toContain('env(safe-area-inset-top, 0px)');
    expect(css).toContain('margin-top: max(var(--sms-mobile-header-gap), env(safe-area-inset-top, 0px))');
    expect(css).toContain('scroll-padding-top: calc(var(--sms-mobile-header-height)');
  });

  test('resets the license search flex basis to a normal mobile control height', () => {
    expect(css).toContain('.data-surface-page--licenses .search-box.data-search-control');
    expect(css).toContain('flex: 0 0 auto');
    expect(css).toContain('height: 50px');
    expect(css).toContain('min-height: 50px');
  });

  test('contains Schedule controls inside readable cells while preserving intentional horizontal touch scroll', () => {
    expect(css).toContain('overflow-x: auto');
    expect(css).toContain('-webkit-overflow-scrolling: touch');
    expect(css).toContain('touch-action: pan-x pan-y');
    expect(css).toContain('min-width: 112px');
    expect(css).not.toContain('grid-template-columns: minmax(0, 1fr) 40px');

    const deleteRule = css.match(/\.schedule-calendar-page \.calendar-delete,[\s\S]*?\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(deleteRule).toContain('position: absolute');
    expect(deleteRule).toContain('top: auto');
    expect(deleteRule).toContain('right: 6px');
    expect(deleteRule).toContain('bottom: 6px');
    expect(deleteRule).toContain('width: 36px');
    expect(deleteRule).toContain('height: 36px');
    expect(deleteRule).toContain('min-width: 36px');
    expect(deleteRule).toContain('min-height: 36px');
    expect(deleteRule).toContain('max-width: 36px');
    expect(deleteRule).toContain('max-height: 36px');
    expect(deleteRule).toContain('padding: 0');
    expect(deleteRule).toContain('transform: none');
    expect(deleteRule).not.toMatch(/(?:top|right|bottom|left):\s*-/);
  });

  test('portals the mobile utility foreground to the viewport root and locks through the shared owner', () => {
    expect(main).toContain('mobileUtilityOpen && createPortal(<>');
    expect(main).toContain('</>, document.body)');
    const utilityEffect = main.slice(main.indexOf('if (!mobileUtilityOpen) return;'), main.indexOf('}, [mobileUtilityOpen]);'));
    expect(utilityEffect).toContain('acquireDocumentScrollLock()');
    expect(utilityEffect).toContain('releaseScrollLock()');
    expect(css).toContain('.mobile-utility-backdrop');
    expect(css).toContain('z-index: 100');
    expect(css).toContain('.mobile-utility-panel');
    expect(css).toContain('z-index: 101');
  });

  test('keeps Leave Request on native document scrolling with explicit vertical touch panning', () => {
    expect(css).toContain('.leave-page.leave-mode-all');
    expect(css).toContain('.leave-page.leave-mode-all .leave-submit-card form');
    expect(css).toContain('touch-action: pan-y');
    expect(css).not.toMatch(/\.leave-page\.leave-mode-all[\s\S]{0,260}overflow-y:\s*(?:auto|scroll)/);
  });

  test('uses natural mobile sheet heights with bounded internal scrolling', () => {
    expect(css).toContain('.signature-record-drawer');
    expect(css).toContain('height: auto');
    expect(css).toContain('max-height: 92dvh');
    expect(css).toContain('.signature-record-drawer__body');
    expect(css).toContain('overflow-y: auto');
    expect(css).toContain('.license-modal-dialog');
    expect(css).toContain('min-height: 0');
    expect(css).toContain('env(safe-area-inset-bottom, 0px)');
  });
});
