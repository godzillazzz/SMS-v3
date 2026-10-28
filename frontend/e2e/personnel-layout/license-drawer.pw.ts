import {test,expect} from '@playwright/test';

// Synthetic local browser fixture only: no real account, hosted deployment or business mutation.
// Owner issue 7 (2026-10-28): drawer icon centred; the employee field shows name and department without the avatar.
const license={id:'lic-1',licenseNumber:'สบ 76811610',licenseType:'ใบอนุญาต รปภ.',status:'ACTIVE',issuedAt:'2023-08-25',expiresAt:'2028-08-25',employeeId:'emp-1',employee:{id:'emp-1',employeeCode:'EMP001',firstName:'ทัศยุ',lastName:'สุริโย',department:'PO11'},documents:[]};

test('license drawer keeps a centred icon and a clean employee field',async({page})=>{
 await page.setViewportSize({width:1366,height:768});
 await page.route('**/api/v1/**',route=>{
  const request=route.request(),pathname=new URL(request.url()).pathname;
  if(pathname==='/api/v1/auth/refresh')return route.fulfill({status:401,json:{message:'No fixture session'}});
  if(pathname==='/api/v1/auth/login')return route.fulfill({json:{accessToken:'synthetic-license-token',user:{id:'lic-admin',email:'admin@example.test',displayName:'ผู้ดูแลทดสอบ',role:'ADMIN'}}});
  if(request.method()!=='GET')return route.fulfill({status:403,json:{message:'Fixture forbids business writes'}});
  if(pathname==='/api/v1/auth/passkeys/config')return route.fulfill({json:{enabled:false}});
  if(pathname==='/api/v1/licenses')return route.fulfill({json:{data:[license],meta:{page:1,pageSize:20,total:1,totalPages:1}}});
  return route.fulfill({json:{data:[],summary:{total:0,byType:{}},meta:{page:1,pageSize:20,total:0,totalPages:0}}});
 });
 await page.goto('/app/licenses');await expect(page.locator('.nexus-public #auth-login-form')).toBeVisible();
 await page.locator('#email').fill('admin@example.test');await page.locator('#password').fill('synthetic-license-password');await page.locator('#auth-login-form button[type=submit]').click();
 await expect(page.locator('.sms-loader--content')).toHaveCount(0,{timeout:20_000});
 await page.locator('[data-operational-row="lic-1"]').first().click();
 const drawer=page.locator('.signature-record-drawer');await expect(drawer).toBeVisible();
 const geometry=await drawer.locator('.signature-record-drawer__icon').evaluate(box=>{const b=box.getBoundingClientRect(),i=box.querySelector('svg')!.getBoundingClientRect();return {dx:Math.abs((b.left+b.right)/2-(i.left+i.right)/2),dy:Math.abs((b.top+b.bottom)/2-(i.top+i.bottom)/2)};});
 expect(geometry.dx).toBeLessThanOrEqual(1.5);expect(geometry.dy).toBeLessThanOrEqual(1.5);
 const field=drawer.locator('.signature-record-drawer__fields dd').first();
 await expect(field.locator('.personnel-avatar')).toBeHidden();
 await expect(field.locator('strong')).toHaveText('ทัศยุ สุริโย');
 const lines=await field.locator('.license-person > span:not(.personnel-avatar)').evaluate(el=>{const s=el.querySelector('strong')!.getBoundingClientRect(),m=el.querySelector('small')?.getBoundingClientRect();return m?m.top>=s.bottom-1:true;});
 expect(lines).toBe(true);
});
