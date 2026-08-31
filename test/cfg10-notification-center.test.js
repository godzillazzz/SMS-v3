'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {EVENTS,eventDefinition,emailEventEnabled,listMatrix,updateEmailEvent}=require('../src/services/notification-center.service');

test('CFG-10 governs expected Email events and defaults enabled',async()=>{assert.equal(EVENTS.length,10);const prisma={systemSetting:{findUnique:async()=>null}};assert.equal(await emailEventEnabled(prisma,'LEAVE_APPROVED'),true);});

test('CFG-10 stored false disables one event only',async()=>{const prisma={systemSetting:{findUnique:async({where})=>where.key==='NOTIFY_EMAIL_LEAVE_APPROVED'?{value:'false'}:null}};assert.equal(await emailEventEnabled(prisma,'LEAVE_APPROVED'),false);assert.equal(await emailEventEnabled(prisma,'LEAVE_REJECTED'),true);});

test('CFG-10 matrix exposes provider state without credential values',async()=>{const prisma={systemSetting:{findMany:async()=>[{key:'NOTIFY_EMAIL_LEAVE_REJECTED',value:'false',updatedAt:new Date()}]}};const result=await listMatrix(prisma);assert.equal(result.events.find(x=>x.eventType==='LEAVE_REJECTED').emailEnabled,false);assert.equal(JSON.stringify(result).toLowerCase().includes('password'),false);assert.equal(JSON.stringify(result).toLowerCase().includes('token'),false);});

test('CFG-10 update is transactional and audited',async()=>{let auditPayload;const tx={systemSetting:{findUnique:async()=>({value:'true'}),upsert:async()=>({updatedAt:new Date()})}};const prisma={$transaction:async cb=>cb(tx)};const audit={log:async p=>{auditPayload=p;}};const out=await updateEmailEvent({prisma,audit,actor:{sub:'u1'},eventType:'LEAVE_APPROVED',enabled:false});assert.equal(out.emailEnabled,false);assert.equal(auditPayload.metadata.beforeEnabled,true);assert.equal(auditPayload.metadata.afterEnabled,false);assert.equal(auditPayload.metadata.credentialSource,'ENVIRONMENT_ONLY');});

test('CFG-10 defines an independently governed setting for every matrix event',()=>{for(const event of EVENTS){assert.equal(eventDefinition(event.eventType).emailSettingKey,'NOTIFY_EMAIL_'+event.eventType);}});
