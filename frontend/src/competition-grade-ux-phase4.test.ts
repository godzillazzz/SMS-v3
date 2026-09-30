import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('competition-grade UX phase 4', () => {
  it('keeps the GIS engine styles aligned with Leaflet and removes stale MapLibre selectors', () => {
    const operational = read('./styles/operational-layer.css');
    const gis = read('./styles/security-site-management.css');
    expect(`${operational}\n${gis}`).not.toMatch(/maplibre|maplibregl/);
    expect(operational).toContain('.leaflet-control-zoom');
    expect(gis).toContain('/* Leaflet + OpenStreetMap rendering */');
    expect(gis).toContain('.leaflet-container');
  });

  it('keeps the map picker accessible and readable in Thai', () => {
    const picker = read('./components/SecuritySiteMapPicker.tsx');
    expect(picker).toContain('แผนที่ OpenStreetMap สำหรับเลือกตำแหน่ง Security Site');
    expect(picker).toContain('คลิกบนแผนที่หรือลากหมุดเพื่อเลือกตำแหน่ง Security Site');
    expect(picker).toContain('วงกลมแสดงขอบเขต Geofence ตามรัศมีที่กำหนด');
    expect(picker).toContain('© OpenStreetMap contributors');
  });
});