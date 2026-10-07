import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./pages/attendance-simple/attendance-simple.css', import.meta.url), 'utf8');
const shellCss = readFileSync(new URL('./styles/operational-layer.css', import.meta.url), 'utf8');

function luminance(hex: string) {
  const channels = hex.slice(1).match(/.{2}/g)!.map((channel) => parseInt(channel, 16) / 255).map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('SMS TIME contrast and short viewport layout', () => {
  it('keeps visible attendance text at WCAG AA against every status tone', () => {
    const pairs: Array<[string, string, string]> = [
      ['page heading on the attendance panel', '#f0f6fc', '#06131f'],
      ['journey heading', '#edf5fc', '#091b29'],
      ['journey helper', '#7f94a8', '#091b29'],
      ['header label', '#6faeff', '#06131f'],
      ['neutral status text', '#e8f0f8', '#0b1d2a'],
      ['success status text', '#b3f5df', '#08281f'],
      ['warning status text', '#ffe3a1', '#2b210d'],
      ['danger status text', '#ffccd2', '#2b1115'],
      ['status context on neutral', '#a8bacb', '#0b1d2a'],
      ['status context on success', '#a8bacb', '#08281f'],
      ['status context on warning', '#a8bacb', '#2b210d'],
      ['status context on danger', '#a8bacb', '#2b1115'],
      ['clock action', '#075ac7', '#f8fbff'],
      ['clock helper', '#60758a', '#f8fbff']
    ];
    for (const [label, foreground, background] of pairs) {
      expect(contrastRatio(foreground, background), label).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps light-theme shell typography overrides outside the dark SMS TIME surface', () => {
    expect(shellCss).toContain(':is(h1,h2,h3,h4,strong):not(.attendance-simple *)');
    expect(shellCss).toContain(':is(p,small,label,dd,.muted-text,.cell-note):not(.attendance-simple *)');
    expect(css).toContain('.attendance-simple__header h1 { margin:4px 0 2px; color:#f0f6fc;');
    expect(css).toContain('.attendance-simple__status.is-danger strong { color:#ffccd2; }');
  });

  it('places the clock before assurance details on short phone viewports', () => {
    expect(css).toContain('@media (max-width: 700px) and (max-height: 700px)');
    expect(css).toContain('.attendance-simple .attendance-simple__clock { width:min(174px,46vw);');
    expect(css).toContain('.attendance-simple__assurance { grid-template-columns:1fr; gap:5px; }');
    expect(css).toContain('.attendance-simple__disabled-guidance { padding:5px 9px; gap:4px; }');
  });
});
