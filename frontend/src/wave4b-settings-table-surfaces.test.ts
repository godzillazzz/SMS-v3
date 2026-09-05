import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) => fs.readFileSync(path.join(__dirname, relativePath), 'utf8').replace(/\r\n/g, '\n');

describe('WAVE 4B Settings table surfaces', () => {
  const registry = read('components/ConfigurationRegistryPanel.tsx');
  const leaveTypes = read('components/LeaveTypeMasterPanel.tsx');
  const retention = read('components/DataRetentionCenterPanel.tsx');
  const css = read('styles/configuration-center.css');

  it('uses the shared shell for read-only Configuration Registry metadata', () => {
    expect(registry).toContain('ResponsiveDataTable');
    expect(registry).toContain('configuration-registry-mobile-cards');
    expect(registry).toContain('DataTableState');
    expect(registry).toContain('className="data-surface-table configuration-registry-data-table"');
    expect((registry.match(/<th scope="col"/g) ?? []).length).toBe(7);
  });

  it('keeps Leave Type edit/create authority while exposing equivalent mobile actions', () => {
    expect(leaveTypes).toContain('ResponsiveDataTable');
    expect(leaveTypes).toContain('LeaveTypeCard');
    expect(leaveTypes).toContain('onSave={() => void submitEdit()}');
    expect(leaveTypes).toContain('onCancel={() => { setEditingId(undefined); setEditForm({}); }}');
    expect(leaveTypes).toContain('ไม่มีคำสั่ง Delete สำหรับ Leave Type Master');
    expect((leaveTypes.match(/<th scope="col"/g) ?? []).length).toBe(7);
  });

  it('keeps Retention policy controls intact while making recent runs readable on mobile', () => {
    expect(retention).toContain('retention-runs-responsive-table');
    expect(retention).toContain('retention-runs-mobile-cards');
    expect(retention).toContain('DataTableSkeletonRows columnCount={4}');
    expect(retention).toContain('DataTableState variant="empty"');
    expect(retention).toContain('runRetentionCleanup(token');
    expect(retention).toContain('acknowledgeCleanup: true');
    expect((retention.match(/<th scope="col"/g) ?? []).length).toBe(4);
  });

  it('switches only the selected low-risk tables to cards below the mobile breakpoint', () => {
    expect(css).toContain('.configuration-registry-responsive-table > .data-table-desktop');
    expect(css).toContain('.leave-type-responsive-table > .data-table-mobile');
    expect(css).toContain('.retention-runs-responsive-table > .data-table-mobile');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('min-height: 44px');
  });
});
