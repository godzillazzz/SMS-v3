import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mainTsx = fs.readFileSync(path.join(__dirname, 'main.tsx'), 'utf-8');
const stylesCss = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf-8');

function cssBlock(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return stylesCss.match(new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`))?.[1] || '';
}

describe('Shift editor modal viewport isolation', () => {
  test('the monthly schedule renders one ShiftEditorModal implementation', () => {
    expect(mainTsx.match(/function ShiftEditorModal\(/g)).toHaveLength(1);
    expect(mainTsx.match(/<ShiftEditorModal/g)).toHaveLength(1);
    expect(mainTsx.match(/function EmployeeMagicWandModal\(/g)).toHaveLength(1);
    expect(mainTsx.match(/<EmployeeMagicWandModal/g)).toHaveLength(1);
    expect(mainTsx).toContain("if ((activePage as string) === 'schedule')");
    expect(mainTsx).toContain('{shiftEditorTarget && (');
  });

  test('the portal uses a dedicated body-level modal root', () => {
    expect(mainTsx).toContain("document.getElementById('modal-root')");
    expect(mainTsx).toContain("modalRoot.id = 'modal-root'");
    expect(mainTsx).toContain('document.body.appendChild(modalRoot)');
    expect(mainTsx).toContain('modalRoot.childElementCount === 0');
    expect(mainTsx).toContain('modalRoot.remove()');
    expect(mainTsx).toMatch(/,\s*modalRoot\s*\);/);
    expect(mainTsx).not.toContain('className="schedule-modal-overlay"');
  });

  test('the viewport overlay cannot follow page or table scrolling', () => {
    const viewportRules = cssBlock('.shift-editor-modal__viewport');

    expect(viewportRules).toContain('position: fixed !important');
    expect(viewportRules).toContain('inset: 0 !important');
    expect(viewportRules).toContain('z-index: 2147483000');
    expect(viewportRules).toContain('width: 100vw');
    expect(viewportRules).toContain('height: 100dvh');
    expect(viewportRules).toContain('align-items: center');
    expect(viewportRules).toContain('justify-content: center');
    expect(viewportRules).toContain('overflow: auto');
    expect(viewportRules).toContain('overscroll-behavior: contain');
    expect(viewportRules).toContain('isolation: isolate');
  });

  test('the dialog stays responsive and scrolls inside short viewports', () => {
    const dialogRules = cssBlock('.shift-editor-modal__dialog');

    expect(dialogRules).toContain('width: min(570px, 100%)');
    expect(dialogRules).toContain('max-height: calc(100dvh - 32px)');
    expect(dialogRules).toContain('overflow-y: auto');
    expect(dialogRules).toContain('margin: auto');
    expect(stylesCss).toContain('.shift-editor-modal__dialog { padding: 18px 16px; border-radius: 16px; }');
    expect(stylesCss).toContain('.schedule-modal-form-grid { grid-template-columns: 1fr; }');
  });

  test('Escape, backdrop, scroll lock, and focus restoration are wired', () => {
    expect(mainTsx).toContain("if (event.key === 'Escape') onCloseRef.current()");
    expect(mainTsx).toContain('if (event.target === event.currentTarget) onClose()');
    expect(mainTsx).toContain('onMouseDown={(event) => event.stopPropagation()}');
    expect(mainTsx).toContain("document.body.style.overflow = 'hidden'");
    expect(mainTsx).toContain('document.body.style.overflow = previousOverflow');
    expect(mainTsx).toContain('initialFocusRef.current?.focus({ preventScroll: true })');
    expect(mainTsx).toContain('previouslyFocusedElement?.focus({ preventScroll: true })');
  });

  test('the magic-wand modal also renders in the dedicated viewport portal', () => {
    expect(mainTsx).toContain('className="employee-magic-wand-modal__viewport"');
    expect(mainTsx).toContain('className="employee-magic-wand-modal__dialog magic-wand-dialog"');
    expect(mainTsx).not.toContain('className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}');
    expect(stylesCss).toContain('.employee-magic-wand-modal__viewport {');
    expect(stylesCss).toContain('.employee-magic-wand-modal__dialog {');
  });
});
