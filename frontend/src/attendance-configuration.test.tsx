import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AttendanceConfigurationPage, overnightPreview, validateShiftDraft, validateSiteDraft } from './pages/attendance/AttendanceConfigurationPage';

describe('attendance configuration contracts', () => {
  it('validates Site coordinates and the configured per-Site geofence', () => {
    expect(validateSiteDraft({ code: 'S1', name: 'Site 1', latitude: '13.75', longitude: '100.5', geofenceRadiusMeters: '125' })).toBeUndefined();
    expect(validateSiteDraft({ code: 'S1', name: 'Site 1', latitude: '91', longitude: '100.5', geofenceRadiusMeters: '125' })).toContain('ละติจูด');
    expect(validateSiteDraft({ code: 'S1', name: 'Site 1', latitude: '13.75', longitude: '181', geofenceRadiusMeters: '125' })).toContain('ลองจิจูด');
    expect(validateSiteDraft({ code: 'S1', name: 'Site 1', latitude: '13.75', longitude: '100.5', geofenceRadiusMeters: '0' })).toContain('รัศมี GPS');
  });

  it('supports arbitrary shift templates and makes overnight configuration explicit', () => {
    expect(validateShiftDraft({ code: 'CUSTOM', name: 'Custom', startTime: '08:00', endTime: '16:00', hours: '8', isOvernight: 'false' })).toBeUndefined();
    expect(validateShiftDraft({ code: 'NIGHT', name: 'Night', startTime: '19:00', endTime: '07:00', hours: '12', isOvernight: 'false' })).toContain('กะข้ามวัน');
    expect(overnightPreview('19:00', '07:00', true)).toContain('วันถัดไป');
  });

  it('renders an Admin configuration surface without employee Attendance capture controls', () => {
    const html = renderToStaticMarkup(<AttendanceConfigurationPage role="ADMIN" />);
    expect(html).toContain('ตั้งค่าระบบลงเวลา');
    expect(html).toContain('จุดปฏิบัติงาน');
    expect(html).not.toMatch(/<button[^>]*>[^<]*(Check-in|Check-out)/i);
  });
});
