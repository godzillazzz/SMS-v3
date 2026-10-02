import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('simple attendance safety contract', () => {
  it('keeps encrypted offline queue and GPS geofence', () => {
    const root = process.cwd();
    const storage = fs.readFileSync(path.join(root, 'src/pages/attendance-simple/attendance-simple-storage.ts'), 'utf8');
    const page = fs.readFileSync(path.join(root, 'src/pages/attendance-simple/AttendanceSimplePage.tsx'), 'utf8');
    expect(storage).toContain('AES-GCM');
    expect(storage).toContain('privateKeyNonExportable');
    expect(storage).toContain('gpsGeofenceDecision');
    expect(page).toContain('CONFIDENT_OUTSIDE');
    expect(page).toContain('enqueueEncrypted');
  });

  it('routes employee attendance to the simple page', () => {
    const main = fs.readFileSync(path.join(process.cwd(), 'src/main.tsx'), 'utf8');
    expect(main).toContain('return <AttendanceSimplePage');
    expect(main).toContain('OfflineAttendanceGate');
  });
});
