import {test,expect,type Page,type Locator} from '@playwright/test';
const dashboard={totalEmployees:0,activeEmployees:0,onDutyToday:0,leaveToday:0,expiringLicenses:0,monthShifts:0,pendingLeaves:0,pendingUsers:0,pendingLicenseDocuments:0,todayOperations:{onDuty:0,scheduled:0,onLeave:0,offDuty:0},leaveSummary:{total:0},licenseSummary:{},licenseOverview:{},context:{departments:[]},actionRequired:[],recentActivity:[],expiringLicenseDetails:[]};
async function mock(page:Page,role='ADMIN'){
 await page.route('**/api/v1/**',route=>{
 const path=new URL(route.request().url()).pathname;
 if(path==='/api/v1/auth/refresh')return route.fulfill({status:401,json:{message:'No fixture session'}});
 if(path==='/api/v1/auth/login')return route.fulfill({json:{accessToken:'synthetic-brand-token',user:{id:'synthetic-brand-user',email:'brand@example.test',displayName:'ผู้ใช้ทดสอบ',role,employeeId:'synthetic-employee'}}});
 if(path==='/api/v1/auth/passkeys/config')return route.fulfill({json:{enabled:false}});
 if(path==='/api/v1/dashboard/summary')return route.fulfill({json:{data:dashboard}});
 return route.fulfill({json:{data:[],summary:{},meta:{total:0,page:1,pageSize:20,totalPages:0}}});
 });
}
async function checkBrand(container:Locator,tone:'light'|'dark',height:number){
 const img=container.locator('.sms-brand-logo img').filter({visible:true});
 await expect(img).toHaveAttribute('src',`/brand/sms-logo-horizontal${tone==='dark'?'-dark':''}.webp`);
 await expect(img).toHaveAttribute('alt','SMS Security Management System');
 await expect.poll(()=>img.evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth>0)).toBe(true);
 const dimensions=await img.evaluate((el:HTMLImageElement)=>({height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width,nw:el.naturalWidth,nh:el.naturalHeight,aw:Number(el.getAttribute('width')),ah:Number(el.getAttribute('height'))}));
 expect(dimensions.height).toBe(height);expect(dimensions.width/dimensions.height).toBeCloseTo(dimensions.nw/dimensions.nh,1);
 expect(dimensions.aw).toBe(dimensions.nw);expect(dimensions.ah).toBe(dimensions.nh);
 await expect(container.locator('.sms-brand-copy,.nexus-brand__copy')).toHaveCount(0);
 return dimensions.height;
}
for(const theme of ['light','dark'] as const)for(const width of [1366,375])test(`T33 actual login/public and authenticated shell ${theme} ${width}`,async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width,height:812});await page.addInitScript(value=>localStorage.setItem('sms-v3-theme',value),theme);await mock(page);
 await page.goto('/');await expect(page.locator('.nexus-public #auth-login-form')).toBeVisible();
 await checkBrand(page.locator('.nexus-brand'),'dark',width===375?32:40);
 await checkBrand(page.locator(width===375?'.auth-mobile-brand':'.intro-brand.auth-brand'),'dark',width===375?32:40);
 await expect(page.locator('a.nexus-brand')).toHaveAttribute('href','#overview');
 await page.locator('#email').fill('brand@example.test');await page.locator('#password').fill('synthetic-brand-password');await page.locator('#auth-login-form button[type=submit]').click();await expect(page.locator('.app-shell')).toBeVisible();
 if(width===375)await checkBrand(page.locator('.mobile-brand'),theme,32);
 else await checkBrand(page.locator('.sidebar-brand'),theme,40);
 const chosen=page.locator(width===375?'.mobile-brand':'.sidebar-brand');const initial=await chosen.locator('.sms-brand-logo img').filter({visible:true}).evaluate(el=>el.getBoundingClientRect().height);
 await page.evaluate(()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark'});
 expect(await chosen.locator('.sms-brand-logo img').filter({visible:true}).evaluate(el=>el.getBoundingClientRect().height)).toBe(initial);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);expect(errors).toEqual([]);
 await page.screenshot({path:info.outputPath('horizontal-brand-shell.png')});
});
test('T33 actual PWA header uses dark brand with a light desktop preference',async({page})=>{
 await page.setViewportSize({width:375,height:812});await page.addInitScript(()=>localStorage.setItem('sms-v3-theme','light'));await mock(page,'VIEWER');
 await page.goto('/?pwa=1&page=profile');await expect(page.locator('.nexus-public #auth-login-form')).toBeVisible();
 await page.locator('#email').fill('brand@example.test');await page.locator('#password').fill('synthetic-brand-password');await page.locator('#auth-login-form button[type=submit]').click();
 await expect(page.locator('.pwa-mobile-brand')).toBeVisible();await checkBrand(page.locator('.pwa-mobile-brand'),'dark',32);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
