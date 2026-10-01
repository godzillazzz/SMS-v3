import { describe, expect, it } from 'vitest';
import { isG06DeviceContextDiagnosticBuild, isG06DeviceContextDiagnosticRequested, shouldOpenG06DeviceContextDiagnostic } from './g06-device-context-diagnostic-route';

describe('G06 device-context diagnostic gates', () => {
  it('enables the diagnostic only for Vercel Preview and Production builds', () => {
    expect(isG06DeviceContextDiagnosticBuild('1', 'preview')).toBe(true);
    expect(isG06DeviceContextDiagnosticBuild('1', 'production')).toBe(true);
    expect(isG06DeviceContextDiagnosticBuild('1', 'development')).toBe(false);
    expect(isG06DeviceContextDiagnosticBuild(undefined, 'production')).toBe(false);
    expect(isG06DeviceContextDiagnosticBuild('1', undefined)).toBe(false);
  });

  it('requires exactly one query flag with value 1', () => {
    expect(isG06DeviceContextDiagnosticRequested({ diagnosticBuild: true, search: '?g06DeviceContextDiagnostic=1' })).toBe(true);
    expect(isG06DeviceContextDiagnosticRequested({ diagnosticBuild: false, search: '?g06DeviceContextDiagnostic=1' })).toBe(false);
    expect(isG06DeviceContextDiagnosticRequested({ diagnosticBuild: true, search: '?g06DeviceContextDiagnostic=0' })).toBe(false);
    expect(isG06DeviceContextDiagnosticRequested({ diagnosticBuild: true, search: '' })).toBe(false);
    expect(isG06DeviceContextDiagnosticRequested({ diagnosticBuild: true, search: '?g06DeviceContextDiagnostic=0&g06DeviceContextDiagnostic=1' })).toBe(false);
  });

  it('still requires normal authentication before displaying the diagnostic', () => {
    const input = { diagnosticBuild: true, search: '?g06DeviceContextDiagnostic=1' };
    expect(shouldOpenG06DeviceContextDiagnostic({ ...input, authenticated: false })).toBe(false);
    expect(shouldOpenG06DeviceContextDiagnostic({ ...input, authenticated: true })).toBe(true);
  });
});
