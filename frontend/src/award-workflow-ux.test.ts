import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(__dirname,'..','..');
const read=(p:string)=>fs.readFileSync(path.join(root,p),'utf8');
const commandNexus = read('frontend/src/styles/command-nexus.css');
const landing = read('frontend/src/main.tsx');

describe('Command Nexus public footer and approved font contract', () => {
 it('keeps the public footer full-bleed and the two languages legible', () => {
  expect(landing).toContain('<footer className="award-public-footer"><span lang="th">');
  expect(landing).toContain('<small lang="en">Secure operations, designed for clarity.</small>');
  expect(commandNexus).toMatch(/\.award-auth-page > \.award-public-footer\s*\{[^}]*width: 100% !important/);
  expect(commandNexus).toMatch(/\.award-auth-page > \.award-public-footer\s*\{[^}]*flex-wrap: wrap;[^}]*gap: 4px 16px;/);
  expect(commandNexus).toMatch(/@media \(max-width: 560px\)\s*\{\s*\.award-auth-page > \.award-public-footer\s*\{[^}]*flex-direction: column;/);
  expect(commandNexus).toContain('font-size: 13px;');
 });
 it('audits public CSS against the Kanit / Plus Jakarta Sans / approved mono stacks', () => {
  expect(commandNexus).toContain('.nexus-public{');
  expect(commandNexus).toContain('.nexus-auth-stage{');
  expect(commandNexus).toContain('font-family: "Kanit", "Plus Jakarta Sans", sans-serif;');
  expect(commandNexus).toContain('font-family: "Plus Jakarta Sans", "Kanit", sans-serif;');
  expect(commandNexus).toContain('.auth-theme-control button, .auth-password-toggle, .auth-links button');
  expect(commandNexus).not.toMatch(/\bfont(?:-family)?\s*:[^;}]*\b(?:Inter|Noto Sans Thai|Leelawadee UI|Arial|Times New Roman)\b/i);
  expect(landing.indexOf("import './styles/command-nexus.css';")).toBeGreaterThan(landing.indexOf("import './styles/award-landing.css';"));
 });
});

describe('award benchmark workflow UX',()=>{
 it('keeps quick navigation role-scoped and keyboard accessible',()=>{const main=read('frontend/src/main.tsx');const palette=read('frontend/src/components/WorkflowCommandPalette.tsx');expect(main).toContain('workflowCommands = visibleNavigation.flatMap');expect(main).toContain("event.key.toLowerCase() === 'k'");expect(main).toContain('items={workflowCommands}');expect(palette).toContain('สิทธิ์การเข้าถึงยังคงเป็นไปตาม Role ปัจจุบัน');expect(palette).toContain('aria-modal="true"');});
 it('supports desktop and mobile entry points without changing the theme control',()=>{const main=read('frontend/src/main.tsx');expect(main).toContain('className="workflow-command-trigger"');expect(main).toContain('ไปยังงานหรือหน้าอื่น');expect(main).toContain('<ThemeControl compact />');});
});
