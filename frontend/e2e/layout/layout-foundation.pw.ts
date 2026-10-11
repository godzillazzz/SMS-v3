import {expect,test} from '@playwright/test';
for (const theme of ['light','dark'] as const) for (const width of [1366,375]) {
  test(`T30a ${theme} ${width}: computed card tokens, Thai fonts and keyboard`,async({page},info)=>{
    const errors:string[]=[];const writes:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/')&&!['GET','HEAD','OPTIONS'].includes(r.method()))writes.push(r.method());});
    await page.setViewportSize({width,height:width===375?812:768});
    await page.addInitScript(t=>localStorage.setItem('sms-v3-theme',t),theme);
    await page.goto('/e2e/layout/fixture.html');
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    await expect(page.getByRole('heading',{level:1})).toHaveText('รายการของหน่วยงาน');
    const fonts=await page.evaluate(async()=>{const heading=await document.fonts.load("600 16px Kanit","ข้อมูล");const body=await document.fonts.load("400 16px 'Noto Sans Thai'","ข้อมูล");await document.fonts.ready;return {heading:heading.length,body:body.length};});
    expect(fonts.heading).toBeGreaterThan(0);expect(fonts.body).toBeGreaterThan(0);
    const styles=await page.evaluate(()=>{
      const card=getComputedStyle(document.querySelector('.layout-section-card')!);const nested=getComputedStyle(document.querySelector('.layout-step-flow__steps button')!);const header=getComputedStyle(document.querySelector('.layout-page-header h1')!);const pane=getComputedStyle(document.querySelector('.view-pane')!);
      return {radius:card.borderRadius,padding:card.padding,nestedRadius:nested.borderRadius,headingFont:header.fontFamily,bodyFont:card.fontFamily,paneBackground:pane.backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    expect(styles.radius).toBe('16px');expect(styles.padding).toBe(width===375?'16px':'24px');expect(styles.nestedRadius).toBe('10px');expect(styles.headingFont).toContain('Kanit');expect(styles.bodyFont).toContain('Noto Sans Thai');expect(styles.paneBackground).toBe('rgba(0, 0, 0, 0)');expect(styles.overflow).toBe(false);
    const contrasts=await page.locator('.view-pane').evaluate(root=>{
      const parse=(v:string)=>v.match(/[0-9.]+/g)!.map(Number);
      const luminance=(v:number[])=>{const c=v.slice(0,3).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return .2126*c[0]+.7152*c[1]+.0722*c[2];};
      return Array.from(root.querySelectorAll('h1,h2,p,small,strong')).filter(e=>!e.closest('button:disabled')).map(e=>{
        let ancestor:Element|null=e;let background='rgb(255,255,255)';while(ancestor){const v=getComputedStyle(ancestor).backgroundColor;const a=parse(v);if(a.length===3||a[3]===1){background=v;break;}ancestor=ancestor.parentElement;}
        const foreground=getComputedStyle(e).color;const values=[luminance(parse(foreground)),luminance(parse(background))].sort((a,b)=>b-a);return {text:e.textContent?.slice(0,60),foreground,background,contrast:(values[0]+.05)/(values[1]+.05)};
      });
    });
    for(const sample of contrasts)expect(sample.contrast,JSON.stringify(sample)).toBeGreaterThanOrEqual(4.5);
    await info.attach('computed-layout-contrast',{body:JSON.stringify(contrasts,null,2),contentType:'application/json'});
    const action=page.getByRole('button',{name:/ขั้นที่หนึ่ง เลือกเดือน/});await action.focus();await page.keyboard.press('Enter');await expect(page.getByLabel('จำนวนการเปิดรายการ')).toHaveText('1');await page.keyboard.press('Space');await expect(page.getByLabel('จำนวนการเปิดรายการ')).toHaveText('2');expect(await action.evaluate(e=>getComputedStyle(e).boxShadow)).not.toBe('none');
    await info.attach('computed-layout-styles',{body:JSON.stringify(styles,null,2),contentType:'application/json'});
    await page.screenshot({path:info.outputPath(`layout-${theme}-${width}.png`),fullPage:true});expect(errors).toEqual([]);expect(writes).toEqual([]);
  });
}
test('T30a system theme responds live with matching semantic dataset and dark class',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('sms-v3-theme','system'));await page.emulateMedia({colorScheme:'light'});await page.goto('/e2e/layout/fixture.html');await expect(page.locator('html')).toHaveAttribute('data-theme','light');await expect(page.locator('html')).not.toHaveClass(/dark/);await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect(page.locator('html')).toHaveClass(/dark/);await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','light');await expect(page.locator('html')).not.toHaveClass(/dark/);
});
