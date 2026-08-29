import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { securitySiteTokenRole } from './security-site-management-auth';

const panelSource = fs.readFileSync(new URL('./SecuritySiteManagementPanel.tsx', import.meta.url), 'utf8');
const mapPickerSource = fs.readFileSync(new URL('./SecuritySiteMapPicker.tsx', import.meta.url), 'utf8');
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

  it('uses OpenStreetMap with click and draggable marker site selection', () => {
    expect(panelSource).toContain("import { SecuritySiteMapPicker } from './SecuritySiteMapPicker';");
    expect(panelSource).toContain('<SecuritySiteMapPicker');
    expect(panelSource).toContain('latitude: latitude.toFixed(7)');
    expect(panelSource).toContain('longitude: longitude.toFixed(7)');
    expect(mapPickerSource).toContain("L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'");
    expect(mapPickerSource).toContain("attribution: '&copy; OpenStreetMap contributors'");
    expect(mapPickerSource).toContain("map.on('click'");
    expect(mapPickerSource).toContain('draggable: true');
    expect(mapPickerSource).toContain("markerRef.current.on('dragend'");
    expect(mapPickerSource).toContain('L.circle(position');
  });

  it('keeps QR token ephemeral and provides local render/print/download actions', () => {
    expect(panelSource).toContain('createSecuritySiteQrDataUrl(result.qrToken)');
    expect(panelSource).toContain('printSecuritySiteQrDocument');
    expect(panelSource).toContain('onClick={printQr}');
    expect(panelSource).toContain('onClick={saveQr}');
    expect(panelSource.match(/api\.rotateSecuritySiteQr/g)?.length).toBe(1);
    expect(panelSource).not.toMatch(/localStorage|sessionStorage|indexedDB/i);
    expect(panelSource).not.toContain('rawQrToken}-');
  });

  it('prints from a standalone document instead of the responsive Admin DOM', () => {
    expect(panelSource).toContain('await printSecuritySiteQrDocument({');
    expect(panelSource).toContain('dataUrl: generatedQr.dataUrl');
    expect(panelSource).toContain('siteCode: generatedQr.siteCode');
    expect(panelSource).toContain('version: generatedQr.credential.version');
    expect(panelSource).not.toContain('qrPrintImageRef');
    expect(panelSource).not.toContain('security-site-qr-print-sheet');
    expect(panelSource).not.toContain('window.print()');
  });

  it('does not install global print rules that hide the application body', () => {
    expect(qrStyleSource).not.toContain('body * { visibility: hidden');
    expect(qrStyleSource).not.toContain('.security-site-qr-print-sheet');
    expect(qrStyleSource).not.toContain('@page { size: A4 portrait; margin: 0; }');
  });
});
