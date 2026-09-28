import {describe,expect,it} from 'vitest';import fs from 'node:fs';import path from 'node:path';
const src=fs.readFileSync(path.join(__dirname,'main.tsx'),'utf8');const css=fs.readFileSync(path.join(__dirname,'styles','operational-layer.css'),'utf8');
describe('production hardening release gate',()=>{
 it('keeps explicit loading, empty and authorization/error experiences',()=>{for(const token of ['loading','empty','permission','error'])expect(src.toLowerCase()).toContain(token)});
 it('locks light and dark enterprise surface closures',()=>{expect(css).toContain('[data-theme="light"]');expect(css).toContain('[data-theme="dark"]');expect(css).toContain('Light Mode roster shift-card closure');expect(css).toContain('Dark Mode closure for Employee / Personnel cards')});
 it('locks mobile and accessibility release contracts',()=>{expect(css).toContain('@media (pointer:coarse)');expect(css).toContain('min-width:44px;min-height:44px');expect(css).toContain('@media (max-width:640px)')});
});
