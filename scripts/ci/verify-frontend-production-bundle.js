'use strict';
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..','..');const dir=path.join(root,'frontend','dist','assets');
const budgets={main:525000,map:1100000,other:500000};
const js=fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>n.endsWith('.js')).map(name=>({name,bytes:fs.statSync(path.join(dir,name)).size})):[];
let failed=false; const fail=(m)=>{failed=true;console.error('FRONTEND_PRODUCTION_BUNDLE=FAIL '+m)};
if(!js.length) fail('reason=no-js-assets');
for(const c of js){const limit=c.name.startsWith('index-')?budgets.main:c.name.startsWith('SecuritySiteMapPicker-')?budgets.map:budgets.other;if(c.bytes>limit)fail(`reason=budget-exceeded file=${c.name} bytes=${c.bytes} budget=${limit}`);if(c.name.includes('jsx-dev-runtime'))fail(`reason=jsx-dev-runtime-present file=${c.name}`)}
if(!js.some(c=>c.name.startsWith('SecuritySiteMapPicker-')))fail('reason=gis-lazy-chunk-missing');
if(!failed){const main=js.find(c=>c.name.startsWith('index-'));const map=js.find(c=>c.name.startsWith('SecuritySiteMapPicker-'));console.log(`FRONTEND_PRODUCTION_BUNDLE=PASS main_bytes=${main?.bytes||0} map_bytes=${map?.bytes||0} js_chunks=${js.length}`)}else process.exitCode=1;
