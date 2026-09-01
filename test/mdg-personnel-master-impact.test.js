'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const service=require('../src/services/personnel-master.service');

test('department deactivation impact counts normalized employee references',async()=>{
 const client={departmentMaster:{findUnique:async()=>({id:'d1',name:'Security Ops',normalizedName:'security ops',isActive:true})},employee:{findMany:async()=>[{id:'e1',department:' Security Ops '},{id:'e2',department:'Other'}]}};
 const result=await service.impact({kind:'department',id:'d1',prismaClient:client});
 assert.equal(result.employeeReferences,1);assert.equal(result.totalReferences,1);
});

test('position deactivation impact includes Approval Authority aliases and fails closed on invalid policy data',async()=>{
 const base={positionMaster:{findUnique:async()=>({id:'p1',name:'Supervisor Special',normalizedName:'supervisor special',isActive:true})},employee:{findMany:async()=>[{id:'e1',jobTitle:'Supervisor Special'}]}};
 const ok={...base,systemSetting:{findMany:async()=>[{key:'APPROVAL_POLICY.LEAVE_REQUEST.ADDITIONAL_SUPERVISOR_ALIASES',value:'[\"supervisor special\"]'},{key:'APPROVAL_POLICY.LEAVE_REQUEST.ADDITIONAL_MANAGER_ALIASES',value:'[]'}]}};
 const result=await service.impact({kind:'position',id:'p1',prismaClient:ok});assert.equal(result.employeeReferences,1);assert.equal(result.approvalAuthorityReferences,1);assert.equal(result.totalReferences,2);
 const bad={...base,systemSetting:{findMany:async()=>[]}};await assert.rejects(()=>service.impact({kind:'position',id:'p1',prismaClient:bad}),(error)=>error.details?.code==='PERSONNEL_MASTER_IMPACT_UNAVAILABLE');
});

test('master deactivation requires impact acknowledgement and reason at service boundary',async()=>{
 const row={id:'d1',name:'Security',normalizedName:'security',isActive:true,sortOrder:0};
 const tx={departmentMaster:{findUnique:async()=>row,update:async()=>({...row,isActive:false})},employee:{findMany:async()=>[]}};
 const client={...tx,$transaction:async(fn)=>fn(tx)};
 await assert.rejects(()=>service.update({kind:'department',id:'d1',input:{isActive:false},actorUserId:'a1',prismaClient:client,auditService:{log:async()=>{}}}),(error)=>error.details?.code==='PERSONNEL_MASTER_DEACTIVATION_CONFIRM_REQUIRED');
 const updated=await service.update({kind:'department',id:'d1',input:{isActive:false,confirmImpact:true,reason:'เลิกใช้งานโครงสร้างเดิม'},actorUserId:'a1',prismaClient:client,auditService:{log:async()=>{}}});assert.equal(updated.isActive,false);
});
