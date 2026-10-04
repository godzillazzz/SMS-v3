'use strict';
const {inputs,guard}=require('./g06-physical-event-readonly');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(code){const e=new Error(code);e.safeCode=code;throw e;}
function failureInputs(env,now=Date.now()){
 const bounds=inputs({...env,EVENT_TYPE:'CHECK_IN'},now);
 if(!UUID.test(env.PRIOR_SCHEDULE_ID||''))fail('KNOWN_PRIOR_SCHEDULE_REQUIRED');
 return{...bounds,at:new Date(env.REPORTED_AT),prior:env.PRIOR_SCHEDULE_ID};
}
// Known previously accepted schedule is only a private correlation selector, never output.
const SUBJECT=`SELECT DISTINCT a.actor_user_id, s.employee_id
 FROM attendance_sessions s JOIN attendance_events e ON e.session_id=s.id
 JOIN audit_logs a ON a.entity_type='AttendanceEvent' AND a.entity_id=e.id::text
 JOIN users u ON u.id=a.actor_user_id AND u.employee_id=s.employee_id
 WHERE s.shift_assignment_id=$1::uuid AND e.event_type::text='CHECK_IN'
 AND a.action::text='CREATE' AND a.metadata->>'event'='ATTENDANCE_SIMPLE_ACCEPTED'
 AND e.received_at BETWEEN $2::timestamp - interval '72 hours' AND $2::timestamp
 LIMIT 2`;
const STATS=`SELECT
 (SELECT count(*)::int FROM attendance_events e JOIN attendance_sessions s ON s.id=e.session_id
 WHERE s.employee_id=$1::uuid AND (e.received_at BETWEEN $2::timestamp AND $3::timestamp
 OR e.effective_event_at BETWEEN $2::timestamp AND $3::timestamp)) AS event_count,
 (SELECT count(*)::int FROM attendance_pending_events p WHERE p.employee_id=$1::uuid
 AND p.received_at BETWEEN $2::timestamp AND $3::timestamp) AS pending_count,
 (SELECT count(*)::int FROM attendance_device_enrollments d WHERE d.employee_id=$1::uuid
 AND d.status::text='ACTIVE') AS active_device_count`;
const KNOWN=new Set(['ATTENDANCE_ALREADY_CHECKED_OUT','ATTENDANCE_ASSIGNMENT_REQUIRED','ATTENDANCE_SHIFT_NOT_ACTIONABLE','ATTENDANCE_SCHEDULE_NOT_APPROVED','ATTENDANCE_SITE_REQUIRED','ATTENDANCE_SITE_INACTIVE','ATTENDANCE_SITE_AUTHORITY_CONFLICT','ATTENDANCE_EMPLOYEE_LINK_REQUIRED','INACTIVE_EMPLOYEE_OPERATION']);
function classification(code){
 if(code==='ATTENDANCE_ALREADY_CHECKED_OUT')return'OTHER_STRUCTURED_SERVER_ERROR';
 if(['ATTENDANCE_ASSIGNMENT_REQUIRED','ATTENDANCE_SHIFT_NOT_ACTIONABLE','ATTENDANCE_SCHEDULE_NOT_APPROVED'].includes(code))return'NO_APPROVED_SHIFT_AT_TIME';
 if(['ATTENDANCE_SITE_REQUIRED','ATTENDANCE_SITE_INACTIVE','ATTENDANCE_SITE_AUTHORITY_CONFLICT'].includes(code))return'SCHEDULE_RESOLUTION_FAILED';
 return'UNKNOWN_FAIL_CLOSED';
}
async function diagnose(prisma,input,dependencies={}){return prisma.$transaction(async tx=>{
 await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
 await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5000ms'");
 if((await tx.$queryRawUnsafe("SELECT current_setting('transaction_read_only') AS readonly"))[0]?.readonly!=='on')fail('READONLY_NOT_ENFORCED');
 const subjects=await tx.$queryRawUnsafe(SUBJECT,input.prior,input.at);
 if(subjects.length!==1)fail(subjects.length?'SUBJECT_AMBIGUOUS':'PRIOR_SUBJECT_NOT_FOUND');
 const subject=subjects[0];const [stats]=await tx.$queryRawUnsafe(STATS,subject.employee_id,input.from,input.to);
 const observed={approval:null,assignment:null,site:null,session:null};
 const client=new Proxy(tx,{get(target,key){
  const model=Reflect.get(target,key);if(!['scheduleApproval','attendanceSession'].includes(key))return typeof model==='function'?model.bind(target):model;
  return new Proxy(model,{get(delegate,method){const fn=Reflect.get(delegate,method);if(typeof fn!=='function')return fn;
   return async(...args)=>{const row=await fn.apply(delegate,args);if(key==='scheduleApproval')observed.approval=row;else if(row?.events)observed.session=row;return row;};
  }});
 }});
 const {createSecuritySiteAuthorityService}=dependencies.authority||require('../../src/services/security-site-authority.service');
 const authority=createSecuritySiteAuthorityService({prisma:client});
 const tracedAuthority={resolve:async(args,p)=>{observed.assignment=args.assignment;const result=await authority.resolve(args,p);observed.site=result;return result;}};
 const {createAttendanceSimpleService}=dependencies.service||require('../../src/services/attendance-simple.service');
 const service=createAttendanceSimpleService({prisma:client,clock:()=>input.at,siteAuthorityService:tracedAuthority,
  audit:{log:()=>fail('UNEXPECTED_AUDIT_WRITE')},bundleSecret:()=>fail('UNEXPECTED_BOOTSTRAP_SUCCESS')});
 let code=null,status=null;
 try{await service.bootstrap({actor:{sub:subject.actor_user_id}});fail('UNEXPECTED_BOOTSTRAP_SUCCESS');}
 catch(e){if(e.safeCode)throw e;code=e.details?.code||e.publicCode||e.code;status=e.statusCode;if(!KNOWN.has(code))fail('UNKNOWN_BOOTSTRAP_RESULT');}
 let checkInWindow=null,windowCode=null;
 if(observed.assignment){
  const {createAttendanceTimePolicyService,validateAttendanceTime}=dependencies.time||require('../../src/services/attendance-time-policy.service');
  const resolved=await createAttendanceTimePolicyService({prisma:client}).resolveForAssignment({assignment:observed.assignment,at:input.at},client);
  try{validateAttendanceTime({assignment:observed.assignment,eventIntent:'CHECK_IN',effectiveAt:input.at,policy:resolved.values});checkInWindow=true;}
  catch(e){checkInWindow=false;windowCode=e.details?.code||null;}
 }
 const types=observed.session?.events?.map(e=>e.eventType)||[];
 const expected=code==='ATTENDANCE_ALREADY_CHECKED_OUT'||classification(code)==='NO_APPROVED_SHIFT_AT_TIME';
 return{STATUS:stats.event_count===0&&stats.pending_count===0?'PASS':'PARTIAL',MODE:'READ_ONLY_FAILED_ATTEMPT_DIAGNOSIS',
  CLASSIFICATION:classification(code),SOURCE_REPLAY_CODE:code,SOURCE_REPLAY_HTTP_STATUS:status,
  CODE_PROVENANCE:'EXACT_UNCHANGED_SOURCE_READ_ONLY_REPLAY_AT_REPORTED_TIME_NOT_CAPTURED_HTTP_RESPONSE',
  EXPECTED_REJECTION:expected,SCHEDULE_RESOLVED:!!observed.assignment,SCHEDULE_APPROVED:observed.approval?.status==='APPROVED',
  SHIFT:observed.assignment?.shiftType?.code||null,CHECK_IN_TIME_POLICY_ALLOWED:checkInWindow,TIME_POLICY_REJECTION_CODE:windowCode,
  ASSIGNED_SITE_RESOLVED:!!observed.site,ASSIGNED_SITE_CODE:observed.site?.site?.code||null,
  SITE_AUTHORITY_SOURCE:observed.site?.source||null,SESSION_STATE:observed.session?.state||null,
  SESSION_CHECK_IN_COUNT:types.filter(t=>t==='CHECK_IN').length,SESSION_CHECK_OUT_COUNT:types.filter(t=>t==='CHECK_OUT').length,
  GPS_VALIDATION_REACHED:false,DEVICE_VALIDATION_REACHED:false,DEVICE_CAUSED_REPLAY_REJECTION:false,
  ACTIVE_DEVICE_COUNT:stats.active_device_count,ATTEMPT_WINDOW_EVENT_COUNT:stats.event_count,
  ATTEMPT_WINDOW_PENDING_COUNT:stats.pending_count,ATTENDANCE_EVENT_CREATED:stats.event_count>0,
  DATABASE_MUTATION_PERFORMED:false,ACTUAL_HTTP_CODE:'NOT_RETAINED_IN_AVAILABLE_REQUEST_LOGS'};
},{maxWait:5000,timeout:20000});}
async function main(env=process.env){let prisma;try{
 const input=failureInputs(env);await guard(env);
 const {PrismaClient}=require('@prisma/client');prisma=new PrismaClient({log:[],errorFormat:'minimal',datasources:{db:{url:env.DIRECT_URL}}});
 const result=await diagnose(prisma,input);console.log(JSON.stringify(result,null,2));if(result.STATUS!=='PASS')process.exitCode=1;
}catch(e){console.error(JSON.stringify({STATUS:'FAIL_CLOSED',REASON:e.safeCode||'GUARD_OR_QUERY_FAILED',DATABASE_MUTATION_PERFORMED:false}));process.exitCode=1;}
finally{if(prisma)await prisma.$disconnect().catch(()=>{});}}
if(require.main===module)main();
module.exports={failureInputs,classification,diagnose,SUBJECT,STATS};
