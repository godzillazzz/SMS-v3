import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const main = fs.readFileSync(path.join(__dirname, 'main.tsx'), 'utf8');
const navigation = main.slice(main.indexOf('const navigation:'), main.indexOf('function AuthProvider'));
const block = main.slice(main.indexOf('const visibleNavigation = navigation'), main.indexOf('const workflowCommands'));

describe('navigation agreements D-U2 / D-U3', () => {
  it('hides the clock-in menu for accounts without a linked employee, without touching route permissions', () => {
    expect(block).toContain("!(item.id === 'attendance' && !auth.user?.employeeId)");
    expect(block).toContain('canViewPage(item.id)');
  });
  it('moves leave approvals to the Approval Center menu entry only', () => {
    expect(block).toContain("item.id !== 'leavePending'");
    expect(main).toContain("{ id: 'approvalCenter', icon: 'bell', label: 'ศูนย์อนุมัติ' }");
  });
  it('preserves the Owner legacy leave-quota navigation label', () => {
    expect(navigation).toContain("label: 'โควต้าวันลา'");
    expect(navigation).not.toContain("label: 'โควตาวันลา'");
  });
});
