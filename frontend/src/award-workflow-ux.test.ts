import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(__dirname,'..','..');
const read=(p:string)=>fs.readFileSync(path.join(root,p),'utf8');
describe('award benchmark workflow UX',()=>{
 it('keeps quick navigation role-scoped and keyboard accessible',()=>{const main=read('frontend/src/main.tsx');const palette=read('frontend/src/components/WorkflowCommandPalette.tsx');expect(main).toContain('workflowCommands = visibleNavigation.flatMap');expect(main).toContain("event.key.toLowerCase() === 'k'");expect(main).toContain('items={workflowCommands}');expect(palette).toContain('สิทธิ์การเข้าถึงยังคงเป็นไปตาม Role ปัจจุบัน');expect(palette).toContain('aria-modal="true"');});
 it('supports desktop and mobile entry points without changing the theme control',()=>{const main=read('frontend/src/main.tsx');expect(main).toContain('className="workflow-command-trigger"');expect(main).toContain('ไปยังงานหรือหน้าอื่น');expect(main).toContain('<ThemeControl compact />');});
});
