import {test,expect} from '@playwright/test';
const employee={id:'layout-employee',employeeCode:'E001',firstName:'ข้อมูล',lastName:'ทดสอบ',department:'AN1',jobTitle:'พนักงาน',isActive:true};
const pages=[['roster','ตารางกะรายเดือน'],['shift-codes','รหัสกะและเวลา'],['rules','ตรวจสอบกฎการทำงาน'],['leave','คำขอลา'],['leave/approvals','อนุมัติคำขอลา'],['leave/history','ประวัติการลา'],['leave/quotas','โควตาวันลา']] as const;
for(const [path,title] of pages)for(const theme of ['light','dark'])for(const width of [1366,375])test(`T30b roster/leave ${path} ${theme} ${width}`,async({page},info)=>{
 const errors:string[]=[];const writes:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width,height:width===1366?768:812});await page.addInitScript(t=>localStorage.setItem('sms-v3-theme',t),theme);
 await page.route('**/api/v1/**',route=>{
  const req=route.request(),p=new URL(req.url()).pathname;
  if(p==='/api/v1/auth/refresh')return route.fulfill({status:401,json:{message:'No fixture session'}});
  if(p==='/api/v1/auth/login')return route.fulfill({json:{accessToken:'synthetic-layout-token',user:{id:'layout-user',email:'layout@example.test',displayName:'ข้อมูลทดสอบ',role:'ADMIN',employeeId:employee.id}}});
  if(req.method()!=='GET'){writes.push(`${req.method()} ${p}`);return route.fulfill({status:403,json:{message:'Fixture forbids business writes'}})}
  if(p==='/api/v1/auth/passkeys/config')return route.fulfill({json:{enabled:false}});
  if(p==='/api/v1/schedule-calendar'){
   const month=new URL(req.url()).searchParams.get('month') || new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit'}).format(new Date());
   const count=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate();const dates=Array.from({length:count},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`);
   return route.fulfill({json:{data:{month,dates,approval:{status:'DRAFT',revision:1},employees:[{...employee,shifts:[{id:'layout-shift',workDate:dates[0]+'T00:00:00.000Z',shiftType:{id:'day',code:'D',name:'กะเช้า'},startTime:'08:00',endTime:'16:00',licenseStatus:'VALID',source:'SMS_V3'}]}]},meta:{page:1,total:1,totalPages:1}}});
  }
  if(p==='/api/v1/employees')return route.fulfill({json:{data:[employee],meta:{page:1,total:1,totalPages:1}}});
  if(p==='/api/v1/shift-types')return route.fulfill({json:{data:[{id:'day',code:'D',name:'กะเช้า',startTime:'08:00',endTime:'16:00',hours:8,color:'#22C55E',isActive:true}]}});
  if(p.endsWith('/leave-summary'))return route.fulfill({json:{data:{linked:true,employeeId:employee.id,remaining:{sickLeave:5,personalLeave:5,vacationLeave:5}}}});
  return route.fulfill({json:{data:[],summary:{total:0,byType:{}},meta:{page:1,pageSize:20,total:0,totalPages:0}}});
 });
 await page.goto(`/app/${path}`);await expect(page.locator('.nexus-public #auth-login-form')).toBeVisible({timeout:20_000});
 await page.locator('#email').fill('layout@example.test');await page.locator('#password').fill('synthetic-layout-password');await page.locator('#auth-login-form button[type=submit]').click();
 await expect(page.locator('.app-shell')).toBeVisible();
 await expect(page.locator('.sms-loader--content')).toHaveCount(0,{timeout:20_000});
 await expect(page.getByRole('heading',{level:1,name:new RegExp(title)})).toBeVisible();
 const root=page.locator('.layout-roster-page');await expect(root).toHaveCount(1);
 await expect(root.locator('.layout-section-card:visible').first()).toBeVisible();
 await expect.poll(()=>root.locator('h1,h2').evaluateAll(els=>els.every(el=>getComputedStyle(el).fontFamily.includes('Kanit')))).toBe(true);
 expect(await root.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
 const audit=await root.evaluate(el=>[...el.querySelectorAll<HTMLElement>('section,article,div,header')].flatMap(node=>{
  const rect=node.getBoundingClientRect(),s=getComputedStyle(node);if(rect.width<240||rect.height<24)return[];
  const background=s.backgroundColor!=='rgba(0, 0, 0, 0)'&&s.backgroundColor!=='transparent';const border=parseFloat(s.borderTopWidth)>0;
  if(!background&&!border)return[];
  const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let text:Node|null;let inset:{left:number;top:number}|null=null;
  while((text=walker.nextNode())){if(!text.textContent?.trim()||text.parentElement?.closest('button,select,svg'))continue;const range=document.createRange();range.selectNodeContents(text);const bounds=range.getBoundingClientRect();if(bounds.width>0&&bounds.height>0){inset={left:bounds.left-rect.left,top:bounds.top-rect.top};break}}
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d')!;ctx.fillStyle=s.backgroundColor;ctx.fillRect(0,0,1,1);const rgba=ctx.getImageData(0,0,1,1).data;const channels=[...rgba].slice(0,3).map(v=>{const x=v/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});const backgroundLum=rgba[3]>0 ? channels[0]*.2126+channels[1]*.7152+channels[2]*.0722 : null;
  return [{backgroundLum,class:node.className,radius:parseFloat(s.borderTopLeftRadius),paddingLeft:parseFloat(s.paddingLeft),paddingTop:parseFloat(s.paddingTop),inset}];
 }));
 await info.attach('large-box-layout-audit',{body:JSON.stringify(audit,null,2),contentType:'application/json'});
 expect(audit.filter(box=>![16,10].includes(box.radius)),JSON.stringify(audit)).toEqual([]);
 if(theme==='light')expect(audit.filter(box=>box.backgroundLum!==null && box.backgroundLum<.15),JSON.stringify(audit)).toEqual([]);
 expect(audit.filter(box=>box.inset && (box.inset.left<16||box.inset.top<12)),JSON.stringify(audit)).toEqual([]);
 for(const card of await root.locator('.layout-section-card,.layout-metric-card,.layout-step-flow').all()){
  if(!(await card.isVisible()))continue;
  const spacing=await card.evaluate(el=>{const r=el.getBoundingClientRect(),title=el.querySelector('h2')!.getBoundingClientRect();return{left:title.left-r.left,top:title.top-r.top,radius:getComputedStyle(el).borderTopLeftRadius}});
  expect(spacing.radius).toBe('16px');expect(spacing.left).toBeGreaterThanOrEqual(16);expect(spacing.top).toBeGreaterThanOrEqual(12);
 }
 if(path==='roster'){const steps=root.locator('.layout-step-flow li');await expect(steps).toHaveCount(4);await expect(steps.nth(0)).toContainText('เสร็จแล้ว');await expect(steps.nth(1)).toContainText('เสร็จแล้ว');expect(await steps.nth(2).innerText()).not.toContain('เสร็จแล้ว');expect(await steps.nth(3).innerText()).not.toContain('เสร็จแล้ว');}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);expect(writes).toEqual([]);expect(errors).toEqual([]);
 await page.screenshot({path:info.outputPath('roster-leave-layout.png'),fullPage:true});
});
