import { describe, expect, it } from 'vitest';
import { attendanceStampLines, paintAttendanceSelfieStamp } from './pages/attendance-simple/attendance-selfie-stamp';

describe('attendance selfie informational pixel stamp', () => {
  it('paints deterministic stamp pixels after the source frame and carries only safe context', () => {
    const pixels = new Uint8Array(32 * 16 * 4);
    pixels.fill(17); // deterministic source-video frame
    const operations: string[] = [];
    const context = {
      fillStyle: '', font: '', textBaseline: '',
      fillRect: (_x: number, y: number, width: number, height: number) => {
        operations.push('fillRect');
        for (let row = y; row < y + height; row += 1) for (let col = 0; col < width; col += 1) {
          const offset = (row * 32 + col) * 4;
          pixels[offset] = 250; pixels[offset + 1] = 250; pixels[offset + 2] = 250; pixels[offset + 3] = 255;
        }
      },
      fillText: (line: string) => { operations.push(`fillText:${line}`); pixels[(15 * 32 + 1) * 4] = 255; }
    } as unknown as CanvasRenderingContext2D;

    const before = pixels.slice();
    paintAttendanceSelfieStamp(context, 32, 16, {
      employeeName: 'Guard A', employeeCode: 'EMP-7', action: 'CHECK_IN',
      capturedAt: new Date('2026-10-20T03:04:05.000Z'), siteName: 'Bangkok Site',
      supportSite: true, accuracyMeters: 8.4, reference: 'abcd1234'
    });

    expect(pixels).not.toEqual(before);
    expect(operations[0]).toBe('fillRect');
    expect(operations.filter((item) => item.startsWith('fillText:'))).toHaveLength(4);
    expect(attendanceStampLines({ employeeName: 'Guard A', employeeCode: 'EMP-7', action: 'CHECK_IN', capturedAt: new Date('2026-10-20T03:04:05.000Z'), siteName: 'Bangkok Site', supportSite: true, accuracyMeters: 8.4, reference: 'abcd1234' })).toEqual([
      'Guard A · EMP-7', 'CHECK_IN · 20/10/2026, 10:04:05 Asia/Bangkok', 'Site: Bangkok Site · Support Site', 'GPS accuracy: 8 m · Ref: abcd1234'
    ]);
    expect(attendanceStampLines({ employeeName: 'Guard A', employeeCode: 'EMP-7', action: 'CHECK_IN', capturedAt: new Date(), siteName: 'Bangkok Site', supportSite: false, accuracyMeters: 8.4, reference: 'abcd1234' }).join(' ')).not.toMatch(/latitude|longitude|nonce|signature|secret|request/i);
  });
});
