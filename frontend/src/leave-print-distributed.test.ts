import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const body = main.slice(main.indexOf('<div className="leave-print-letter-body"'), main.indexOf('<div className="leave-print-applicant-sig">'));

describe('leave print letter body (owner 2026-10-29: Thai Distributed like Word)', () => {
  it('renders the request as one continuous paragraph', () => {
    expect(body.match(/<p[ >]/g)).toHaveLength(1);
  });
  it('shows filled values as plain text without dotted fill or bold', () => {
    expect(body).not.toContain('print-fill');
    expect(body).not.toContain('<strong>');
  });
  it('justifies with Thai distributed spacing and a first-line indent', () => {
    const rule = css.match(/\.leave-print-letter-body\s*\{[^}]*\}/)?.[0] || '';
    expect(rule).toContain('text-align: justify');
    expect(rule).toContain('text-justify: inter-character');
    expect(rule).toContain('text-align-last: left');
    expect(rule).not.toContain('overflow-wrap: anywhere');
  });
});
