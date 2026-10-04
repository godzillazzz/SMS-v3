'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {inputs,verify,CANDIDATES,COUNTS,ORDER,AUDIT}=require('../../scripts/ci/g06-physical-event-readonly');
const target=new URL(process.env.DATABASE_URL||'postgresql://invalid/invalid');
const enabled=process.env.RUN_INTEGRATION_TESTS==='true'&&target.hostname==='127.0.0.1'&&target.port==='55438'&&target.pathname==='/sms_v3_test';
test('physical verifier SQL and PostgreSQL read-only enforcement in disposable CI database',{skip:!enabled},async()=>{
 const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();const id='22222222-2222-4222-8222-222222222222',at=new Date();
 try {
  await assert.rejects(verify(p,inputs({REPORTED_AT:at.toISOString(),EVENT_TYPE:'CHECK_IN',CAPTURE_ID:id})),/EVENT_NOT_FOUND/);
  await p.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
   assert.deepEqual(await tx.$queryRawUnsafe(CANDIDATES,'CHECK_IN',at,at,id,null),[]);
   assert.equal((await tx.$queryRawUnsafe(COUNTS,id,id,'CHECK_IN'))[0].capture_count,0);
   assert.deepEqual(await tx.$queryRawUnsafe(ORDER,id),[]);
   assert.equal((await tx.$queryRawUnsafe(AUDIT,id,id,'CHECK_IN','ASSIGNED_SITE','PRIMARY',id,'A','A','LATE',null,at,at))[0].audit_count,0);
  });
  await assert.rejects(p.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
   await tx.$executeRawUnsafe("INSERT INTO audit_logs (id,action,entity_type,entity_id,created_at) VALUES (gen_random_uuid(),'CREATE','ReadOnlyTest','disposable-test',now())");
  }),e=>e.meta?.code==='25006');
 }finally{await p.$disconnect();}
});
