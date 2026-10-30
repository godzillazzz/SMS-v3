import {test,expect} from '@playwright/test';

// Synthetic local browser fixture only: no real account, hosted deployment or business mutation.
const sites=[
 {id:'site-a',code:'HQ',name:'สำนักงานใหญ่',latitude:'13.7248640',longitude:'100.5340240',geofenceRadiusMeters:200,isActive:true,departmentLinks:[{securitySiteId:'site-a',departmentMasterId:'d1',departmentCode:'AN1',departmentName:'AN1',isDefault:true}],currentQrCredential:{id:'qr-1',securitySiteId:'site-a',version:3,validFrom:'2026-10-01T00:00:00.000Z',validUntil:null,revokedAt:null,createdAt:'2026-10-01T00:00:00.000Z'},qrCredentials:[]},
 {id:'site-b',code:'BR-LP',name:'สาขา 1',latitude:null,longitude:null,geofenceRadiusMeters:150,isActive:false,departmentLinks:[],currentQrCredential:null,qrCredentials:[]}
];
// The panel reads the ADMIN role from the JWT payload, so the fixture token is a structurally valid unsigned JWT.
const adminToken=['e30',Buffer.from(JSON.stringify({sub:'site-admin',role:'ADMIN'})).toString('base64url'),'fixture'].join('.');

for(const theme of ['light','dark'])for(const viewport of [{width:1366,height:768},{width:375,height:812}])test(`site list ${theme} ${viewport.width}x${viewport.height}`,async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize(viewport);await page.addInitScript(value=>localStorage.setItem('sms-v3-theme',value),theme);
 await page.route('**/api/v1/**',route=>{
  const request=route.request(),pathname=new URL(request.url()).pathname;
  if(pathname==='/api/v1/auth/refresh')return route.fulfill({status:401,json:{message:'No fixture session'}});
  if(pathname==='/api/v1/auth/login')return route.fulfill({json:{accessToken:adminToken,user:{id:'site-admin',email:'site@example.test',displayName:'ผู้ดูแลทดสอบ',role:'ADMIN'}}});
  if(request.method()!=='GET')return route.fulfill({status:403,json:{message:'Fixture forbids business writes'}});
  if(pathname==='/api/v1/auth/passkeys/config')return route.fulfill({json:{enabled:false}});
  if(pathname==='/api/v1/admin/security-sites')return route.fulfill({json:{data:{sites,overlapWarnings:[]}}});
  if(pathname==='/api/v1/admin/security-sites/departments')return route.fulfill({json:{data:[]}});
  return route.fulfill({json:{data:[],meta:{page:1,pageSize:25,total:0,totalPages:1}}});
 });

 await page.goto('/app/sites');await expect(page.locator('.nexus-public #auth-login-form')).toBeVisible();
 await page.locator('#email').fill('site@example.test');await page.locator('#password').fill('synthetic-site-password');await page.locator('#auth-login-form button[type=submit]').click();
 const list=page.locator('.security-site-list');await expect(list).toBeVisible({timeout:20_000});
 await expect(list.locator('tbody tr')).toHaveCount(2);
 await expect(list.locator('.security-site-list__count')).toHaveText('2 รายการ');
 await expect(list.getByRole('link',{name:'13.724864, 100.534024'})).toHaveAttribute('rel','noopener noreferrer');
 await expect(list.locator('.security-site-list__status.is-inactive')).toHaveText('ปิดใช้งาน');
 await expect(page.locator('.gis-tactical-workspace')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('list.png'),fullPage:true});

 await list.getByRole('button',{name:'แก้ไข HQ'}).click();
 await expect(page.locator('.gis-tactical-workspace')).toBeVisible();
 const toggle=page.locator('.gis-intelligence-sheet__toggle');
 if(await toggle.isVisible() && await toggle.getAttribute('aria-expanded')==='false') await toggle.click();
 const tile=page.locator('.gis-spatial-grid > div').first();
 await expect(tile).toBeVisible();
 const colors=await tile.evaluate(el=>({background:getComputedStyle(el).backgroundColor, text:getComputedStyle(el.querySelector('strong')!).color, label:getComputedStyle(el.querySelector('span')!).color, font:parseFloat(getComputedStyle(el.querySelector('span')!).fontSize)}));
 const luminance=(rgb:string)=>{const values=rgb.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return 0.2126*values[0]+0.7152*values[1]+0.0722*values[2];};
 const contrast=(a:string,b:string)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
 expect(contrast(colors.text,colors.background),JSON.stringify(colors)).toBeGreaterThanOrEqual(4.5);
 expect(contrast(colors.label,colors.background),JSON.stringify(colors)).toBeGreaterThanOrEqual(4.5);
 expect(colors.font,JSON.stringify(colors)).toBeGreaterThanOrEqual(12);
 await expect(page.locator('.security-site-list')).toHaveCount(0);
 await page.getByRole('button',{name:'‹ กลับไปรายการ'}).click();
 await expect(page.locator('.security-site-list')).toBeVisible();

 await page.getByRole('button',{name:'เพิ่มบริเวณ'}).click();
 await expect(page.locator('.gis-tactical-workspace')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
 expect(errors).toEqual([]);
});
