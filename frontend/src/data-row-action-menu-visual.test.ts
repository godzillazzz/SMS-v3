import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = fs.readFileSync(path.join(__dirname, 'styles/data-surfaces.css'), 'utf8');
const popoverRules = Array.from(styles.matchAll(/\.data-row-menu-popover\s*\{([^}]*)\}/g));
const popoverRule = popoverRules[popoverRules.length - 1]?.[1] ?? '';
const actionRule = styles.match(/\.data-row-menu-popover button\s*\{([^}]*)\}/)?.[1] ?? '';

describe('row-action popover visual containment', () => {
  it('keeps long action lists scrollable within the viewport', () => {
    expect(popoverRule).toMatch(/max-height:\s*calc\(100dvh\s*-\s*16px\)/);
    expect(popoverRule).toMatch(/overflow-y:\s*auto/);
    expect(popoverRule).not.toMatch(/overflow:\s*hidden/);
  });

  it('wraps long action labels instead of clipping them horizontally', () => {
    expect(actionRule).toMatch(/white-space:\s*normal/);
    expect(actionRule).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
