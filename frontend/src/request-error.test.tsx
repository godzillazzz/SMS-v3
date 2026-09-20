import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiRequestError } from './api';
import { RequestErrorContent, RequestErrorReference, copyRequestId, formatRequestErrorMessage, toRequestErrorState } from './request-error';

describe('request error reference UI', () => {
  it('renders the visible reference label, selectable text, and copy control when requestId exists', () => {
    const html = renderToStaticMarkup(<RequestErrorReference requestId="syd1:iad1::safe-123" />);
    expect(html).toContain('รหัสอ้างอิง');
    expect(html).toContain('syd1:iad1::safe-123');
    expect(html).toContain('คัดลอกรหัส');
    expect(html).toContain('<code');
  });

  it('does not render a reference section when requestId is absent or invalid', () => {
    expect(renderToStaticMarkup(<RequestErrorReference />)).toBe('');
    expect(renderToStaticMarkup(<RequestErrorReference requestId={'bad\nrequest'} />)).toBe('');
  });

  it('copies the exact normalized request ID and reports success without changing the readable ID', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const button = { textContent: 'คัดลอกรหัส' } as HTMLButtonElement;
    await expect(copyRequestId(' syd1:iad1::copy-123 ', button)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('syd1:iad1::copy-123');
    expect(button.textContent).toBe('คัดลอกแล้ว');
    vi.unstubAllGlobals();
  });

  it('handles clipboard failure without throwing and leaves the request ID available to read', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    await expect(copyRequestId('req-readable')).resolves.toBe(false);
    expect(renderToStaticMarkup(<RequestErrorReference requestId="req-readable" />)).toContain('req-readable');
    vi.unstubAllGlobals();
  });

  it('renders request IDs as escaped React text, never HTML', () => {
    const html = renderToStaticMarkup(<RequestErrorReference requestId={'<img src=x onerror=alert(1)>'} />);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
  });

  it('never renders internal fields from a mock server error object', () => {
    const databaseUrl = ['postgres', 'ql://private'].join('');
    const state = toRequestErrorState({
      message: 'Database unavailable.',
      requestId: 'req-safe-internals',
      stack: 'private-stack',
      databaseUrl,
      sql: 'SELECT secret',
      params: ['private'],
      token: 'private-token',
      storageObjectKey: 'private/object'
    });
    const html = renderToStaticMarkup(<div><RequestErrorContent error={state} /></div>);
    expect(html).toContain('ระบบไม่สามารถดำเนินการได้ชั่วคราว');
    expect(html).toContain('req-safe-internals');
    for (const value of ['private-stack', databaseUrl, 'SELECT secret', 'private-token', 'private/object']) expect(html).not.toContain(value);
  });

  it('formats a supportable inline message with a safe request ID for legacy string surfaces', () => {
    expect(formatRequestErrorMessage(new ApiRequestError('บันทึกไม่สำเร็จ กรุณาลองใหม่', 503, 'req-inline-503'), 'fallback')).toBe('บันทึกไม่สำเร็จ กรุณาลองใหม่ · รหัสอ้างอิง: req-inline-503');
    expect(formatRequestErrorMessage(new ApiRequestError('Internal server error. Prisma SQL token=secret', 500, 'req-inline-safe'), 'ลองใหม่ภายหลัง')).toBe('ลองใหม่ภายหลัง · รหัสอ้างอิง: req-inline-safe');
    expect(formatRequestErrorMessage(new Error('ข้อความจากอุปกรณ์'), 'fallback')).toBe('ข้อความจากอุปกรณ์');
    expect(formatRequestErrorMessage(Object.assign(new Error('Attendance request ไม่สำเร็จ'), { requestId: 'req-attendance-inline' }), 'fallback')).toBe('Attendance request ไม่สำเร็จ · รหัสอ้างอิง: req-attendance-inline');
  });

  it('surfaces only a safe message and request ID for technical server errors', () => {
    const state = toRequestErrorState(new ApiRequestError('Internal server error. stack Prisma SQL token=secret', 500, 'req-safe-500'));
    const html = renderToStaticMarkup(<div><RequestErrorContent error={state} /></div>);
    expect(html).toContain('ระบบไม่สามารถดำเนินการได้ชั่วคราว');
    expect(html).toContain('req-safe-500');
    for (const value of ['stack', 'Prisma', 'SQL', 'token=secret']) expect(html).not.toContain(value);
  });
});
