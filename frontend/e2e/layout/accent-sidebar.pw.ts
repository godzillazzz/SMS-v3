import {test,expect} from '@playwright/test';

// Synthetic local browser fixture only: no real account, hosted deployment or business mutation.
// Owner issue 3 (2026-10-28): the chosen accent recolours the Sidebar; the topbar shows name over role.
const accents=[['teal','เขียวน้ำทะเล','rgb(11, 79, 75)','rgb(14, 143, 136)'],['indigo','คราม','rgb(49, 46, 129)','rgb(79, 70, 229)'],['plum','พลัม','rgb(87, 43, 80)','rgb(163, 77, 144)']] as const;

test('sidebar follows the accent and the topbar profile stacks name over role',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await page.addInitScript(()=>localStorage.setItem('sms-v3-theme','light'));
 await page.route('**/api/v1/**',route=>{
  const request=route.request(),pathname=new URL(request.url()).pathname;
  if(pathname==='/api/v1/auth/refresh')return route.fulfill({status:401,json:{message:'No fixture session'}});
  if(pathname==='/api/v1/auth/login')return route.fulfill({json:{accessToken:'synthetic-accent-token',user:{id:'accent-admin',email:'admin@example.test',displayName:'Sermpong Tanos',role:'ADMIN'}}});
  if(request.method()!=='GET')return route.fulfill({status:403,json:{message:'Fixture forbids business writes'}});
  if(pathname==='/api/v1/auth/passkeys/config')return route.fulfill({json:{enabled:false}});
  return route.fulfill({json:{data:[],summary:{total:0,byType:{}},meta:{page:1,pageSize:20,total:0,totalPages:0}}});
 });
 await page.goto('/app');await expect(page.locator('.nexus-public #auth-login-form')).toBeVisible();
 await page.locator('#email').fill('admin@example.test');await page.locator('#password').fill('synthetic-accent-password');await page.locator('#auth-login-form button[type=submit]').click();
 const sidebar=page.locator('#sms-app .sidebar');await expect(sidebar).toBeVisible({timeout:20_000});

 const profile=page.locator('#sms-app .user-menu .topbar-profile');
 const stacked=await profile.evaluate(el=>{const b=el.querySelector('b')!.getBoundingClientRect(),s=el.querySelector('small')!.getBoundingClientRect();return s.top>=b.bottom-1;});
 expect(stacked).toBe(true);

 for(const [accent,label,fill,active] of accents){
  await profile.click();
  await page.locator('#topbar-user-menu').getByRole('button',{name:`สีหลัก${label}`}).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#sms-app')).toHaveAttribute('data-accent',accent);
  await expect.poll(()=>sidebar.evaluate(el=>getComputedStyle(el).backgroundImage)).toContain(fill);
  await expect.poll(()=>page.locator('#sms-app .sidebar .nav-item.active').first().evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(active);
 }
});
