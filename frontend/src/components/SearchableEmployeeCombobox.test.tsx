// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchableEmployeeCombobox, type EmployeeComboboxOption } from './SearchableEmployeeCombobox';

const option = (index: number): EmployeeComboboxOption => ({
  value: `employee-${index}`,
  label: `E${String(index).padStart(3, '0')} · พนักงาน ${index}`
});

const renderCombobox = (options: EmployeeComboboxOption[] = []) => {
  const onChange = vi.fn();
  const onSearch = vi.fn(async (query: string) => options.filter((item) => item.label.includes(query)));
  render(<SearchableEmployeeCombobox id="employee" value="" options={options} onChange={onChange} onSearch={onSearch} />);
  return { onChange, onSearch };
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SearchableEmployeeCombobox', () => {
  it('shows the available employees when opened without a query', () => {
    renderCombobox([option(1), option(2)]);

    fireEvent.focus(screen.getByRole('combobox'));

    expect(screen.getByRole('option', { name: /พนักงาน 1/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /พนักงาน 2/ })).toBeTruthy();
  });

  it('searches after at least two characters', async () => {
    vi.useFakeTimers();
    const { onSearch } = renderCombobox([option(1)]);
    const input = screen.getByRole('combobox');

    fireEvent.change(input, { target: { value: 'E001' } });
    await vi.advanceTimersByTimeAsync(250);

    expect(onSearch).toHaveBeenCalledWith('E001');
  });

  it('renders more than twenty results without silently truncating them', () => {
    renderCombobox(Array.from({ length: 25 }, (_, index) => option(index + 1)));

    fireEvent.focus(screen.getByRole('combobox'));

    expect(screen.getAllByRole('option')).toHaveLength(25);
    expect(screen.getByRole('option', { name: /พนักงาน 25/ })).toBeTruthy();
    expect(screen.queryByText(/พบมากกว่า/)).toBeNull();
  });

  it('limits overflow to one hundred options and explains how to narrow results', () => {
    renderCombobox(Array.from({ length: 101 }, (_, index) => option(index + 1)));

    fireEvent.focus(screen.getByRole('combobox'));

    expect(screen.getAllByRole('option')).toHaveLength(100);
    expect(screen.getByText('พบมากกว่า 100 รายการ กรุณาพิมพ์เพื่อกรองให้แคบลง')).toBeTruthy();
    expect(screen.queryByRole('option', { name: /พนักงาน 101/ })).toBeNull();
  });

  it('keeps selection, clear, Escape, arrow navigation, and Enter behavior', () => {
    const { onChange } = renderCombobox([option(1), option(2)]);
    const input = screen.getByRole('combobox');

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('employee-1');
    expect((input as HTMLInputElement).value).toBe(option(1).label);

    fireEvent.click(screen.getByRole('button', { name: 'ล้างพนักงานที่เลือก' }));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect((input as HTMLInputElement).value).toBe('');

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });
});
