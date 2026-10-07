// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalCenterNotificationButton } from './ApprovalCenterNotificationButton';

afterEach(() => cleanup());

describe('ApprovalCenterNotificationButton', () => {
  it('keeps the bell available without showing an uninitialized zero badge', () => {
    const { container } = render(<ApprovalCenterNotificationButton count={null} onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'เปิดศูนย์อนุมัติ' })).toBeTruthy();
    expect(container.querySelector('.topbar-notification-badge')).toBeNull();
    expect(container.textContent).not.toContain('0');
  });

  it('shows a nonzero loaded count and hides the badge for a loaded zero', () => {
    const { container, rerender } = render(<ApprovalCenterNotificationButton count={0} onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'คำขออนุมัติ 0 รายการ' })).toBeTruthy();
    expect(container.querySelector('.topbar-notification-badge')).toBeNull();

    rerender(<ApprovalCenterNotificationButton count={4} onClick={vi.fn()} />);
    expect(container.querySelector('.topbar-notification-badge')?.textContent).toBe('4');
  });
});
