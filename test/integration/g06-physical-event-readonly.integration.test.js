'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {inputs,verify,CANDIDATES,COUNTS,ORDER,AUDIT}=require('../../scripts/ci/g06-physical-event-readonly');
const target=new URL(process.env.DATABASE_URL||'postgresql://invalid/invalid');
const enabled=process.env.RUN_INTEGRATION_TESTS==='true'&&process.env.TEST_DATABASE_RUNNER==='g06-physical-readonly-disposable-ci'&&target.hostname==='127.0.0.1'&&target.port==='55438'&&target.pathname==='/sms_v3_test';
test('physical verifier SQL and PostgreSQL read-only enforcement in disposable CI database',{skip:!enabled},async()=>{
 const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();const id='22222222-2222-4222-8222-222222222222',at=new Date();
 try {
  await assert.rejects(verify(p,inputs({REPORTED_AT:at.toISOString(),EVENT_TYPE:'CHECK_IN',CAPTURE_ID:id})),/EVENT_NOT_FOUND/);
  await p.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
   assert.deepEqual(await tx.$queryRawUnsafe(CANDIDATES,'CHECK_IN',at,at,id,null),[]);
   const {SUBJECT,STATS}=require('../../scripts/ci/g06-failed-attempt-readonly');
   assert.deepEqual(await tx.$queryRawUnsafe(SUBJECT,id,at),[]);
   assert.equal((await tx.$queryRawUnsafe(STATS,id,at,at))[0].event_count,0);
   const expression=CANDIDATES.slice(CANDIDATES.indexOf('(sa.employee_id=s.employee_id'),CANDIDATES.indexOf(' AS assignment_unchanged,'));
   const fixture=async(site,source,snapshotSite)=>tx.$queryRawUnsafe(`WITH sa AS (SELECT $1::uuid AS security_site_id,$4::uuid AS employee_id,$4::uuid AS shift_type_id,$4::uuid AS id),s AS (SELECT $4::uuid AS employee_id,$4::uuid AS expected_shift_type_id,$4::uuid AS expected_site_id,jsonb_build_object('shiftAssignmentId',$4::text,'shiftTypeId',$4::text,'site',jsonb_build_object('id',$3::text,'authoritySource',$2::text,'departmentName','test')) AS expectation_snapshot) SELECT ${expression} AS matched FROM sa,s`,site,source,snapshotSite,id);
   assert.equal((await fixture(null,'DEPARTMENT_DEFAULT',id))[0].matched,true);
   assert.equal((await fixture(id,'SCHEDULE',id))[0].matched,true);
   assert.notEqual((await fixture(null,'SCHEDULE',id))[0].matched,true);
   assert.equal((await fixture(null,'DEPARTMENT_DEFAULT','33333333-3333-4333-8333-333333333333'))[0].matched,false);
   assert.equal((await tx.$queryRawUnsafe(COUNTS,id,id,'CHECK_IN'))[0].capture_count,0);
   assert.deepEqual(await tx.$queryRawUnsafe(ORDER,id),[]);
   assert.equal((await tx.$queryRawUnsafe(AUDIT,id,id,'CHECK_IN','ASSIGNED_SITE','PRIMARY',id,'A','A','LATE',null,at,at,'false','[]'))[0].audit_count,0);
  });
  await assert.rejects(p.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
   await tx.$executeRawUnsafe("INSERT INTO audit_logs (id,action,entity_type,entity_id,created_at) VALUES (gen_random_uuid(),'CREATE','ReadOnlyTest','disposable-test',now())");
  }),e=>e.meta?.code==='25006');
 }finally{await p.$disconnect();}
});
