export function isG06DeviceContextDiagnosticBuild(vercel: string | undefined, environment: string | undefined) {
  return vercel === '1' && (environment === 'preview' || environment === 'production');
}

export function isG06DeviceContextDiagnosticRequested(input: { diagnosticBuild: boolean; search: string }) {
  const values = new URLSearchParams(input.search).getAll('g06DeviceContextDiagnostic');
  return input.diagnosticBuild && values.length === 1 && values[0] === '1';
}

export function shouldOpenG06DeviceContextDiagnostic(input: { authenticated: boolean; diagnosticBuild: boolean; search: string }) {
  return input.authenticated && isG06DeviceContextDiagnosticRequested(input);
}
