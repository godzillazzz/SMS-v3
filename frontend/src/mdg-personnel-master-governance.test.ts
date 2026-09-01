import { describe,expect,it } from 'vitest';
import fs from 'node:fs';import path from 'node:path';
const read=(p:string)=>fs.readFileSync(path.join(__dirname,p),'utf8');const panel=read('components/PersonnelMasterPanel.tsx');const api=read('api.ts');const css=read('styles/configuration-center.css');
describe('MDG-01 personnel master governance',()=>{
 it('preflights before deactivation and requires reason plus explicit impact acknowledgement',()=>{expect(panel).toContain('api.personnelMasterImpact');expect(panel).toContain('Impact Preview ก่อนปิดใช้งาน');expect(panel).toContain('confirmImpact: true');expect(panel).toContain('เหตุผลในการปิดใช้งาน');});
 it('keeps reactivation simple and no delete capability',()=>{expect(panel).toContain('{ isActive: true }');expect(panel).not.toContain('deletePersonnelMaster');});
 it('adds searchable master lists and responsive impact presentation',()=>{expect(panel).toContain('personnel-master-search');expect(css).toContain('.personnel-master-impact');expect(css).toContain('@media(max-width:760px)');});
 it('central API exposes impact read separately from update mutation',()=>{expect(api).toContain('personnelMasterImpact:');expect(api).toContain('/impact');});
});
