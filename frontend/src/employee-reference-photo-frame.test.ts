import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.resolve(__dirname, 'styles/employee-reference-photo.css'), 'utf8');

describe('Employee Reference Photo frame', () => {
  it('uses the portrait 3:4 ratio expected by employee reference photos', () => {
    expect(css).toContain('aspect-ratio: 3 / 4');
    expect(css).not.toContain('aspect-ratio: 4 / 3');
  });

  it('shows the entire employee image without cropping or stretching', () => {
    expect(css).toContain('object-fit: contain');
    expect(css).toContain('object-position: center center');
    expect(css).toContain('.reference-photo-frame img { display: block; width: 100%; height: 100%');
  });

  it('keeps the portrait ratio on mobile', () => {
    expect(css).toContain('.reference-photo-frame { min-height: 0; aspect-ratio: 3 / 4; }');
  });
});