export function isG06PreviewUatProvisioningEnabled(vercelEnvironment?: string, flag?: string) {
  return vercelEnvironment === 'preview' && flag === 'true';
}
