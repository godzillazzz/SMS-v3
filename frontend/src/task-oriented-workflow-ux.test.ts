import { describe, expect, it } from 'vitest';
import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(__dirname,'..','..');const read=(p:string)=>fs.readFileSync(path.join(root,p),'utf8');
describe('task oriented workflow UX phase 2',()=>{
 it('surfaces a recommended work journey from the dashboard',()=>{const page=read('frontend/src/pages/dashboard/DashboardPage.tsx');const flow=read('frontend/src/components/dashboard/WorkQueueJourney.tsx');expect(page).toContain('<WorkQueueJourney');expect(flow).toContain("page:'schedule'");expect(flow).toContain("page:'employees'");expect(flow).toContain("page:'approvalCenter'");expect(flow).toContain('pendingApprovalCount');});
 it('keeps workflow navigation delegated to existing authorized navigation',()=>{const flow=read('frontend/src/components/dashboard/WorkQueueJourney.tsx');expect(flow).toContain('onNavigate(step.page)');expect(flow).not.toContain('fetch(');expect(flow).not.toContain('/api/');});
});
