import { describe, expect, it } from 'vitest';
import { shouldOpenG06PreviewDeviceDiagnostic } from './g06-preview-diagnostic-route';

describe('G06 Preview-only diagnostic route gate', () => {
  it('opens only for a Preview build and the exact diagnostic query flag', () => {
    expect(shouldOpenG06PreviewDeviceDiagnostic({ previewBuild: true, search: '?g06DeviceContextDiagnostic=1' })).toBe(true);
    expect(shouldOpenG06PreviewDeviceDiagnostic({ previewBuild: false, search: '?g06DeviceContextDiagnostic=1' })).toBe(false);
    expect(shouldOpenG06PreviewDeviceDiagnostic({ previewBuild: true, search: '?g06DeviceContextDiagnostic=0' })).toBe(false);
    expect(shouldOpenG06PreviewDeviceDiagnostic({ previewBuild: true, search: '' })).toBe(false);
  });
});
