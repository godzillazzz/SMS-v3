import {test,expect} from '@playwright/test';

// Synthetic local browser fixture only: no real account, hosted deployment, GPS permission or business mutation.
const site={id:'layout-site',code:'AN1',name:'จุดทดสอบ',latitude:13.75,longitude:100.5,geofenceRadiusMeters:250};
const bootstrap={employee:{id:'layout-employee',employeeCode:'E001',displayName:'พนักงานทดสอบ',department:'AN1'},eventIntent:'CHECK_IN',assignment:{id:'layout-assignment',workDate:'2026-10-10',shift:{code:'D',name:'กะกลางวัน',startTime:'08:00',endTime:'20:00'},site},eligibleSites:[site],activeDevice:null,offline:{bundle:'synthetic-offline-bundle-for-layout-tests',issuedAt:'2026-10-10T00:00:00.000Z',expiresAt:'2026-10-11T00:00:00.000Z',confirmAfterMs:300000,maxAccuracyMeters:50}};
const views=[['time-clock','ลงเวลา',true],['attendance','ศูนย์ควบคุมการลงเวลา',false]] as const;

for(const [path,title,simple] of views)for(const theme of ['light','dark'])for(const viewport of [{width:1366,height:768},{width:375,height:812}])test(`T30b attendance ${path} ${theme} ${viewport.width}x${viewport.height}`,async({page},info)=>{
 const errors:string[]=[];const businessWrites:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize(viewport);await page.addInitScript(value=>localStorage.setItem('sms-v3-theme',value),theme);
 await page.route('**/api/v1/**',route=>{
  const request=route.request(),pathname=new URL(request.url()).pathname;
  if(pathname==='/api/v1/auth/refresh')return route.fulfill({status:401,json:{message:'No fixture session'}});
  if(pathname==='/api/v1/auth/login')return route.fulfill({json:{accessToken:'synthetic-layout-token',user:{id:'layout-user',email:'layout@example.test',displayName:'พนักงานทดสอบ',department:'AN1',role:'ADMIN',employeeId:'layout-employee'}}});
  if(request.method()!=='GET'){
   if(!['/api/v1/auth/logout','/api/v1/auth/passkeys/config'].includes(pathname))businessWrites.push(`${request.method()} ${pathname}`);
   return route.fulfill({status:403,json:{message:'Fixture forbids business writes'}});
  }
  if(pathname==='/api/v1/auth/passkeys/config')return route.fulfill({json:{enabled:false}});
  if(pathname==='/api/v1/attendance/simple/bootstrap')return route.fulfill({json:{data:bootstrap}});
  if(pathname==='/api/v1/attendance/supervisor/daily')return route.fulfill({json:{data:{rows:[],summary:{requiresAttention:0,scheduledToday:0,checkedIn:0,currentlyWorking:0,notCheckedInYet:0,late:0,earlyOut:0,wrongShift:0,assistingOtherSite:0,outsideAllSites:0,leave:0,absent:0,timeAbnormal:0}}}});
  if(pathname==='/api/v1/attendance/supervisor/adjustments')return route.fulfill({json:{data:[],meta:{page:1,pageSize:25,total:0,totalPages:1}}});
  if(pathname==='/api/v1/security-sites')return route.fulfill({json:{data:{sites:[]}}});
  if(pathname==='/api/v1/shift-types')return route.fulfill({json:{data:[]}});
  if(pathname==='/api/v1/employees')return route.fulfill({json:{data:[],meta:{page:1,pageSize:20,total:0,totalPages:1}}});
  return route.fulfill({json:{data:[],meta:{page:1,pageSize:25,total:0,totalPages:1}}});
 });

 await page.goto(`/app/${path}`);await expect(page.locator('.nexus-public #auth-login-form')).toBeVisible();
 await page.locator('#email').fill('layout@example.test');await page.locator('#password').fill('synthetic-layout-password');await page.locator('#auth-login-form button[type=submit]').click();
 await expect(page.locator('.app-shell')).toBeVisible();await expect(page.locator('.sms-loader--content')).toHaveCount(0,{timeout:20_000});
 const root=page.locator(simple?'.attendance-simple':'.attendance-supervisor-v4');await expect(root.getByRole('heading',{level:1,name:title,exact:true})).toBeVisible();
 const cards=root.locator('.layout-section-card');await expect(cards.first()).toBeVisible();
 const metrics=await root.evaluate(el=>({
  headingFonts:[...el.querySelectorAll('h1,h2')].map(node=>getComputedStyle(node).fontFamily),
  cardRadii:[...el.querySelectorAll('.layout-section-card')].map(node=>getComputedStyle(node).borderTopLeftRadius),
  rootBackground:getComputedStyle(el).backgroundColor,
  darkLargeSurfaces:[...el.querySelectorAll<HTMLElement>('section,article,div')].filter(node=>{const rect=node.getBoundingClientRect(),s=getComputedStyle(node);if(rect.width<240||rect.height<48||s.backgroundColor==='transparent'||s.backgroundColor==='rgba(0, 0, 0, 0)')return false;const color=s.backgroundColor.match(/\d+/g)?.slice(0,3).map(Number)||[255,255,255];return Math.max(...color)<55}).map(node=>String(node.className))
 }));
 expect(metrics.headingFonts.every(font=>font.includes('Kanit')),JSON.stringify(metrics)).toBe(true);
 expect(metrics.cardRadii.every(radius=>simple ? radius==='16px' : radius==='12px'),JSON.stringify(metrics)).toBe(true);
 expect(metrics.rootBackground).toBe('rgba(0, 0, 0, 0)');
 if(theme==='light')expect(metrics.darkLargeSurfaces,JSON.stringify(metrics)).toEqual([]);
 if(simple)await expect(root.locator('.attendance-simple__clock')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
 expect(businessWrites).toEqual([]);expect(errors).toEqual([]);
 await info.attach('attendance-layout-audit',{body:JSON.stringify(metrics,null,2),contentType:'application/json'});
 await page.screenshot({path:info.outputPath('attendance-layout.png'),fullPage:true});
});
