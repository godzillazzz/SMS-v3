/** Shared display and calendar helpers for Gregorian API values in Bangkok time. */
export type DateValue = Date | string | number;

const BANGKOK_TIME_ZONE = 'Asia/Bangkok';
const THAI_BUDDHIST_LATIN = 'th-TH-u-ca-buddhist-nu-latn';

function asDate(value: DateValue): Date {
  return value instanceof Date ? value : new Date(value);
}

function partsFor(value: Date, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', {
    ...options,
    timeZone: options.timeZone || BANGKOK_TIME_ZONE,
  }).formatToParts(value);
}

export function currentBangkokYear(value: DateValue = new Date()): number {
  const date = asDate(value);
  const year = partsFor(date, { year: 'numeric' }).find((part) => part.type === 'year')?.value;
  return Number(year || date.getUTCFullYear());
}

export function currentBangkokMonth(value: DateValue = new Date()): string {
  const date = asDate(value);
  const parts = partsFor(date, { year: 'numeric', month: '2-digit' });
  const year = parts.find((part) => part.type === 'year')?.value || String(date.getUTCFullYear());
  const month = parts.find((part) => part.type === 'month')?.value || String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** A Gregorian YYYY-MM-DD value for date inputs and API filters. */
export function bangkokDateInput(value: DateValue = new Date()): string {
  const date = asDate(value);
  const parts = partsFor(date, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatThaiBuddhistYear(gregorianYear: number): string {
  return String(gregorianYear + 543);
}

export function formatThaiMonthName(month: number, gregorianYear = 2000, width: 'long' | 'short' = 'long'): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError('เดือนต้องอยู่ระหว่าง 1 ถึง 12');
  return new Intl.DateTimeFormat('th-TH', { month: width, timeZone: 'UTC' })
    .format(new Date(Date.UTC(gregorianYear, month - 1, 1)));
}

export function formatThaiMonth(value: string): string {
  const match = /^(\d{4})-(\d{1,2})$/.exec(String(value || ''));
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  if (!match || !Number.isInteger(month) || month < 1 || month > 12) throw new RangeError('รูปแบบเดือนต้องเป็น YYYY-MM');
  return `${formatThaiMonthName(month, year)} พ.ศ. ${formatThaiBuddhistYear(year)}`;
}

/** Month picker label requested by the Thai-language UI (month + Buddhist year). */
export function formatThaiMonthPickerLabel(value: string): string {
  const match = /^(\d{4})-(\d{1,2})$/.exec(String(value || ''));
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  if (!match || !Number.isInteger(month) || month < 1 || month > 12) throw new RangeError('รูปแบบเดือนต้องเป็น YYYY-MM');
  return `${formatThaiMonthName(month, year)} ${formatThaiBuddhistYear(year)}`;
}

export function formatThaiDate(value: DateValue, options: Intl.DateTimeFormatOptions = {}): string {
  const hasStyle = 'dateStyle' in options;
  return new Intl.DateTimeFormat(THAI_BUDDHIST_LATIN, {
    ...(hasStyle ? {} : { day: 'numeric', month: 'short', year: 'numeric' }),
    ...options,
    timeZone: options.timeZone || BANGKOK_TIME_ZONE,
  }).format(asDate(value));
}

export function formatThaiDateTime(value: DateValue, options: Intl.DateTimeFormatOptions = {}): string {
  const hasExplicitComponents = ['weekday', 'era', 'year', 'month', 'day', 'dayPeriod', 'hour', 'minute', 'second', 'fractionalSecondDigits', 'timeZoneName']
    .some((key) => key in options);
  return new Intl.DateTimeFormat(THAI_BUDDHIST_LATIN, {
    ...(hasExplicitComponents ? {} : { dateStyle: 'medium', timeStyle: 'short' }),
    ...options,
    timeZone: options.timeZone || BANGKOK_TIME_ZONE,
  }).format(asDate(value));
}
