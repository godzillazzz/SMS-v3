import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(__dirname,'..','..');
const read=(p:string)=>fs.readFileSync(path.join(root,p),'utf8');
describe('production operations closure',()=>{
 it('keeps measurable production bundle budgets including CSS',()=>{const s=read('scripts/ci/verify-frontend-production-bundle.js');expect(s).toContain('main:400000');expect(s).toContain('map:300000');expect(s).toContain('css:700000');expect(s).toContain('css-budget-exceeded');});
 it('documents actionable health thresholds and safe rollback triage',()=>{const d=read('docs/PRODUCTION_SYSTEM_HEALTH_RUNBOOK.md');expect(d).toContain('HTTP 5xx rate');expect(d).toContain('API p95');expect(d).toContain('Database latency');expect(d).toContain('roll back');expect(d).toContain('must never be replaced with invented accounts');});
});
