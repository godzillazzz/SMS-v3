'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const {inputs,verify,summarize,CANDIDATES}=require('../scripts/ci/g06-physical-event-readonly');
const at='2026-10-05T07:01:00+07:00',now=Date.parse(at),id='11111111-1111-4111-8111-111111111111';
const input=()=>inputs({REPORTED_AT:at,EVENT_TYPE:'CHECK_IN'},now);
const row=()=>({id,session_id:id,capture_id:id,event_type:'CHECK_IN',source_mode:'ONLINE',received_at:new Date(at),effective_event_at:new Date(at),device_captured_at:null,time_basis:'SERVER_RECEIVED',shift_assignment_id:id,work_date:new Date('2026-10-05'),shift_code:'D',shift_start:'07:00',shift_end:'19:00',session_state:'OPEN',assigned_site:'A',actual_site:'A',assignment_unchanged:true,expected_site_matches:true,same_site:true,context:'ASSIGNED_SITE',geofence:'CONFIDENT_INSIDE',gps_captured_at:at,gps_present:true,accuracy:'8.00',device_binding:'PRIMARY',device_matches:true,simple_mode:true,current_device_status:'ACTIVE',review_required:false,review_reasons:null,policy_snapshot_present:true,punctuality:'LATE',checkout_condition:null});
const event=()=>({event_type:'CHECK_IN',effective_event_at:new Date(at),received_at:new Date(at)});
const good=r=>summarize(r,{capture_count:1,type_count:1},[event()],{audit_count:1,correlated:true},input());
test('strict recent zoned time/type and max bounded radius; selectors parameterized',()=>{
 assert.equal(input().to-input().from,240000);
 for(const values of [{REPORTED_AT:'07:01'},{REPORTED_AT:'2026-10-05T07:01:00'},{EVENT_TYPE:'DELETE'},{WINDOW_SECONDS:'301'},{WINDOW_SECONDS:'0'},{CAPTURE_ID:"' OR true--"},{SUBJECT_USER_ID:'name'},{EXPECTED_CONTEXT:'ANY'},{REPORTED_AT:'2026-09-01T07:01:00Z'}])assert.throws(()=>inputs({REPORTED_AT:at,EVENT_TYPE:'CHECK_IN',...values},now));
 assert(CANDIDATES.includes('LIMIT 21'));assert(CANDIDATES.includes('$4::uuid'));
});
test('sanitized evidence proves LATE/assigned Site/duplicate1 without personal or cryptographic details',()=>{
 const result=good(row());assert.equal(result.STATUS,'PASS');assert.equal(result.DUPLICATE_COUNT,1);assert.equal(result.SERVER_NEXT_ACTION,'CHECK_OUT');assert.equal(result.PUNCTUALITY,'LATE');
 const text=JSON.stringify(result);for(const secret of ['employee_id','latitude','longitude','credentialFingerprint','gpsEvidenceDigest','publicKey','cookie','password'])assert(!text.includes(secret));
 assert.equal(result.PHYSICAL_PRESENCE,'OWNER_REPORTED_NOT_INDEPENDENTLY_ATTESTED');assert.equal(result.RELOAD,'OWNER_SCREEN_EVIDENCE_REQUIRED');
});
test('foreign device and Support Site are independent but matching review flag is required',()=>{
 const r={...row(),same_site:false,actual_site:'B',context:'SUPPORT_SITE',review_required:true,review_reasons:['ASSIST_OTHER_SITE','DEVICE_MISMATCH'],device_binding:'FOREIGN'};assert.equal(good(r).STATUS,'PASS');
 assert.equal(good({...r,review_reasons:['ASSIST_OTHER_SITE']}).STATUS,'PARTIAL');
 assert.equal(good({...r,review_reasons:['password-do-not-print']}).REVIEW_FLAGS[0],'OTHER_REVIEW_FLAG');
});
test('unknown device/GPS/site/policy/audit/order/duplicate evidence never passes',()=>{
 for(const change of [{device_binding:'UNKNOWN'},{accuracy:null},{accuracy:'51'},{gps_present:false},{geofence:'CONFIDENT_OUTSIDE'},{assignment_unchanged:false},{expected_site_matches:false},{policy_snapshot_present:false},{same_site:false},{device_matches:false},{session_state:'CLOSED'}])assert.equal(good({...row(),...change}).STATUS,'PARTIAL');
 assert.equal(summarize(row(),{capture_count:2,type_count:1},[event()],{audit_count:1,correlated:true},input()).STATUS,'PARTIAL');
 assert.equal(summarize(row(),{capture_count:1,type_count:1},[event()],{audit_count:0,correlated:false},input()).STATUS,'PARTIAL');
});
test('CHECK_OUT EARLY_LEAVE uses actual source vocabulary and requires check-in first',()=>{
 const r={...row(),event_type:'CHECK_OUT',punctuality:null,checkout_condition:'EARLY_LEAVE',session_state:'CLOSED'};
 const out={...event(),event_type:'CHECK_OUT',effective_event_at:new Date(now+3600000)};
 assert.equal(summarize(r,{capture_count:1,type_count:1},[event(),out],{audit_count:1,correlated:true},{...input(),type:'CHECK_OUT'}).STATUS,'PASS');
 assert.equal(summarize(r,{capture_count:1,type_count:1},[out],{audit_count:1,correlated:true},input()).STATUS,'PARTIAL');
});
function fake(rows){const calls=[];const tx={
 $executeRawUnsafe:async sql=>{calls.push(sql);return 0;},
 $queryRawUnsafe:async(sql,...args)=>{calls.push({sql,args});if(sql.includes('current_setting'))return[{readonly:'on'}];if(sql===CANDIDATES)return rows;if(sql.includes('capture_count'))return[{capture_count:1,type_count:1}];if(sql.includes('audit_count'))return[{audit_count:1,correlated:true}];return[event()];}
};return{calls,db:{$transaction:async(fn,options)=>{assert.equal(options.timeout,20000);return fn(tx);}}};}
test('transaction read-only is enforced before any bounded lookup; unique match required',async()=>{
 const h=fake([row()]);assert.equal((await verify(h.db,input())).STATUS,'PASS');assert(h.calls[0].includes('READ ONLY'));assert(h.calls[1].includes('statement_timeout'));
 for(const [rows,reason] of [[[],'EVENT_NOT_FOUND'],[[row(),row()],'EVENT_AMBIGUOUS'],[Array(21).fill(row()),'EVENT_WINDOW_OVERFLOW']]){const f=fake(rows);await assert.rejects(verify(f.db,input()),new RegExp(reason));assert.equal(f.calls.filter(c=>typeof c==='object').length,2);}
});
test('workflow keeps normal protection, exact CI and contains no deployment/migration/business mutation commands',()=>{
 const s=fs.readFileSync('.github/workflows/diagnose-production-database.yml','utf8');
 for(const value of ['production-sms-v3-staging','contents: read','actions: read','EXACT_TOOL_CI_REQUIRED','npx prisma generate'])assert(s.includes(value));
 assert.doesNotMatch(s,/migrate deploy|migrate resolve|db push|vercel promote|environment_ids|bypass/);
});
