import {test,expect} from '@playwright/test';

// Owner issue 1 (2026-10-28): on wide screens the login page uses the width instead of squeezing the map.
// Owner follow-up (2026-10-28): the copy column and the login card must not cover the globe. The globe rings
// are drawn outside the <figure> box (SVG overflow), so measure the outer orbit (the widest ring), not the figure.
for(const viewport of [{width:1280,height:657},{width:1366,height:768},{width:1536,height:864},{width:1920,height:1080},{width:2560,height:1440}])test(`login keeps the globe clear of copy and card (${viewport.width}x${viewport.height})`,async({page})=>{
 await page.setViewportSize(viewport);
 await page.route('**/api/v1/**',route=>route.fulfill({status:401,json:{message:'No fixture session'}}));
 await page.goto('/app');await expect(page.locator('.nexus-public #auth-login-form')).toBeVisible();
 const boxes=await page.evaluate(()=>{const r=(s:string)=>document.querySelector(s)!.getBoundingClientRect();return {grid:r('.nexus-onescreen__grid'),copy:r('.nexus-onescreen__copy'),globe:r('.th-map__orbit--outer'),card:r('.nexus-onescreen__access')};});
 expect(boxes.copy.right).toBeLessThanOrEqual(boxes.globe.left+1);
 expect(boxes.globe.right).toBeLessThanOrEqual(boxes.card.left+1);
 if(viewport.width>=1920){expect(boxes.globe.width).toBeGreaterThanOrEqual(520);expect(boxes.grid.left).toBeLessThanOrEqual(Math.max(100,(viewport.width-1760)/2+1));}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
});
