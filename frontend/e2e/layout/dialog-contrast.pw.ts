import {test,expect,type Page} from '@playwright/test';

// Synthetic local browser fixture only: no real account, hosted deployment or business mutation.
// Owner issues 4-7 (2026-10-28): dialog text and close buttons must stay readable in light and dark themes.
const employee={id:'contrast-employee',employeeCode:'E001',firstName:'ทัศยุ',lastName:'สุริโย',department:'PO11',jobTitle:'Supervisor',isActive:true,email:'e001@example.test',phone:null,hiredAt:null};

async function measure(page:Page,selector:string){
 return page.locator(selector).first().evaluate(root=>{
  const parse=(v:string)=>{const m=v.match(/[\d.]+/g)?.map(Number)||[0,0,0,0];return {rgb:m.slice(0,3),a:m.length>3?m[3]:1};};
  const lum=(rgb:number[])=>{const c=rgb.map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return .2126*c[0]+.7152*c[1]+.0722*c[2];};
  const ratio=(a:number[],b:number[])=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const background=(el:Element|null):number[]=>{for(let n=el;n;n=n.parentElement){const {rgb,a}=parse(getComputedStyle(n).backgroundColor);if(a>.5)return rgb;}return [255,255,255];};
  const visible=(el:HTMLElement)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity)>.2;};
  const failures:string[]=[];
  for(const el of root.querySelectorAll<HTMLElement>('*')){
   if(!visible(el))continue;
   const ownText=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent!.trim().length>0);
   const iconButton=el.tagName==='BUTTON'&&!el.textContent!.trim()&&el.querySelector('svg');
   if(!ownText&&!iconButton)continue;
   if((el as HTMLButtonElement).disabled||el.closest('[disabled],[aria-disabled="true"]'))continue;
   const s=getComputedStyle(el);
   const color=iconButton?parse(getComputedStyle(el.querySelector('svg')!).color).rgb:parse(s.color).rgb;
   const r=ratio(color,background(el));
   if(r<3)failures.push(`${r.toFixed(2)} ${el.tagName.toLowerCase()}.${String(el.className).split(' ').filter(Boolean).slice(0,2).join('.')} "${(el.textContent||el.getAttribute('aria-label')||'').trim().slice(0,30)}"`);
  }
  return failures;
 });
}

for(const theme of ['light','dark'])test(`dialog text and close buttons stay readable (${theme})`,async({page})=>{
 await page.setViewportSize({width:1366,height:768});await page.addInitScript(value=>localStorage.setItem('sms-v3-theme',value),theme);
 await page.route('**/api/v1/**',route=>{
  const request=route.request(),pathname=new URL(request.url()).pathname;
  if(pathname==='/api/v1/auth/refresh')return route.fulfill({status:401,json:{message:'No fixture session'}});
  if(pathname==='/api/v1/auth/login')return route.fulfill({json:{accessToken:'synthetic-contrast-token',user:{id:'contrast-admin',email:'admin@example.test',displayName:'ผู้ดูแลทดสอบ',role:'ADMIN'}}});
  if(request.method()!=='GET')return route.fulfill({status:403,json:{message:'Fixture forbids business writes'}});
  if(pathname==='/api/v1/auth/passkeys/config')return route.fulfill({json:{enabled:false}});
  if(pathname==='/api/v1/employees')return route.fulfill({json:{data:[employee],meta:{page:1,pageSize:10,total:1,totalPages:1,departments:['PO11'],summary:{total:1,active:1,incomplete:0}}}});
  return route.fulfill({json:{data:[],summary:{total:0,byType:{}},meta:{page:1,pageSize:20,total:0,totalPages:0}}});
 });
 await page.goto('/app/employees');await expect(page.locator('.nexus-public #auth-login-form')).toBeVisible();
 await page.locator('#email').fill('admin@example.test');await page.locator('#password').fill('synthetic-contrast-password');await page.locator('#auth-login-form button[type=submit]').click();
 await expect(page.locator('.sms-loader--content')).toHaveCount(0,{timeout:20_000});

 await page.getByRole('button',{name:/คำขอแก้ไข/}).first().click();
 const review=page.getByRole('dialog').first();await expect(review).toBeVisible();await page.waitForTimeout(400);
 const reviewFailures=await measure(page,'[role="dialog"]');
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);

 await page.getByRole('button',{name:/แก้ไขข้อมูล ทัศยุ/}).click();
 await expect(page.getByRole('dialog').first()).toBeVisible();await page.waitForTimeout(600);
 const editFailures=await measure(page,'[role="dialog"]');

 if(process.env.CONTRAST_REPORT)require('node:fs').writeFileSync(process.env.CONTRAST_REPORT+'-'+theme+'.json',JSON.stringify({reviewFailures,editFailures},null,1));
 expect({reviewFailures,editFailures}).toEqual({reviewFailures:[],editFailures:[]});
});
