import { useEffect, useState } from 'react';
import { notificationCenterClient, type NotificationCenterData } from './notification-center-client';

export function NotificationCenterPanel({token}:{token:string}){
 const [data,setData]=useState<NotificationCenterData>(); const [busy,setBusy]=useState(''); const [notice,setNotice]=useState('');
 const load=async()=>{ try{setData(await notificationCenterClient.get(token));}catch(e){setNotice(e instanceof Error?e.message:'โหลด Notification Center ไม่สำเร็จ');} };
 useEffect(()=>{void load();},[token]);
 const toggle=async(eventType:string,enabled:boolean)=>{setBusy(eventType);setNotice('');try{await notificationCenterClient.setEmail(token,eventType,enabled);await load();setNotice('บันทึกการตั้งค่า Email แล้ว');}catch(e){setNotice(e instanceof Error?e.message:'บันทึกไม่สำเร็จ');}finally{setBusy('');}};
 const test=async()=>{setBusy('TEST');setNotice('');try{await notificationCenterClient.testEmail(token);setNotice('ส่ง Test Email ไปยังบัญชี Admin ปัจจุบันแล้ว');}catch(e){setNotice(e instanceof Error?e.message:'Test Email ไม่สำเร็จ');}finally{setBusy('');}};
 return <section className="notification-center-card"><div className="notification-center-head"><div><p className="eyebrow">CFG-10 · GOVERNED NOTIFICATIONS</p><h2>Notification Center</h2><p>เลือกได้ว่าเหตุการณ์ใดจะส่ง Email โดย credential ยังคงอยู่ใน Environment Variables เท่านั้น</p></div><button className="btn-neutral small-action" disabled={busy==='TEST'||!data?.providers.email.configured} onClick={()=>void test()}>ทดสอบ Email</button></div>
 <div className="notification-provider-status"><span>Email: {data?.providers.email.enabled&&data?.providers.email.configured?'READY':'NOT READY'}</span><span>LINE: {data?.providers.line.status||'NOT ENABLED'}</span><span>Secrets: ENVIRONMENT ONLY</span></div>
 <div className="notification-event-table"><div className="notification-event-row notification-event-header"><strong>Event</strong><strong>Recipient</strong><strong>Email</strong></div>{data?.events.map(item=><div className="notification-event-row" key={item.eventType}><div><strong>{item.label}</strong><small>{item.eventType}</small></div><span>{item.recipientPolicy}</span><label className="notification-toggle"><input type="checkbox" checked={item.emailEnabled} disabled={busy===item.eventType||item.mandatory} onChange={e=>void toggle(item.eventType,e.target.checked)}/><span>{item.emailEnabled?'เปิด':'ปิด'}</span></label></div>)}</div>
 {notice&&<div className="settings-notice">{notice}</div>}</section>;
}
