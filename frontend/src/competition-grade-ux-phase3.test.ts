import { describe,expect,it } from 'vitest';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(__dirname,'..','..');const read=(p:string)=>fs.readFileSync(path.join(root,p),'utf8');
describe('competition grade UX phase 3',()=>{
 it('keeps dashboard styles owned by the application entry instead of duplicate page imports',()=>{const main=read('frontend/src/main.tsx');const dashboard=read('frontend/src/pages/dashboard/DashboardPage.tsx');expect(main).toContain("import './styles/dashboard.css'");expect(main).toContain("import './styles/operational-layer.css'");expect(dashboard).not.toContain("import '../../styles/dashboard.css'");expect(dashboard).not.toContain("import '../../styles/operational-layer.css'");});
 it('provides global keyboard focus and reduced motion safety',()=>{const css=read('frontend/src/styles/operational-layer.css');expect(css).toContain(':focus-visible');expect(css).toContain('@media(prefers-reduced-motion:reduce)');expect(css).toContain('animation-duration:.01ms!important');});
 it('keeps task workflow role-aware and existing theme control unchanged',()=>{const main=read('frontend/src/main.tsx');const flow=read('frontend/src/components/dashboard/WorkQueueJourney.tsx');expect(main).toContain('workflowCommands = visibleNavigation.flatMap');expect(flow).toContain('canManage');expect(main).toContain('<ThemeControl compact />');});
});
