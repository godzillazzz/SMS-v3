import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const root=path.join(__dirname,'styles');
const tokens=fs.readFileSync(path.join(root,'tokens.css'),'utf8');
const foundation=fs.readFileSync(path.join(root,'theme-foundation.css'),'utf8');
describe('enterprise semantic surface contract',()=>{
 it('defines semantic surface roles for both themes',()=>{ expect((tokens.match(/--surface-page:/g)||[]).length).toBeGreaterThanOrEqual(2); expect(tokens).toContain('--surface-card:'); expect(tokens).toContain('--surface-control:'); expect(tokens).toContain('--surface-selected:'); });
 it('shared cards consume semantic surfaces',()=>{ expect(foundation).toContain('var(--surface-card, var(--color-surface))'); });
});