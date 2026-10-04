'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {failureInputs,classification,diagnose,SUBJECT,STATS}=require('../scripts/ci/g06-failed-attempt-readonly');
const id='11111111-1111-4111-8111-111111111111',at='2026-10-04T20:26:00+07:00';
test('rejected attempt requires recent bounded time and known private schedule selector',()=>{
 const env={REPORTED_AT:at,PRIOR_SCHEDULE_ID:id};assert.equal(failureInputs(env,Date.parse(at)).at.toISOString(),'2026-10-04T13:26:00.000Z');
 for(const change of [{PRIOR_SCHEDULE_ID:''},{PRIOR_SCHEDULE_ID:'name'},{WINDOW_SECONDS:301},{REPORTED_AT:'20:26'}])assert.throws(()=>failureInputs({...env,...change},Date.parse(at)));
 assert(SUBJECT.includes('LIMIT 2'));assert(STATS.includes('BETWEEN $2::timestamp AND $3::timestamp'));
});
test('completed session is a separate expected server error, not invented missing schedule',()=>{
 assert.equal(classification('ATTENDANCE_ALREADY_CHECKED_OUT'),'OTHER_STRUCTURED_SERVER_ERROR');
 assert.equal(classification('ATTENDANCE_SCHEDULE_NOT_APPROVED'),'NO_APPROVED_SHIFT_AT_TIME');
 assert.equal(classification('unrecognized'),'UNKNOWN_FAIL_CLOSED');
});
function fixture(subjects=[{actor_user_id:id,employee_id:id}],count=0){const calls=[];const session={employeeId:id,state:'CLOSED',events:[{eventType:'CHECK_IN'},{eventType:'CHECK_OUT'}]};
 const tx={$executeRawUnsafe:async q=>{calls.push(q);},$queryRawUnsafe:async q=>{calls.push(q);return q===SUBJECT?subjects:q===STATS?[{event_count:count,pending_count:0,active_device_count:1}]:[{readonly:'on'}];},scheduleApproval:{findFirst:async()=>({status:'APPROVED'})},attendanceSession:{findUnique:async()=>session}};
 const dependencies={authority:{createSecuritySiteAuthorityService:()=>({resolve:async()=>({source:'DEPARTMENT_DEFAULT',site:{code:'WCS'}})})},
 service:{createAttendanceSimpleService:options=>({bootstrap:async()=>{await options.prisma.scheduleApproval.findFirst();await options.siteAuthorityService.resolve({assignment:{shiftType:{code:'D'}}},options.prisma);await options.prisma.attendanceSession.findUnique();const e=new Error('private data must not appear');e.statusCode=409;e.details={code:'ATTENDANCE_ALREADY_CHECKED_OUT'};throw e;}})},
 time:{createAttendanceTimePolicyService:()=>({resolveForAssignment:async()=>({values:{}})}),validateAttendanceTime:()=>{}}};
 return{calls,dependencies,prisma:{$transaction:async(fn,opts)=>{assert.equal(opts.timeout,20000);return fn(tx);}}};
}
test('bounded read-only replay correlates subject and keeps identifiers/details out of evidence',async()=>{
 const f=fixture(),result=await diagnose(f.prisma,failureInputs({REPORTED_AT:at,PRIOR_SCHEDULE_ID:id},Date.parse(at)),f.dependencies);
 assert.equal(result.STATUS,'PASS');assert.equal(result.SOURCE_REPLAY_CODE,'ATTENDANCE_ALREADY_CHECKED_OUT');assert.equal(result.ATTEMPT_WINDOW_EVENT_COUNT,0);assert.equal(result.GPS_VALIDATION_REACHED,false);assert.equal(result.DEVICE_VALIDATION_REACHED,false);
 assert(f.calls[0].includes('READ ONLY'));assert(!JSON.stringify(result).includes(id));assert(!JSON.stringify(result).includes('private data'));
 assert(result.CODE_PROVENANCE.includes('NOT_CAPTURED_HTTP_RESPONSE'));
 const rejected=fixture([],0);await assert.rejects(diagnose(rejected.prisma,failureInputs({REPORTED_AT:at,PRIOR_SCHEDULE_ID:id},Date.parse(at)),rejected.dependencies),/PRIOR_SUBJECT_NOT_FOUND/);
 const ambiguous=fixture([{},{},{}]);await assert.rejects(diagnose(ambiguous.prisma,failureInputs({REPORTED_AT:at,PRIOR_SCHEDULE_ID:id},Date.parse(at)),ambiguous.dependencies),/SUBJECT_AMBIGUOUS/);
 const withEvent=fixture(undefined,1);assert.equal((await diagnose(withEvent.prisma,failureInputs({REPORTED_AT:at,PRIOR_SCHEDULE_ID:id},Date.parse(at)),withEvent.dependencies)).STATUS,'PARTIAL');
});

test('replay invokes exact application bootstrap and stops before GPS/device for completed D shift',async()=>{
 const f=fixture();const assignment={id,employeeId:id,workDate:new Date('2026-10-04T00:00:00Z'),shiftTypeId:id,shiftType:{code:'D',startTime:'07:00',endTime:'19:00'}};
 const original=f.prisma.$transaction;f.prisma.$transaction=async(fn,opts)=>original(async tx=>{tx.user={findUnique:async()=>({id,employeeId:id,isActive:true,accountStatus:'ACTIVE',employee:{id,isActive:true,deletedAt:null}})};tx.shiftAssignment={findMany:async()=>[assignment]};return fn(tx);},opts);
 const real=require('../src/services/attendance-simple.service');f.dependencies.service={createAttendanceSimpleService:options=>real.createAttendanceSimpleService({...options,policyService:{getPolicy:async()=>({})}})};
 const result=await diagnose(f.prisma,failureInputs({REPORTED_AT:at,PRIOR_SCHEDULE_ID:id},Date.parse(at)),f.dependencies);
 assert.equal(result.SOURCE_REPLAY_HTTP_STATUS,409);assert.equal(result.SOURCE_REPLAY_CODE,'ATTENDANCE_ALREADY_CHECKED_OUT');assert.equal(result.EXPECTED_REJECTION,true);assert.equal(result.SCHEDULE_APPROVED,true);assert.equal(result.SESSION_STATE,'CLOSED');
});
