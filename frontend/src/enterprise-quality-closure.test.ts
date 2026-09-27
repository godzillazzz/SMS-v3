import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const styles=path.join(__dirname,'styles');
const operational=fs.readFileSync(path.join(styles,'operational-layer.css'),'utf8');
const foundation=fs.readFileSync(path.join(styles,'theme-foundation.css'),'utf8');
const mapPicker=fs.readFileSync(path.join(__dirname,'components','SecuritySiteMapPicker.tsx'),'utf8');
const panel=fs.readFileSync(path.join(__dirname,'components','SecuritySiteManagementPanel.tsx'),'utf8');
describe('enterprise quality closure',()=>{
 it('keeps GIS implementation route-lazy and map-engine lazy',()=>{expect(panel).toContain("lazy(() => import('./SecuritySiteMapPicker')");expect(mapPicker).toContain("from 'maplibre-gl'");});
 it('keeps global keyboard focus and reduced-motion contracts',()=>{expect(foundation).toContain(':focus-visible');expect(foundation).toContain('prefers-reduced-motion:reduce');});
 it('guarantees coarse pointer touch targets in authenticated shell',()=>{expect(operational).toContain('@media (pointer:coarse)');expect(operational).toContain('min-width:44px;min-height:44px');});
 it('contains mobile enterprise cards and horizontal tables',()=>{expect(operational).toContain('@media (max-width:640px)');expect(operational).toContain('overscroll-behavior-inline:contain');expect(operational).toContain('-webkit-overflow-scrolling:touch');});
 it('locks both recent theme regressions',()=>{expect(operational).toContain('Enterprise Evolution Light Mode roster shift-card closure');expect(operational).toContain('Dark Mode closure for Employee / Personnel cards');expect(operational).toContain('[data-theme="dark"] .app-shell:not(.pwa-shell) .personnel-directory-page');});
});
