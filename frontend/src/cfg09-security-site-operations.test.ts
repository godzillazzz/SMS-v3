import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const panel = fs.readFileSync(path.join(root, 'components', 'SecuritySiteManagementPanel.tsx'), 'utf8');
const client = fs.readFileSync(path.join(root, 'components', 'security-site-operations-client.ts'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api.ts'), 'utf8');

describe('CFG-09 Security Site Operations', () => {
  it('adds duplicate, QR history and mandatory reason UX', () => {
    expect(panel).toContain('Duplicate Site');
    expect(panel).toContain('สร้างสำเนา Site แบบ INACTIVE');
    expect(panel).toContain('QR history');
    expect(panel).toContain('เหตุผล Rotate / Revoke QR');
    expect(panel).toContain('securitySiteOperations.rotateQr');
    expect(panel).toContain('securitySiteOperations.revokeQr');
  });

  it('uses a separate authenticated client so the locked central api source remains unchanged', () => {
    expect(client).toContain('attendanceAuthenticatedRequest');
    expect(client).toContain("/duplicate");
    expect(client).toContain("JSON.stringify({ reason })");
    expect(api).not.toContain('duplicateSecuritySite');
  });

  it('preserves QR as one factor and never adds hard-delete Site UX', () => {
    expect(panel).toContain('Server เก็บ SHA-256 hash เท่านั้น');
    expect(panel).not.toContain('Delete Site');
    expect(panel).not.toContain('ลบ Site ถาวร');
  });
});
