import {test,expect} from '@playwright/test';
const employee={id:'layout-employee',employeeCode:'E001',firstName:'ข้อมูล',lastName:'ทดสอบ',department:'AN1',jobTitle:'พนักงาน',isActive:true};
const pages=[['employees','ข้อมูลพนักงาน'],['licenses','ใบอนุญาตพนักงาน'],['devices','อุปกรณ์ลงเวลา'],['users','ผู้ใช้และสิทธิ์']] as const;
for(const [path,title] of pages)for(const theme of ['light','dark'])for(const width of [1366,375])test(`T30b personnel ${path} ${theme} ${width}`,async({page},info)=>{
 const errors:string[]=[];const writes:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width,height:812});await page.addInitScript(t=>localStorage.setItem('sms-v3-theme',t),theme);
 await page.route('**/api/v1/**',route=>{
  const req=route.request(),p=new URL(req.url()).pathname;
  if(p==='/api/v1/auth/refresh')return route.fulfill({status:401,json:{message:'No fixture session'}});
  if(p==='/api/v1/auth/login')return route.fulfill({json:{accessToken:'synthetic-layout-token',user:{id:'layout-user',email:'layout@example.test',displayName:'ข้อมูลทดสอบ',role:'ADMIN',employeeId:employee.id}}});
  if(req.method()!=='GET'){writes.push(`${req.method()} ${p}`);return route.fulfill({status:403,json:{message:'Fixture forbids business writes'}})}
  if(p==='/api/v1/auth/passkeys/config')return route.fulfill({json:{enabled:false}});
  if(p==='/api/v1/employees/readiness/center')return route.fulfill({json:{data:[{employee,status:'NOT_READY',blockers:[{code:'DEVICE_REQUIRED',label:'อุปกรณ์ยังไม่พร้อม'}],checks:{}}],summary:{total:1,ready:0,notReady:1,blockerCounts:{DEVICE_REQUIRED:1}},limitedTo:50}});
  if(p==='/api/v1/employees')return route.fulfill({json:{data:[employee],meta:{page:1,pageSize:10,total:1,totalPages:1,departments:['AN1'],summary:{total:1,active:1,incomplete:0}}}});
  if(p==='/api/v1/attendance/devices/me')return route.fulfill({json:{data:{employeeId:employee.id,activeDevice:null,activeRequest:null}}});
  return route.fulfill({json:{data:[],summary:{total:0,byType:{}},meta:{page:1,pageSize:20,total:0,totalPages:0}}});
 });
 await page.goto(`/app/${path}`);await expect(page.locator('.nexus-public #auth-login-form')).toBeVisible();
 await page.locator('#email').fill('layout@example.test');await page.locator('#password').fill('synthetic-layout-password');await page.locator('#auth-login-form button[type=submit]').click();
 await expect(page.locator('.app-shell')).toBeVisible();
 await expect(page.locator('.sms-loader--content')).toHaveCount(0,{timeout:20_000});
 await expect(page.getByRole('heading',{level:1,name:title,exact:true})).toBeVisible();
 const root=page.locator('.layout-personnel-page');await expect(root).toHaveCount(1);
 await expect(root.locator('.layout-section-card').first()).toBeVisible();
 await expect.poll(()=>root.locator('h1,h2').evaluateAll(els=>els.every(el=>getComputedStyle(el).fontFamily.includes('Kanit')))).toBe(true);
 expect(await root.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
 const audit=await root.evaluate(el=>[...el.querySelectorAll<HTMLElement>('section,article,div,header')].flatMap(node=>{
  const rect=node.getBoundingClientRect(),s=getComputedStyle(node);if(rect.width<240||rect.height<24)return[];
  const background=s.backgroundColor!=='rgba(0, 0, 0, 0)'&&s.backgroundColor!=='transparent';const border=parseFloat(s.borderTopWidth)>0;
  if(!background&&!border)return[];
  const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let text:Node|null;let inset:{left:number;top:number}|null=null;
  while((text=walker.nextNode())){if(!text.textContent?.trim()||text.parentElement?.closest('button,select,svg'))continue;const range=document.createRange();range.selectNodeContents(text);const bounds=range.getBoundingClientRect();if(bounds.width>0&&bounds.height>0){inset={left:bounds.left-rect.left,top:bounds.top-rect.top};break}}
  return [{class:node.className,radius:parseFloat(s.borderTopLeftRadius),paddingLeft:parseFloat(s.paddingLeft),paddingTop:parseFloat(s.paddingTop),inset}];
 }));
 await info.attach('large-box-layout-audit',{body:JSON.stringify(audit,null,2),contentType:'application/json'});
 expect(audit.filter(box=>![16,10].includes(box.radius)),JSON.stringify(audit)).toEqual([]);
 expect(audit.filter(box=>box.inset && (box.inset.left<16||box.inset.top<12)),JSON.stringify(audit)).toEqual([]);
 for(const card of await root.locator('.layout-section-card,.layout-metric-card,.layout-step-flow').all()){
  const spacing=await card.evaluate(el=>{const r=el.getBoundingClientRect(),title=el.querySelector('h2')!.getBoundingClientRect();return{left:title.left-r.left,top:title.top-r.top,radius:getComputedStyle(el).borderTopLeftRadius}});
  expect(spacing.radius).toBe('16px');expect(spacing.left).toBeGreaterThanOrEqual(16);expect(spacing.top).toBeGreaterThanOrEqual(12);
 }
 if(path==='devices')await expect(root.getByRole('heading',{name:'สถานะอุปกรณ์ของฉัน'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);expect(writes).toEqual([]);expect(errors).toEqual([]);
 await page.screenshot({path:info.outputPath('personnel-layout.png'),fullPage:true});
});
