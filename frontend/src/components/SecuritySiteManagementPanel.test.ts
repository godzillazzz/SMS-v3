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
    expect(panelSource).toContain("import { api } from '../api';");
    expect(panelSource).toContain("import { formatRequestErrorMessage } from '../request-error';");
    expect(panelSource).toContain('securitySiteOperations.list(token)');
    expect(panelSource).toContain('securitySiteOperations.rotateQr(token, site.id, qrReason.trim())');
    expect(panelSource).not.toContain('async function adminRequest');
    expect(panelSource).not.toContain('fetch(`/api/v1');
  });

  it('treats blank coordinates as null so an unselected site does not become 0,0', () => {
    expect(panelSource).toContain("if (!value.trim()) return null;");
  });

  it('uses OpenStreetMap with click and draggable marker site selection', () => {
    expect(panelSource).toContain("lazy(() => import('./SecuritySiteMapPicker')");
    expect(panelSource).not.toContain("import { SecuritySiteMapPicker } from './SecuritySiteMapPicker';");
    expect(panelSource).toContain('<Suspense fallback={<SiteMapLoading />}>');
    expect(panelSource).toContain('<SecuritySiteMapPicker');
    expect(panelSource).toContain('latitude: latitude.toFixed(7)');
    expect(panelSource).toContain('longitude: longitude.toFixed(7)');
    expect(mapPickerSource).toContain("from 'leaflet'");
    expect(panelSource).toContain('กำลังโหลด OpenStreetMap…');
    expect(mapPickerSource).toContain("L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png'");
    expect(mapPickerSource).toContain('© OpenStreetMap contributors');
    expect(mapPickerSource).toContain("fillColor:'#ef4444'");
    expect(mapPickerSource).toContain("color:'#ef4444'");
    expect(mapPickerSource).not.toContain("fillColor:'#25b8d3'");
    expect(mapPickerSource).not.toContain("'line-color': '#25b8d3'");
    expect(mapPickerSource).toContain("map.on('click'");
    expect(mapPickerSource).toContain('draggable:true');
    expect(mapPickerSource).toContain("marker.on('dragend'");
    expect(mapPickerSource).toContain('L.circle(center');
    expect(mapPickerSource).toContain('.setRadius(radius)');
  });

  it('keeps QR token ephemeral and provides local render/print/download actions', () => {
    expect(panelSource).toContain('createSecuritySiteQrDataUrl(result.qrToken)');
    expect(panelSource).toContain('printSecuritySiteQrDocument');
    expect(panelSource).toContain('onClick={printQr}');
    expect(panelSource).toContain('onClick={saveQr}');
    expect(panelSource.match(/securitySiteOperations\.rotateQr/g)?.length).toBe(1);
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
