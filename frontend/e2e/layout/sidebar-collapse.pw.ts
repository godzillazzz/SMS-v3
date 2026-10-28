import {test,expect} from '@playwright/test';

// Synthetic local browser fixture only: no real account, hosted deployment or business mutation.
// Owner issue 2 (2026-10-28): collapsing the sidebar must narrow it even when the
// "แสดงแบบเดสก์ท็อป" display mode was left on, keep the logo whole and the active icon visible.
for(const displayMode of ['auto','desktop'] as const)test(`sidebar collapses to an icon rail (${displayMode} display mode)`,async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await page.addInitScript(mode=>{localStorage.setItem('sms-v3-theme','light');if(mode==='desktop')localStorage.setItem('sms-display-mode','desktop');},displayMode);
 await page.route('**/api/v1/**',route=>{
  const request=route.request(),pathname=new URL(request.url()).pathname;
  if(pathname==='/api/v1/auth/refresh')return route.fulfill({status:401,json:{message:'No fixture session'}});
  if(pathname==='/api/v1/auth/login')return route.fulfill({json:{accessToken:'synthetic-shell-token',user:{id:'shell-admin',email:'admin@example.test',displayName:'ผู้ดูแลทดสอบ',role:'ADMIN'}}});
  if(request.method()!=='GET')return route.fulfill({status:403,json:{message:'Fixture forbids business writes'}});
  if(pathname==='/api/v1/auth/passkeys/config')return route.fulfill({json:{enabled:false}});
  return route.fulfill({json:{data:[],summary:{total:0,byType:{}},meta:{page:1,pageSize:20,total:0,totalPages:0}}});
 });
 await page.goto('/app');await expect(page.locator('.nexus-public #auth-login-form')).toBeVisible();
 await page.locator('#email').fill('admin@example.test');await page.locator('#password').fill('synthetic-shell-password');await page.locator('#auth-login-form button[type=submit]').click();
 const sidebar=page.locator('#sms-app .sidebar');await expect(sidebar).toBeVisible({timeout:20_000});
 await expect.poll(()=>sidebar.evaluate(el=>Math.round(el.getBoundingClientRect().width))).toBe(252);

 await page.getByRole('button',{name:'ย่อเมนู'}).click();
 await expect.poll(()=>sidebar.evaluate(el=>Math.round(el.getBoundingClientRect().width))).toBe(72);
 const logo=await page.locator('#sms-app .sidebar-brand picture').evaluate(el=>{const r=el.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)};});
 expect(logo).toEqual({w:34,h:40});
 const activeIcon=await page.locator('#sms-app .sidebar .nav-item.active .nav-icon').first().evaluate(el=>getComputedStyle(el).color);
 expect(activeIcon).toBe('rgb(255, 255, 255)');
 const mainLeft=await page.locator('#sms-app .main-area').evaluate(el=>Math.round(el.getBoundingClientRect().left));
 expect(mainLeft).toBe(72);
});
