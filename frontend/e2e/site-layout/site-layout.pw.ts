import {test,expect} from '@playwright/test';

// Synthetic local browser fixture only: no real account, hosted deployment or business mutation.
const sites=[
 {id:'site-a',code:'AN1',name:'จุดทดสอบ A',latitude:'13.75',longitude:'100.50',geofenceRadiusMeters:250,isActive:true,departmentLinks:[],currentQrCredential:null,qrCredentials:[]},
 {id:'site-b',code:'AN2',name:'จุดทดสอบ B',latitude:'13.76',longitude:'100.51',geofenceRadiusMeters:200,isActive:true,departmentLinks:[],currentQrCredential:null,qrCredentials:[]}
];
// The panel reads the ADMIN role from the JWT payload, so the fixture token is a structurally valid unsigned JWT.
const adminToken=['e30',Buffer.from(JSON.stringify({sub:'site-admin',role:'ADMIN'})).toString('base64url'),'fixture'].join('.');

for(const theme of ['light','dark'])for(const viewport of [{width:1366,height:768},{width:375,height:812}])test(`site management ${theme} ${viewport.width}x${viewport.height} has no stray dark surfaces`,async({page})=>{
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
 const root=page.locator('.security-site-admin--layout');await expect(root).toBeVisible({timeout:20_000});
 await expect(root.locator('.nexus-gis-status-strip b').first()).toHaveText('2');
 const metrics=await root.evaluate(el=>({
  // Light Mode must not show Command Nexus dark fills, including the gaps between status cards.
  darkSurfaces:[...el.querySelectorAll<HTMLElement>('section,article,div,span,header,aside')].filter(node=>{const rect=node.getBoundingClientRect(),s=getComputedStyle(node);if(rect.width<120||rect.height<32||s.backgroundColor==='transparent'||s.backgroundColor==='rgba(0, 0, 0, 0)')return false;if(node.closest('.leaflet-container'))return false;const color=s.backgroundColor.match(/\d+/g)?.slice(0,3).map(Number)||[255,255,255];return Math.max(...color)<55}).map(node=>String(node.className)),
  stripBackground:getComputedStyle(el.querySelector('.nexus-gis-status-strip')!).backgroundColor
 }));
 if(theme==='light'){expect(metrics.darkSurfaces,JSON.stringify(metrics)).toEqual([]);expect(metrics.stripBackground).toBe('rgba(0, 0, 0, 0)');}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
 expect(errors).toEqual([]);
});
