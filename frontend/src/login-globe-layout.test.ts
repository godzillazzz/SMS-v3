import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.join(__dirname, 'styles/public-one-screen.css'), 'utf8');

describe('public login and Thailand map layout', () => {
  it('contains the decorative map within its grid cell and keeps it out of login hit testing', () => {
    const mapColumn = css.slice(css.indexOf('/* map column */'), css.indexOf('/* login card column */'));
    expect(mapColumn).toMatch(/\.nexus-onescreen__map\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*clip[^}]*pointer-events:\s*none/s);
    // Owner 2026-10-28: the outer orbit (wider than the SVG) must fit the column, so the width is divided by the orbit span.
    expect(mapColumn).toMatch(/--th-map-orbit-span:\s*1\.62/);
    expect(mapColumn).toMatch(/\.th-map\s*\{[^}]*width:\s*min\(100cqw \/ var\(--th-map-orbit-span\),/s);
    expect(mapColumn).toMatch(/\.th-map\s*\{[^}]*max-width:\s*100%/s);
  });

  it('keeps the map compact above the mobile login card', () => {
    expect(css).toContain('.nexus-onescreen__map { height: 140px; }');
  });
});
