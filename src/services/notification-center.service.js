'use strict';

const env = require('../config/env');
const HttpError = require('../utils/http-error');

const EVENTS = Object.freeze([
  ['REGISTRATION_NEW','New registration request','REVIEWERS'],
  ['REGISTRATION_APPROVED','Registration approved','APPLICANT'],
  ['REGISTRATION_REJECTED','Registration rejected','APPLICANT'],
  ['LEAVE_CREATED','New leave request','REVIEWERS_AND_EMPLOYEE'],
  ['LEAVE_RESUBMITTED','Leave request resubmitted','REVIEWERS_AND_EMPLOYEE'],
  ['LEAVE_RETURNED_FOR_CORRECTION','Leave returned for correction','EMPLOYEE'],
  ['LEAVE_APPROVED','Leave approved','EMPLOYEE'],
  ['LEAVE_REJECTED','Leave rejected','EMPLOYEE'],
  ['LEAVE_CANCELLED','Leave cancelled','EMPLOYEE'],
  ['SCHEDULE_APPROVED','Schedule approved','AFFECTED_EMPLOYEES']
].map(([eventType,label,recipientPolicy]) => Object.freeze({ eventType,label,recipientPolicy,emailSettingKey:'NOTIFY_EMAIL_'+eventType,mandatory:false })));
const BY_EVENT = new Map(EVENTS.map((item)=>[item.eventType,item]));

function eventDefinition(eventType){ return BY_EVENT.get(String(eventType||'').trim()) || null; }
function parseBoolean(value, fallback=true){ if(value===undefined||value===null||value==='') return fallback; const v=String(value).trim().toLowerCase(); if(v==='true') return true; if(v==='false') return false; return fallback; }
async function emailEventEnabled(prisma,eventType){ const def=eventDefinition(eventType); if(!def) return true; if(!prisma?.systemSetting?.findUnique) return true; const row=await prisma.systemSetting.findUnique({where:{key:def.emailSettingKey},select:{value:true}}).catch(()=>null); return parseBoolean(row?.value,true); }
function providerReadiness(){ return { email:{ enabled: env.emailNotificationsEnabled===true, configured: env.otpDeliveryProvider==='gmail_smtp' && Boolean(env.smtpHost) && Boolean(env.smtpUsername) && Boolean(env.smtpPassword), credentialSource:'ENVIRONMENT_ONLY' }, line:{ enabled:false, configured:false, credentialSource:'ENVIRONMENT_ONLY', status:'NOT_ENABLED' } }; }
async function listMatrix(prisma){ const rows=await prisma.systemSetting.findMany({where:{key:{in:EVENTS.map(e=>e.emailSettingKey)}},select:{key:true,value:true,updatedAt:true}}); const map=new Map(rows.map(r=>[r.key,r])); return { events:EVENTS.map(e=>({ ...e, emailEnabled:parseBoolean(map.get(e.emailSettingKey)?.value,true), updatedAt:map.get(e.emailSettingKey)?.updatedAt||null, lineEnabled:false })), providers:providerReadiness() }; }
async function updateEmailEvent({prisma,audit,actor,eventType,enabled}){ const def=eventDefinition(eventType); if(!def) throw new HttpError(404,'Notification event is not governed.',{code:'NOTIFICATION_EVENT_NOT_FOUND'}); if(def.mandatory && !enabled) throw new HttpError(409,'Mandatory notification event cannot be disabled.',{code:'NOTIFICATION_EVENT_MANDATORY'}); return prisma.$transaction(async tx=>{ const before=await tx.systemSetting.findUnique({where:{key:def.emailSettingKey}}); const after=await tx.systemSetting.upsert({where:{key:def.emailSettingKey},update:{value:String(Boolean(enabled)),description:'CFG-10 governed Email event toggle for '+eventType},create:{key:def.emailSettingKey,value:String(Boolean(enabled)),description:'CFG-10 governed Email event toggle for '+eventType}}); await audit.log({actorUserId:actor.sub,action:before?'UPDATE':'CREATE',entityType:'NotificationEventPolicy',entityId:eventType,metadata:{event:'NOTIFICATION_EMAIL_POLICY_CHANGED',eventType,beforeEnabled:parseBoolean(before?.value,true),afterEnabled:Boolean(enabled),credentialSource:'ENVIRONMENT_ONLY'}},tx); return {eventType,emailEnabled:Boolean(enabled),updatedAt:after.updatedAt}; }); }
module.exports={EVENTS,eventDefinition,emailEventEnabled,providerReadiness,listMatrix,updateEmailEvent};
