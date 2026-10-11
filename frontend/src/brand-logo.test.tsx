import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync,statSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {BrandLogo} from './components/BrandLogo';
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
describe('T33 Owner-approved horizontal image brand',()=>{
  it.each(['auto','light-surface','dark-surface'] as const)('reserves correct intrinsic dimensions with accessible identity for %s',tone=>{
    const html=renderToStaticMarkup(<BrandLogo tone={tone}/>);expect(html).toContain(`data-tone="${tone}"`);
    expect(html).toContain('width="246" height="96"');expect(html).toContain('width="248" height="96"');
    expect(html).toContain('alt="SMS Security Management System"');expect(html).not.toContain('<strong>');
  });
  it('uses image-only identity across all six approved shell/public/login surfaces',()=>{
    const main=read('./main.tsx');expect(main.match(/<BrandLogo/g)?.length).toBe(6);
    expect(main).not.toContain('sms-brand-copy');expect(main).toContain('pwa-mobile-brand"><BrandLogo tone="dark-surface"');
    expect(read('./components/AwardPublicExperience.tsx')).not.toContain('nexus-brand__copy');
    for(const tone of ['','-dark']) expect(statSync(new URL(`../public/brand/sms-logo-horizontal${tone}.webp`,import.meta.url)).size).toBeLessThanOrEqual(25000);
  });
});
