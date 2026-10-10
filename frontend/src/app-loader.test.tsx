import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync,statSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe,it,expect} from 'vitest';
import {AppLoader} from './components/AppLoader';
describe('T32 accessible loading and offline brand',()=>{
  it('announces status once and preserves the caller message',()=>{
    const markup=renderToStaticMarkup(<AppLoader variant="content" message="กำลังโหลดหน้า…"/>);
    expect(markup).toContain('role="status" aria-live="polite"');
    expect(markup).toContain('กำลังโหลดหน้า…');
    expect(markup).toContain('sms-loader--content');
  });
  it('keeps both independently generated splash assets below 30KB',()=>{
    for(const tone of ['','-dark']) expect(statSync(new URL(`../public/brand/sms-logo-splash${tone}.webp`,import.meta.url)).size).toBeLessThanOrEqual(30000);
  });
  it('pre-caches all brand variants and leaves API and cross-origin requests alone',async()=>{
    const handlers:Record<string,(event:any)=>void>={};let cached:string[]=[];
    runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{
      URL,self:{location:{origin:'https://fixture.test'},skipWaiting(){},addEventListener:(name:string,handler:any)=>handlers[name]=handler},
      caches:{open:async()=>({addAll:async(urls:string[])=>{cached=urls;}})}
    });
    let install:Promise<void>|undefined;handlers.install({waitUntil:(promise:Promise<void>)=>install=promise});await install;
    for(const tone of ['','-dark']) for(const name of ['sms-logo','sms-logo-splash']) expect(cached).toContain(`/brand/${name}${tone}.webp`);
    for(const url of ['https://fixture.test/api/v1/auth/refresh','https://other.test/brand/sms-logo.webp']){
      let intercepted=false;handlers.fetch({request:{method:'GET',url},respondWith:()=>intercepted=true});expect(intercepted).toBe(false);
    }
  });
});
