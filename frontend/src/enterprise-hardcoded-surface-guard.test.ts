import { describe, expect, it } from 'vitest';
import fs from 'node:fs'; import path from 'node:path';
const root=path.join(__dirname,'styles');
const foundation=fs.readFileSync(path.join(root,'theme-foundation.css'),'utf8');
const operational=fs.readFileSync(path.join(root,'operational-layer.css'),'utf8');
const auditMobile=fs.readFileSync(path.join(root,'audit-mobile.css'),'utf8');
describe('enterprise interaction contract',()=>{
 it('supports reduced motion',()=>expect(foundation).toContain('prefers-reduced-motion:reduce'));
 it('uses semantic surfaces in convergence layer',()=>{expect(foundation).toContain('var(--surface-card');expect(foundation).toContain('var(--surface-raised');});
 it('keeps enterprise motion tokens',()=>expect(foundation).toContain('--motion-standard:200ms'));
 it('closes authenticated Light Mode dark-surface leakage without changing Dark Mode selectors',()=>{
  expect(operational).toContain('[data-theme="light"] .app-shell:not(.pwa-shell) :is(.nexus-roster-workspace,.nexus-attendance-ops,.attendance-supervisor-v4,.nexus-device-registry,.attendance-device-page)');
  expect(operational).toContain('background:var(--surface-card,#fff)!important');
  expect(operational).toContain('.attendance-supervisor-v4__table-wrap');
  expect(operational).toContain('.attendance-device-table-wrap');
  expect(auditMobile).toContain('[data-theme="light"] .app-shell:not(.pwa-shell) .audit-nexus-v48 .audit-mobile-card');
 });
 it('keeps forced Desktop Mode horizontally pannable with a fixed sidebar',()=>{
  expect(operational).toContain('html:has(.app-shell.desktop-view){width:100%!important;min-width:0!important;max-width:none!important;overflow-x:scroll!important');
  expect(operational).not.toMatch(/\.app-shell\.desktop-view:not\(\.pwa-shell\) \.sidebar\{[^}]*position:sticky!important/);
  expect(operational).toMatch(/\.app-shell\.desktop-view:not\(\.pwa-shell\) \.sidebar\{[^}]*position:fixed!important/);
 });
 it('keeps the global shell on semantic theme surfaces and enterprise SVG controls',()=>{
  const app=fs.readFileSync(path.join(__dirname,'main.tsx'),'utf8');
  const settingsPage=fs.readFileSync(path.join(__dirname,'pages/settings/SettingsPage.tsx'),'utf8');
  expect(app).toContain("backgroundColor: 'var(--surface-page, #020813)'");
  expect(app).toContain("color: 'var(--text-on-surface, #f1f5f9)'");
  expect(app).toContain("<SmsIcon name={desktopView ? 'device' : 'system'} size={16} />");
  expect(app).toContain('<SmsIcon name="eye" size={16} />');
  expect(app).not.toContain("desktopView ? '📱' : '🖥️'");
  expect(settingsPage).toContain('line-settings-title"><span aria-hidden="true"><SmsIcon name="bell"');
  expect(settingsPage).toContain('<SmsIcon name="report" size={15} /> ส่งออกค่าที่กำหนด');
 });
 it('closes residual Audit and GIS Light Mode surfaces while preserving semantic warning hierarchy',()=>{
  expect(operational).toContain('Enterprise Evolution Phase A.3');
  expect(operational).toContain('.audit-metric-skeleton,.audit-skeleton-row span');
  expect(operational).toContain('.gis-command-header,.security-site-admin__header,.nexus-gis-status-strip');
  expect(operational).toContain('.security-site-overlap-warning,.security-site-qr-once,.security-site-confirm-dialog__impact');
  expect(operational).toContain('background:#fff7ed!important');
 });
 it('prevents new authenticated hard-coded dark surfaces without a Light Mode contract',()=>{
  const files=fs.readdirSync(root).filter((name)=>name.endsWith('.css'));
  const hardDark=/#(?:020813|020f1c|030d17|061421|0f1d2a|111827|0e1525)\b/i;
  const darkTargets=new Set<string>();
  const lightTargets=new Set<string>();
  const targetClasses=(selector:string)=>selector.split(',').flatMap((part)=>{
   const tail=part.trim().split(/\s+|>/).filter(Boolean).pop()||'';
   return [...tail.matchAll(/\.([A-Za-z][\w-]*)/g)].map((match)=>match[1]);
  });
  for(const name of files){
   const css=fs.readFileSync(path.join(root,name),'utf8');
   for(const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
    const selector=match[1]; const body=match[2];
    if(/\[data-theme=["']light["']\]/i.test(selector)) for(const cls of targetClasses(selector)) lightTargets.add(cls);
    if(!/\[data-theme=["']light["']\]/i.test(selector)&&/(?:background|background-color)\s*:/i.test(body)&&hardDark.test(body)) for(const cls of targetClasses(selector)) darkTargets.add(cls);
   }
  }
  const intentional=(cls:string)=>/^(?:award-|nexus-auth|nexus-public|nexus-command-button|nexus-mobile-|employee-v4-|pwa-|data-mobile-card$)/.test(cls)||['dialog-backdrop','audit-preview-backdrop','security-site-confirm-backdrop'].includes(cls);
  const leaks=[...darkTargets].filter((cls)=>!intentional(cls)&&!lightTargets.has(cls)).sort();
  expect(leaks).toEqual([]);
 });
});
