import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const panel=fs.readFileSync(path.join(__dirname,'components/SecuritySiteManagementPanel.tsx'),'utf8');
const api=fs.readFileSync(path.join(__dirname,'api.ts'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'styles/security-site-management.css'),'utf8');
describe('CFG-UX-01 Security Site governance UX',()=>{
 it('adds search and Active/Inactive filtering',()=>{expect(panel).toContain('siteQuery');expect(panel).toContain('siteStatusFilter');expect(panel).toContain('visibleSites');expect(panel).toContain('ค้นหา Site');});
 it('requires a deactivation reason and sends it to server audit boundary',()=>{expect(panel).toContain('deactivationReason');expect(panel).toContain("reason: deactivationReason.trim()");expect(panel).toContain('เหตุผลก่อนปิดใช้งาน');expect(api).toContain('reason?: string');});
 it('keeps server guard wording visible and responsive',()=>{expect(panel).toContain('Default Site และ open Attendance session');expect(css).toContain('.security-site-governance-toolbar');expect(css).toContain('@media(max-width:700px)');});
});
