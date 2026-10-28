import {test,expect} from '@playwright/test';

// Owner issue 1 (2026-10-28): on wide screens the login page uses the width instead of squeezing the map.
for(const viewport of [{width:1920,height:1080},{width:2560,height:1440}])test(`login uses wide screens (${viewport.width}x${viewport.height})`,async({page})=>{
 await page.setViewportSize(viewport);
 await page.route('**/api/v1/**',route=>route.fulfill({status:401,json:{message:'No fixture session'}}));
 await page.goto('/app');await expect(page.locator('.nexus-public #auth-login-form')).toBeVisible();
 const boxes=await page.evaluate(()=>{const r=(s:string)=>document.querySelector(s)!.getBoundingClientRect();return {grid:r('.nexus-onescreen__grid'),copy:r('.nexus-onescreen__copy'),map:r('.th-map'),card:r('.nexus-onescreen .nexus-auth-shell')};});
 expect(boxes.map.width).toBeGreaterThanOrEqual(520);
 expect(boxes.copy.right).toBeLessThanOrEqual(boxes.map.left+1);
 expect(boxes.map.right).toBeLessThanOrEqual(boxes.card.left+1);
 expect(boxes.grid.left).toBeLessThanOrEqual(Math.max(100,(viewport.width-1760)/2+1));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
});
