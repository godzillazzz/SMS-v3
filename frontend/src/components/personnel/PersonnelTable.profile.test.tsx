// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PersonnelTable } from './PersonnelTable';

const employee = { id: '1', employeeCode: 'E001', firstName: 'สมชาย', lastName: 'ใจดี', isActive: true };
afterEach(cleanup);

it('opens the selected employee profile using the eye action without edit permission', () => {
  const onSelect = vi.fn();
  const onEdit = vi.fn();
  render(<PersonnelTable rows={[employee]} canManage={false} onSelect={onSelect} onEdit={onEdit} />);
  fireEvent.click(screen.getByRole('button', { name: 'ดูข้อมูล สมชาย ใจดี' }));
  expect(onSelect).toHaveBeenCalledOnce();
  expect(onSelect).toHaveBeenCalledWith(employee);
  expect(onEdit).not.toHaveBeenCalled();
});
