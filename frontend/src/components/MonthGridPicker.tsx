import { createPortal } from 'react-dom';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

export type MonthParts = { year: number; month: number };

const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

export function currentBangkokMonth(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value || String(date.getUTCFullYear());
  const month = parts.find((part) => part.type === 'month')?.value || String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function parseMonthValue(value: string | null | undefined, fallback = currentBangkokMonth()): MonthParts {
  const match = /^(\d{4})-(\d{1,2})$/.exec(String(value || ''));
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR || !Number.isInteger(month) || month < 1 || month > 12) return parseMonthValue(fallback, currentBangkokMonth());
  return { year, month };
}

export function normalizeMonthValue(value: string | null | undefined, fallback = currentBangkokMonth()): string {
  const { year, month } = parseMonthValue(value, fallback);
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function shiftMonthValue(value: string, delta: number): string {
  const { year, month } = parseMonthValue(value);
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function formatThaiMonth(value: string): string {
  const { year, month } = parseMonthValue(value);
  const date = new Date(Date.UTC(year, month - 1, 1));
  const name = new Intl.DateTimeFormat('th-TH', { month: 'long', timeZone: 'UTC' }).format(date);
  return `${name} พ.ศ. ${year + 543}`;
}

function getModalRoot(): { element: HTMLElement; owned: boolean } {
  const existing = document.getElementById('modal-root');
  if (existing) return { element: existing, owned: false };
  const element = document.createElement('div');
  element.id = 'modal-root';
  document.body.appendChild(element);
  return { element, owned: true };
}

export function MonthGridPicker({ value, onChange }: { value: string; onChange(value: string): void }) {
  const normalizedValue = normalizeMonthValue(value);
  const selected = parseMonthValue(normalizedValue);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(selected.year);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState({ top: 16, left: 16, width: 324 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const pickerId = useId();

  useEffect(() => {
    setYear(selected.year);
  }, [selected.year]);

  useEffect(() => {
    if (!open) return;
    const root = getModalRoot();
    setPortalRoot(root.element);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      if (root.owned && root.element.childElementCount === 0) root.element.remove();
      setPortalRoot(null);
      window.setTimeout(() => previousFocusRef.current?.focus({ preventScroll: true }), 0);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !portalRoot) return;
    const updatePosition = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const width = Math.min(324, window.innerWidth - 32);
      const panelHeight = panelRef.current?.offsetHeight || 280;
      const left = Math.min(Math.max(16, trigger.left), Math.max(16, window.innerWidth - width - 16));
      const below = trigger.bottom + 8;
      const top = below + panelHeight <= window.innerHeight - 16 ? below : Math.max(16, trigger.top - panelHeight - 8);
      setPosition({ top, left, width });
    };
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('resize', updatePosition); window.removeEventListener('scroll', updatePosition, true); };
  }, [open, portalRoot, year]);

  const choose = (month: number, pickerYear = year) => {
    onChange(`${pickerYear}-${String(month).padStart(2, '0')}`);
    setOpen(false);
  };

  const handleGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const currentMonth = Number(target.dataset.month);
    if (!currentMonth) return;
    let nextMonth = currentMonth;
    let nextYear = year;
    if (event.key === 'ArrowLeft') nextMonth -= 1;
    if (event.key === 'ArrowRight') nextMonth += 1;
    if (event.key === 'ArrowUp') nextMonth -= 4;
    if (event.key === 'ArrowDown') nextMonth += 4;
    if (event.key === 'Home') nextMonth = 1;
    if (event.key === 'End') nextMonth = 12;
    if (nextMonth < 1) { nextMonth = 12; nextYear -= 1; }
    if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
    if (nextMonth === currentMonth && nextYear === year) return;
    event.preventDefault();
    setYear(nextYear);
    choose(nextMonth, nextYear);
  };

  const selectedDate = new Date(Date.UTC(selected.year, selected.month - 1, 1));
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(selectedDate);
  const monthNames = Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(year, index, 1))));

  const panel = portalRoot && open ? createPortal(
    <div ref={panelRef} id={pickerId} className="month-grid-panel month-grid-panel-portal" style={{ top: position.top, left: position.left, width: position.width }} onMouseDown={(event) => event.stopPropagation()} onKeyDown={handleGridKeyDown}>
      <div className="month-grid-year">
        <strong>{year}</strong>
        <span><button type="button" className="btn-icon-only" aria-label="ปีก่อนหน้า" onClick={() => setYear((current) => current - 1)}>▲</button><button type="button" className="btn-icon-only" aria-label="ปีถัดไป" onClick={() => setYear((current) => current + 1)}>▼</button></span>
      </div>
      <div className="month-grid" role="grid" aria-label="เลือกเดือน">
        {monthNames.map((name, index) => {
          const month = index + 1;
          const isSelected = year === selected.year && month === selected.month;
          return <button type="button" role="gridcell" data-month={month} key={`${year}-${month}`} className={isSelected ? 'selected' : ''} aria-pressed={isSelected} onClick={() => choose(month)}>{name}</button>;
        })}
      </div>
    </div>,
    portalRoot
  ) : null;

  return <>
    <div className="month-grid-picker">
      <button ref={triggerRef} type="button" className="month-grid-trigger" onClick={() => { previousFocusRef.current = document.activeElement as HTMLElement; setOpen((visible) => !visible); }} aria-expanded={open} aria-controls={open ? pickerId : undefined} aria-haspopup="grid">
        <span>{monthLabel}, {selected.year}</span><b>⌄</b>
      </button>
    </div>
    {panel}
  </>;
}
