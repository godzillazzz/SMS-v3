import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const main = fs.readFileSync(path.join(__dirname, 'main.tsx'), 'utf8');

// Owner request (2026-10-28): supervisors and managers used to approve leave from the PWA "ลา" page.
// The PWA shell forced canManage=false, hiding the pending queue. The API already authorises
// ADMIN/MANAGER/SUPERVISOR (and the approval policy), so the page must use the same role gate in the PWA.
describe('PWA leave page lets reviewers decide', () => {
  it('does not disable leave management just because the PWA shell is active', () => {
    expect(main).not.toContain('canManage={pwaShell ? false : canManage}');
    expect(main).toMatch(/<LeaveManagementPage [^>]*canManage=\{canManage\}/);
  });

  it('still blocks decisions while the PWA is offline', () => {
    expect(main).toMatch(/<LeaveManagementPage [^>]*mutationsEnabled=\{!pwaShell \|\| pwaOnline\}/);
  });
});

// Owner follow-up (2026-10-28): supervisors still could not approve on mobile. The PWA "ลา" tab renders the
// leave page in mode "all", where the desktop stylesheet hides the pending-approval card. Inside the PWA the
// card is the only place reviewers can decide, so it must be visible there (role gate stays canManage).
describe("PWA leave page shows the pending-approval card", () => {
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  it("overrides the desktop mode-all hide rule inside the PWA shell", () => {
    expect(styles).toContain(".leave-mode-all .leave-pending-card { display: none; }");
    expect(styles).toMatch(/\.pwa-shell \.leave-page\.leave-mode-all \.leave-pending-card \{ display: block; \}/);
  });
});
