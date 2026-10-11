import {test,expect} from '@playwright/test';
for(const theme of ['light','dark']) for(const width of [1366,375]) for(const variant of ['fullscreen','content']) {
  test(`T32 ${theme} ${width} ${variant}`,async({page},info)=>{
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewportSize({width,height:812});
    await page.goto(`/e2e/loading/fixture.html?theme=${theme}&variant=${variant}`);
    await expect(page.getByRole('status')).toContainText('กำลังเตรียมระบบ…');
    const image=page.getByAltText('SMS Security Management System').filter({visible:true});
    await expect(image).toHaveAttribute('src',`/brand/sms-logo${theme==='dark'?'-dark':''}.webp`);
    await expect.poll(()=>image.evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth>0)).toBe(true);
    const height=await image.evaluate(el=>el.getBoundingClientRect().height);
    expect(height).toBe(variant==='content'?120:width===375?180:240);
    await page.evaluate(()=>document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark');
    await expect.poll(()=>page.getByAltText('SMS Security Management System').filter({visible:true}).evaluate(el=>el.getBoundingClientRect().height)).toBe(height);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.emulateMedia({reducedMotion:'reduce'});
    expect(await page.locator('.sms-loader__progress').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
    expect(await page.getByRole('status').evaluate(el=>getComputedStyle(el).fontFamily)).toContain('Kanit');
    expect(await page.evaluate(async()=>{await document.fonts.ready;const style=getComputedStyle(document.querySelector('.sms-loader p')!);return document.fonts.check(`${style.fontWeight} ${style.fontSize} Kanit`,'กำลังเตรียมระบบ')})).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({path:info.outputPath('loader.png')});
  });
}
for(const dark of [false,true]) test(`T32 pre-JS splash ${dark?'dark':'light'}`,async({page})=>{
  await page.emulateMedia({colorScheme:dark?'dark':'light'});
  await page.route('**/src/main.tsx',route=>route.abort());
  await page.goto('/');
  const image=page.getByAltText('SMS Security Management System');
  await expect(page.getByRole('status')).toContainText('กำลังเตรียมระบบ…');
  await expect.poll(()=>image.evaluate((el:HTMLImageElement)=>el.currentSrc)).toContain(`sms-logo-splash${dark?'-dark':''}.webp`);
  expect(await page.locator('.sms-splash').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(dark?'rgb(2, 8, 19)':'rgb(245, 247, 251)');
});
test('T32 employee splash uses dark brand despite light desktop preference',async({page})=>{
  await page.emulateMedia({colorScheme:'light'});
  await page.route('**/src/main.tsx',route=>route.abort());await page.goto('/?pwa=1');
  await expect.poll(()=>page.getByAltText('SMS Security Management System').evaluate((el:HTMLImageElement)=>el.currentSrc)).toContain('sms-logo-splash-dark.webp');
  expect(await page.locator('.sms-splash').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(2, 8, 19)');
});
