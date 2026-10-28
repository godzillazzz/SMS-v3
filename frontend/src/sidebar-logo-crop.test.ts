import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.join(__dirname, 'styles/hrpro-shell.css'), 'utf8');

// Owner request (2026-10-28): collapsing the sidebar left a sliver of the "SMS" wordmark (a white "S")
// beside the shield. The horizontal logo is 248x96; at 40px tall the shield ends near x=35 and the "S"
// starts near x=39, so a 40px window shows part of the letter. The window must stop before the wordmark.
describe('collapsed sidebar logo shows only the shield', () => {
  it('crops the collapsed logo window narrower than the wordmark start', () => {
    const rule = css.match(/#sms-app\[data-sidebar="collapsed"\] \.sidebar-brand :is\(picture, a, \.brand-logo\) \{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const width = Number(rule![1].match(/width:\s*(\d+)px/)![1]);
    const height = Number(rule![1].match(/height:\s*(\d+)px/)![1]);
    const wordmarkStart = (94 / 96) * height;
    expect(width).toBeLessThan(wordmarkStart - 2);
    expect(rule![1]).toMatch(/overflow:\s*hidden/);
  });
});
