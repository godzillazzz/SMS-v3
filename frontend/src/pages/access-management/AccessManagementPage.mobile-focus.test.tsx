/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccessManagementPage } from './AccessManagementPage';

afterEach(cleanup);

const account = {
  id: 'employee-account-1',
  displayName: 'Controlled Test Account',
  role: 'VIEWER',
  department: 'WCS',
  accountStatus: 'ACTIVE',
  isActive: true,
  passwordResetRequired: false,
  createdAt: '2026-09-01T00:00:00.000Z'
};

function openResetPasswordDialog() {
  render(<AccessManagementPage
    rows={[account]}
    loading={false}
    role="ADMIN"
    onRefresh={() => {}}
    onUpdate={async () => {}}
    onResetPassword={async () => {}}
    onViewAs={async () => {}}
    onOpenAudit={() => {}}
  />);

  fireEvent.click(screen.getByRole('button', { name: 'รายละเอียด' }));
  fireEvent.click(screen.getByRole('button', { name: /การทำงานเพิ่มเติมสำหรับบัญชี/ }));
  const resetAction = screen.getByRole('menuitem', { name: 'รีเซ็ตรหัสผ่าน' });
  fireEvent.click(resetAction);

  return {
    modal: screen.getByRole('dialog', { name: 'รีเซ็ตรหัสผ่าน' }),
    passwordInput: screen.getByLabelText('รหัสผ่านใหม่') as HTMLInputElement,
    returnFocusTarget: screen.getByRole('button', { name: /การทำงานเพิ่มเติมสำหรับบัญชี/ })
  };
}

describe('AccessManagementPage reset-password mobile focus', () => {
  test('keeps focus and the same modal through continuous typing, then restores focus on Escape', async () => {
    const { modal, passwordInput, returnFocusTarget } = openResetPasswordDialog();
    await waitFor(() => expect(document.activeElement).toBe(passwordInput));

    let value = '';
    for (const character of 'Ab12cd34') {
      value += character;
      fireEvent.change(passwordInput, { target: { value } });
      await new Promise((resolve) => window.setTimeout(resolve, 5));

      expect(document.activeElement).toBe(passwordInput);
      expect(screen.getByRole('dialog', { name: 'รีเซ็ตรหัสผ่าน' })).toBe(modal);
      expect(passwordInput.isConnected).toBe(true);
    }

    expect(passwordInput.value).toBe('Ab12cd34');
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'รีเซ็ตรหัสผ่าน' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(returnFocusTarget));
  }, 15_000);
});
