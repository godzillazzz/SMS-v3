import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { securitySiteTokenRole } from './security-site-management-auth';

const panelSource = fs.readFileSync(new URL('./SecuritySiteManagementPanel.tsx', import.meta.url), 'utf8');
const qrStyleSource = fs.readFileSync(new URL('../styles/security-site-management.css', import.meta.url), 'utf8');

describe('Security Site Admin token role gate', () => {
  it('reads ADMIN role from the access token payload', () => {
    expect(securitySiteTokenRole('x.eyJyb2xlIjoiQURNSU4ifQ.y')).toBe('ADMIN');
  });

  it('does not elevate VIEWER or malformed tokens to Admin', () => {
    expect(securitySiteTokenRole('x.eyJyb2xlIjoiVklFV0VSIn0.y')).toBe('VIEWER');
    expect(securitySiteTokenRole('not-a-jwt')).toBe('');
  });

  it('uses the shared authenticated API client instead of component fetch logic', () => {
    expect(panelSource).toContain("import { ApiRequestError, api } from '../api';");
    expect(panelSource).toContain('api.getSecuritySites(token)');
    expect(panelSource).toContain('api.rotateSecuritySiteQr(token, site.id)');
    expect(panelSource).not.toContain('async function adminRequest');
    expect(panelSource).not.toContain('fetch(`/api/v1');
  });

  it('keeps QR token ephemeral and provides local render/print/download actions', () => {
    expect(panelSource).toContain('createSecuritySiteQrDataUrl(result.qrToken)');
    expect(panelSource).toContain('onClick={printQr}');
    expect(panelSource).toContain('onClick={saveQr}');
    expect(panelSource.match(/api\.rotateSecuritySiteQr/g)?.length).toBe(1);
    expect(panelSource).not.toMatch(/localStorage|sessionStorage|indexedDB/i);
    expect(panelSource).not.toContain('rawQrToken}-');
    expect(qrStyleSource).toContain('@page { size: A4 portrait; margin: 0; }');
    expect(qrStyleSource).toContain('.security-site-qr-print-sheet');
  });

  it('waits for the existing print image before printing without rotating again', () => {
    expect(panelSource).toContain('const printImage = qrPrintImageRef.current;');
    expect(panelSource).toContain('await ensureSecuritySiteQrImageReady(printImage);');
    expect(panelSource.match(/await nextSecuritySiteQrAnimationFrame\(\);/g)?.length).toBe(2);
    expect(panelSource).toContain('ref={qrPrintImageRef}');
    expect(panelSource).toContain('if (!generatedQr) return;');
    expect(panelSource.match(/window\.print\(\)/g)?.length).toBe(1);
    expect(panelSource.match(/api\.rotateSecuritySiteQr/g)?.length).toBe(1);
  });

  it('keeps print layout ancestors visible and unclipped for WebKit', () => {
    expect(qrStyleSource).toContain('html, body, #root { height: auto !important; min-height: 0 !important; overflow: visible !important; }');
    expect(qrStyleSource).toContain('position: absolute !important;');
    expect(qrStyleSource).not.toContain('html, body, #root { height: 0');
    expect(qrStyleSource).not.toContain('overflow: hidden !important;');
  });
});
