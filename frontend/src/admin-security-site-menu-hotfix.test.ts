import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('./components/SecuritySiteManagementPanel.tsx', import.meta.url), 'utf8');

describe('Admin Security Site menu hotfix', () => {
  it('restores an explicit Admin navigation route for Security Site and QR lifecycle', () => {
    expect(main).toContain("| 'securitySite' | 'settings'");
    expect(main).toContain("{ id: 'securitySite', icon: 'location', label: 'Security Site & QR' }");
    expect(main).toContain("if (page === 'securitySite') return auth.user?.role === 'ADMIN'");
  });

  it('mounts the existing governed Security Site panel instead of duplicating QR logic in the app shell', () => {
    expect(main).toContain("import { SecuritySiteManagementPanel } from './components/SecuritySiteManagementPanel'");
    expect(main).toContain("if (activePage === 'securitySite' && auth.token)");
    expect(main).toContain("<SecuritySiteManagementPanel token={auth.token} />");
    expect(panel).toContain('api.rotateSecuritySiteQr(token, site.id)');
    expect(panel).toContain('api.revokeSecuritySiteQr(token, selectedSite.id, selectedSite.currentQrCredential.id)');
  });

  it('does not run a generic operational loader for the dedicated Security Site page', () => {
    expect(main).toContain("activePage === 'securitySite') return;");
    expect(main).toContain("| 'securitySite'>, (token: string, page: number) => Promise<DataResponse>>");
  });
});
