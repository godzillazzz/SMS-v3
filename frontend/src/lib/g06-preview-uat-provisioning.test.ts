import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isG06PreviewUatProvisioningEnabled } from './g06-preview-uat-provisioning';

const accessPage = readFileSync(new URL('../pages/access-management/AccessManagementPage.tsx', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');
const systemHealthService = readFileSync(new URL('../../../src/services/system-health.service.js', import.meta.url), 'utf8');

describe('G06 Preview UAT provisioning visibility', () => {
  it('requires both the Preview deployment environment and its explicit feature flag', () => {
    expect(isG06PreviewUatProvisioningEnabled('preview', 'true')).toBe(true);
    expect(isG06PreviewUatProvisioningEnabled('preview', 'false')).toBe(false);
    expect(isG06PreviewUatProvisioningEnabled('development', 'true')).toBe(false);
    expect(isG06PreviewUatProvisioningEnabled('production', 'true')).toBe(false);
  });

  it('guards the fixture panel itself with the Vercel environment and explicit flag', () => {
    expect(accessPage).toContain("isG06PreviewUatProvisioningEnabled(import.meta.env.VERCEL_ENV, import.meta.env.VITE_G06_PREVIEW_UAT_FIXTURE)");
    expect(accessPage).toContain("role === 'ADMIN' && onProvisionG06Uat && isG06PreviewUatProvisioningEnabled");
    expect(viteConfig).toContain("'import.meta.env.VERCEL_ENV': JSON.stringify(process.env.VERCEL_ENV || '')");
  });

  it('reports the Vercel deployment environment on the system health surface', () => {
    expect(systemHealthService).toContain("environment.VERCEL_ENV");
    expect(systemHealthService).toContain("environment.NODE_ENV || 'unknown'");
  });
});
