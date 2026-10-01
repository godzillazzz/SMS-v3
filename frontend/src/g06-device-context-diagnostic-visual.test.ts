import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const css = fs.readFileSync(path.join(root, 'styles/g06-device-context-diagnostic.css'), 'utf8');
const page = fs.readFileSync(path.join(root, 'pages/attendance-device/G06DeviceContextDiagnosticPage.tsx'), 'utf8');

describe('G06 device-context diagnostic visual safety', () => {
  it('renders an opaque high-contrast diagnostic surface on mobile instead of exposing the app background', () => {
    expect(css).toContain('min-height: 100dvh');
    expect(css).toContain('background: #f8fafc');
    expect(css).toContain('color: #0f172a');
    expect(css).toContain('border: 1px solid #cbd5e1');
    expect(css).toContain('color: #334155');
    expect(css).toContain('font-weight: 800');
  });

  it('keeps the page on the read-only IndexedDB diagnostic path', () => {
    expect(page).toContain('inspectAttendanceDeviceKeyStorageReadOnly');
    expect(page).not.toContain('fetch(');
    expect(page).not.toContain('/api/v1/');
  });
});