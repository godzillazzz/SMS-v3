export function shouldOpenG06PreviewDeviceDiagnostic(input: { previewBuild: boolean; search: string }) {
  return input.previewBuild && new URLSearchParams(input.search).get('g06DeviceContextDiagnostic') === '1';
}
