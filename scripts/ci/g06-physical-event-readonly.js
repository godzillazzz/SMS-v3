'use strict';

const EXPECTED = Object.freeze({sha:'8bae84a50e8cd2c3d96ba2393a8004ea4abaafeb',tree:'e125272c8ab6f934d973212b444a8a918887854a',deployment:'dpl_2y3cjq7qx13MLjCY54L24J54sJer',project:'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s',team:'team_nemCExHbZ8EAhSgsvefHPAEz',ref:'fix/serverless-database-reliability',alias:'sms-v3-staging-ten.vercel.app'});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(code){const e=new Error(code);e.safeCode=code;throw e;}
function inputs(env,now=Date.now()){
  const time=String(env.REPORTED_AT||'');
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(time)||!Number.isFinite(Date.parse(time)))fail('REPORTED_TIME_WITH_OFFSET_REQUIRED');
  const type=env.EVENT_TYPE;if(!['CHECK_IN','CHECK_OUT'].includes(type))fail('EVENT_TYPE_INVALID');
  const radius=env.WINDOW_SECONDS===undefined?120:Number(env.WINDOW_SECONDS);if(!Number.isInteger(radius)||radius<15||radius>300)fail('WINDOW_INVALID');
  const capture=env.CAPTURE_ID||null,subject=env.SUBJECT_USER_ID||null;
  if((capture&&!UUID.test(capture))||(subject&&!UUID.test(subject)))fail('SELECTOR_INVALID');
  const context=env.EXPECTED_CONTEXT||null;if(context&&!['ASSIGNED_SITE','SUPPORT_SITE'].includes(context))fail('CONTEXT_INVALID');
  const t=Date.parse(time);if(t>now+300000||t<now-72*3600000)fail('REPORTED_TIME_NOT_RECENT');return{from:new Date(t-radius*1000),to:new Date(t+radius*1000),type,capture,subject,context};
}

// No employee names, raw coordinates, key material, raw digests or audit JSON are selected.
const CANDIDATES=`SELECT e.id, e.session_id, e.capture_id, e.event_type, e.source_mode,
 e.received_at, e.effective_event_at, e.device_captured_at, e.punctuality, e.checkout_condition,
 e.review_required, e.review_reasons, e.time_basis,
 s.shift_assignment_id, s.work_date, s.state AS session_state,
 st.code AS shift_code, COALESCE(sa.start_time,st.start_time) AS shift_start,
 COALESCE(sa.end_time,st.end_time) AS shift_end,
 assigned.code AS assigned_site, actual.code AS actual_site,
 (sa.security_site_id=s.expected_site_id AND sa.employee_id=s.employee_id AND sa.shift_type_id=s.expected_shift_type_id) AS assignment_unchanged,
 (e.location_evidence->>'expectedSiteId'=s.expected_site_id::text) AS expected_site_matches,
 (e.location_evidence->>'actualSiteId'=s.expected_site_id::text) AS same_site,
 e.location_evidence->>'workSiteContext' AS context,
 e.location_evidence->>'geofenceClassification' AS geofence,
 e.location_evidence#>>'{location,capturedAt}' AS gps_captured_at,
 ((e.location_evidence#>>'{location,latitude}')::numeric BETWEEN -90 AND 90 AND (e.location_evidence#>>'{location,longitude}')::numeric BETWEEN -180 AND 180) AS gps_present,
 e.location_evidence#>>'{location,accuracyMeters}' AS accuracy,
 e.verification_snapshot->>'binding' AS device_binding,
 (e.verification_snapshot->>'deviceEnrollmentId'=e.device_enrollment_id::text AND d.employee_id=s.employee_id) AS device_matches,
 (e.verification_snapshot->>'mode'='ACCOUNT_DEVICE_GPS_GEOFENCE_V1') AS simple_mode,
 d.status AS current_device_status,
 (e.time_policy_snapshot IS NOT NULL) AS policy_snapshot_present
 FROM attendance_events e JOIN attendance_sessions s ON s.id=e.session_id
 JOIN shift_assignments sa ON sa.id=s.shift_assignment_id JOIN shift_types st ON st.id=s.expected_shift_type_id
 JOIN security_sites assigned ON assigned.id=s.expected_site_id
 LEFT JOIN security_sites actual ON actual.id::text=e.location_evidence->>'actualSiteId'
 LEFT JOIN attendance_device_enrollments d ON d.id=e.device_enrollment_id
 WHERE e.event_type::text=$1 AND ((e.received_at BETWEEN $2::timestamp AND $3::timestamp) OR (e.effective_event_at BETWEEN $2::timestamp AND $3::timestamp))
 AND ($4::uuid IS NULL OR e.capture_id=$4::uuid)
 AND ($5::uuid IS NULL OR EXISTS(SELECT 1 FROM users u WHERE u.id=$5::uuid AND u.employee_id=s.employee_id))
 ORDER BY e.received_at,e.id LIMIT 21`;
const ORDER=`SELECT event_type,effective_event_at,received_at FROM attendance_events WHERE session_id=$1::uuid ORDER BY effective_event_at,received_at,id LIMIT 3`;
const COUNTS=`SELECT (SELECT count(*)::int FROM attendance_events WHERE capture_id=$1::uuid) AS capture_count,
 (SELECT count(*)::int FROM attendance_events WHERE session_id=$2::uuid AND event_type::text=$3) AS type_count`;
const AUDIT=`SELECT count(*)::int AS audit_count,
 COALESCE(bool_and(action::text='CREATE' AND metadata->>'event'='ATTENDANCE_SIMPLE_ACCEPTED'
 AND metadata->>'captureId'=$2 AND metadata->>'eventType'=$3 AND metadata->>'workSiteContext'=$4
 AND metadata->>'deviceBinding'=$5 AND metadata->>'shiftAssignmentId'=$6
 AND metadata->>'assignedSiteCode'=$7 AND metadata->>'actualSiteCode'=$8
 AND metadata->>'punctuality' IS NOT DISTINCT FROM $9 AND metadata->>'checkoutCondition' IS NOT DISTINCT FROM $10
 AND metadata->>'reviewRequired'=$13 AND metadata->'reviewReasons'=$14::jsonb
 AND COALESCE(metadata->>'gpsEvidenceDigest','') ~ '^[0-9a-f]{64}$'),false) AS correlated
 FROM audit_logs WHERE entity_type='AttendanceEvent' AND entity_id=$1 AND created_at BETWEEN $11::timestamp AND $12::timestamp`;
const KNOWN_FLAGS=new Set(['ASSIST_OTHER_SITE','LOCATION_RISK','DEVICE_MISMATCH','DEVICE_MOVE_PENDING','DEVICE_SECURE_CONTEXT_RISK','DEVICE_WEBCRYPTO_RISK','DEVICE_STORAGE_RISK','DEVICE_KEY_EXPORTABILITY_RISK','DEVICE_AUTOMATION_RISK','SITE_AUTHORITY_CHANGED','OFFLINE_LOCATION_TIME_MISMATCH']);
function flags(value){if(value==null)return[];if(!Array.isArray(value)||value.length>32)fail('REVIEW_FLAGS_INVALID');return value.map(x=>KNOWN_FLAGS.has(x)?x:'OTHER_REVIEW_FLAG');}
function code(value){return typeof value==='string'&&/^[A-Za-z0-9._-]{1,50}$/.test(value)?value:'REDACTED_CODE';}
function safeEnum(value,allowed){return value==null?null:allowed.includes(value)?value:'UNKNOWN';}
function clock(value){return typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)?value:'REDACTED_CLOCK';}
function iso(value){if(value==null)return null;const d=new Date(value);if(!Number.isFinite(d.getTime()))fail('EVENT_TIME_INVALID');return d.toISOString();}
function summarize(row,counts,events,audit,input){
  const review=flags(row.review_reasons),binding=row.device_binding;
  const validContext=['ASSIGNED_SITE','SUPPORT_SITE'].includes(row.context)&&row.same_site===(row.context==='ASSIGNED_SITE');
  const accuracy=Number(row.accuracy);
  const gps=row.gps_present&&row.accuracy!=null&&Number.isFinite(accuracy)&&accuracy>=0&&accuracy<=50&&['CONFIDENT_INSIDE','BORDERLINE'].includes(row.geofence)&&!!row.gps_captured_at&&Number.isFinite(Date.parse(row.gps_captured_at));
  const device=['PRIMARY','FOREIGN'].includes(binding)&&row.device_matches&&row.simple_mode&&(binding!=='FOREIGN'||(row.review_required&&review.includes('DEVICE_MISMATCH')));
  const types=events.map(x=>x.event_type);const order=events.length>=1&&events.length<=2&&types[0]==='CHECK_IN'&&(events.length===1||types[1]==='CHECK_OUT')&&events.every((e,i)=>!i||new Date(e.effective_event_at)>=new Date(events[i-1].effective_event_at));
  const stateOk=row.session_state===(events.length===2?'CLOSED':'OPEN');
  const duplicate=counts.capture_count===1&&counts.type_count===1;
  const auditOk=audit.audit_count===1&&audit.correlated===true;
  const timeOk=row.event_type==='CHECK_IN'?['ON_TIME','LATE'].includes(row.punctuality):['NORMAL','EARLY_LEAVE'].includes(row.checkout_condition);
  const flagsOk=row.review_required===(review.length>0)&&(row.context!=='SUPPORT_SITE'||review.includes('ASSIST_OTHER_SITE'))&&(row.geofence!=='BORDERLINE'||review.includes('LOCATION_RISK'));
  const pass=row.event_type===input.type&&['ONLINE','OFFLINE'].includes(row.source_mode)&&!!row.assigned_site&&!!row.actual_site&&duplicate&&auditOk&&order&&stateOk&&gps&&device&&validContext&&flagsOk&&row.assignment_unchanged&&row.expected_site_matches&&row.policy_snapshot_present&&timeOk&&(!input.context||input.context===row.context);
  return{STATUS:pass?'PASS':'PARTIAL',MODE:'READ_ONLY_PHYSICAL_EVENT_EVIDENCE',APPLICATION_SHA:EXPECTED.sha,
    EVENT_ID:row.id,EVENT_TYPE:row.event_type,EFFECTIVE_TIME:iso(row.effective_event_at),RECEIVED_TIME:iso(row.received_at),CAPTURED_TIME:iso(row.device_captured_at),SOURCE_MODE:safeEnum(row.source_mode,['ONLINE','OFFLINE']),TIME_BASIS:safeEnum(row.time_basis,['SERVER_RECEIVED']),
    SCHEDULE_ID:row.shift_assignment_id,WORK_DATE:iso(row.work_date)?.slice(0,10),SHIFT:code(row.shift_code),SHIFT_START:clock(row.shift_start),SHIFT_END:clock(row.shift_end),
    ASSIGNED_SITE:code(row.assigned_site),ACTUAL_SITE:code(row.actual_site),WORK_SITE_CONTEXT:safeEnum(row.context,['ASSIGNED_SITE','SUPPORT_SITE']),ASSIGNMENT_UNCHANGED:row.assignment_unchanged,
    PUNCTUALITY:safeEnum(row.punctuality,['ON_TIME','LATE']),CHECKOUT_CONDITION:safeEnum(row.checkout_condition,['NORMAL','EARLY_LEAVE']),SESSION_STATE:row.session_state,SESSION_STATE_MATCH:stateOk,SERVER_NEXT_ACTION:events.length===2?'NONE_THIS_SHIFT':'CHECK_OUT',
    DEVICE_BINDING:safeEnum(binding,['PRIMARY','FOREIGN']),DEVICE_EVIDENCE_MATCH:!!device,CURRENT_DEVICE_STATUS:row.current_device_status,REVIEW_REQUIRED:row.review_required,REVIEW_FLAGS:review,REVIEW_FLAGS_MATCH:flagsOk,
    GEOFENCE:safeEnum(row.geofence,['CONFIDENT_INSIDE','BORDERLINE','CONFIDENT_OUTSIDE']),GPS_EVIDENCE:!!gps,GPS_COORDINATES_EXPOSED:false,
    AUDIT_COUNT:audit.audit_count,AUDIT_CORRELATED:auditOk,ORDERING:order?'PASS':'FAIL',SESSION_EVENT_TYPES:types,
    DUPLICATE_COUNT:counts.capture_count,SESSION_TYPE_COUNT:counts.type_count,POLICY_SNAPSHOT_PRESENT:row.policy_snapshot_present,
    DATABASE_MUTATION_PERFORMED:false,PHYSICAL_PRESENCE:'OWNER_REPORTED_NOT_INDEPENDENTLY_ATTESTED',RELOAD:'OWNER_SCREEN_EVIDENCE_REQUIRED'};
}
async function verify(prisma,input){return prisma.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
  await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5000ms'");
  const state=await tx.$queryRawUnsafe("SELECT current_setting('transaction_read_only') AS readonly");if(state[0]?.readonly!=='on')fail('READONLY_NOT_ENFORCED');
  const rows=await tx.$queryRawUnsafe(CANDIDATES,input.type,input.from,input.to,input.capture,input.subject);
  if(rows.length!==1)fail(rows.length===0?'EVENT_NOT_FOUND':rows.length>20?'EVENT_WINDOW_OVERFLOW':'EVENT_AMBIGUOUS');
  const row=rows[0];
  flags(row.review_reasons);
  const [counts]=await tx.$queryRawUnsafe(COUNTS,row.capture_id,row.session_id,row.event_type);
  const events=await tx.$queryRawUnsafe(ORDER,row.session_id);
  const [audit]=await tx.$queryRawUnsafe(AUDIT,row.id,row.capture_id,row.event_type,row.context,row.device_binding,row.shift_assignment_id,row.assigned_site,row.actual_site,row.punctuality,row.checkout_condition,new Date(new Date(row.received_at).getTime()-60000),new Date(new Date(row.received_at).getTime()+60000),String(row.review_required),JSON.stringify(row.review_reasons||[]));
  return summarize(row,counts,events,audit,input);
},{maxWait:5000,timeout:20000});}
async function guard(env,fetchImpl=fetch){
  if(env.VERCEL_ENV!=='production'||env.VERCEL_PROJECT_ID!==EXPECTED.project||env.VERCEL_ORG_ID!==EXPECTED.team)fail('PRODUCTION_IDENTITY_INVALID');
  const {verifyDeploymentTarget}=require('./verify-deployment-target');if(verifyDeploymentTarget({env,log:()=>{},error:()=>{}})!==0)fail('DATABASE_TARGET_INVALID');
  const {inspectVercelDeployment}=require('./vercel-api-deployment');
  await inspectVercelDeployment({deploymentId:EXPECTED.deployment,teamId:EXPECTED.team,token:env.VERCEL_TOKEN,expectedProjectId:EXPECTED.project,expectedCommitSha:EXPECTED.sha,expectedCommitRef:EXPECTED.ref,expectedTarget:'production',requireReady:true,fetchImpl});
  const r=await fetchImpl(`https://api.vercel.com/v4/aliases/${EXPECTED.alias}?teamId=${EXPECTED.team}`,{headers:{Authorization:`Bearer ${env.VERCEL_TOKEN}`},signal:AbortSignal.timeout(30000)});
  if(!r.ok||(await r.json()).deployment?.id!==EXPECTED.deployment)fail('CANONICAL_CHANGED');
}
async function main(env=process.env){let prisma;try{
  const input=inputs(env);await guard(env);
  const {PrismaClient}=require('@prisma/client');prisma=new PrismaClient({log:[],errorFormat:'minimal',datasources:{db:{url:env.DIRECT_URL}}});
  const result=await verify(prisma,input);console.log(JSON.stringify(result,null,2));if(result.STATUS!=='PASS')process.exitCode=1;
}catch(e){console.error(JSON.stringify({STATUS:'FAIL_CLOSED',REASON:e.safeCode||'GUARD_OR_QUERY_FAILED',DATABASE_MUTATION_PERFORMED:false}));process.exitCode=1;}finally{if(prisma)await prisma.$disconnect().catch(()=>{});}}
if(require.main===module)main();
module.exports={EXPECTED,inputs,summarize,verify,guard,CANDIDATES,COUNTS,ORDER,AUDIT};
