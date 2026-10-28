import {test,expect} from '@playwright/test';

// Synthetic local browser fixture only: no real account, hosted deployment or business mutation.
const leaveTypes=[
 {id:'lt-sick',code:'SICK',name:'ลาป่วย',quotaBucket:'SICK',isActive:true,isSystem:true,sortOrder:10},
 {id:'lt-personal',code:'PERSONAL',name:'ลากิจส่วนตัว',quotaBucket:'PERSONAL',isActive:true,isSystem:true,sortOrder:20},
 {id:'lt-vacation',code:'VACATION',name:'ลาพักร้อน',quotaBucket:'VACATION',isActive:true,isSystem:true,sortOrder:30},
 {id:'lt-training',code:'TRAINING',name:'ลาฝึกอบรม',quotaBucket:'NONE',isActive:false,isSystem:false,sortOrder:100}
];

for(const theme of ['light','dark'])for(const viewport of [{width:1366,height:768},{width:375,height:812}])test(`leave types table ${theme} ${viewport.width}x${viewport.height}`,async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize(viewport);await page.addInitScript(value=>localStorage.setItem('sms-v3-theme',value),theme);
 await page.route('**/api/v1/**',route=>{
  const request=route.request(),pathname=new URL(request.url()).pathname;
  if(pathname==='/api/v1/auth/refresh')return route.fulfill({status:401,json:{message:'No fixture session'}});
  if(pathname==='/api/v1/auth/login')return route.fulfill({json:{accessToken:'synthetic-leave-type-token',user:{id:'lt-admin',email:'lt@example.test',displayName:'ผู้ดูแลทดสอบ',role:'ADMIN'}}});
  if(request.method()!=='GET')return route.fulfill({status:403,json:{message:'Fixture forbids business writes'}});
  if(pathname==='/api/v1/auth/passkeys/config')return route.fulfill({json:{enabled:false}});
  if(pathname==='/api/v1/leave-types')return route.fulfill({json:{data:leaveTypes}});
  return route.fulfill({json:{data:[],meta:{page:1,pageSize:25,total:0,totalPages:1}}});
 });

 await page.goto('/app/settings/leave-types');await expect(page.locator('.nexus-public #auth-login-form')).toBeVisible();
 await page.locator('#email').fill('lt@example.test');await page.locator('#password').fill('synthetic-leave-type-password');await page.locator('#auth-login-form button[type=submit]').click();
 const card=page.locator('.leave-type-master-card');await expect(card).toBeVisible({timeout:20_000});
 await expect(card.getByRole('heading',{level:2,name:'ประเภทการลา'})).toBeVisible();
 await expect(card.getByRole('button',{name:/เพิ่มประเภทการลา/})).toBeVisible();
 await expect(card.getByRole('button',{name:/ลบ|delete/i})).toHaveCount(0);
 if(viewport.width>=1024){
  await expect(card.locator('.leave-type-data-table tbody tr')).toHaveCount(4);
  const table=card.locator('.leave-type-data-table');
  await expect(table.locator('.leave-type-chip--sick')).toHaveText('ลาป่วย');
  await expect(card.locator('.leave-type-count')).toHaveText('4 รายการ');
  await table.getByRole('button',{name:'แก้ไข ลากิจ'}).click();
  const dialog=page.getByRole('dialog',{name:'แก้ไข ลากิจ'});await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox',{name:'กลุ่มโควตา PERSONAL'})).toBeDisabled();
  await page.screenshot({path:info.outputPath('edit-dialog.png')});
  await dialog.getByRole('button',{name:'ยกเลิก'}).click();await expect(dialog).toHaveCount(0);
 }
 await card.getByRole('button',{name:/เพิ่มประเภทการลา/}).click();
 const create=page.getByRole('dialog',{name:'เพิ่มประเภทการลา'});await expect(create).toBeVisible();
 await page.keyboard.press('Escape');await expect(create).toHaveCount(0);
 await page.screenshot({path:info.outputPath('table.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
 expect(errors).toEqual([]);
});
