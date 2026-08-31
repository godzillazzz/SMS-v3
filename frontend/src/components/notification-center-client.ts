import { attendanceAuthenticatedRequest } from '../attendance-auth-request';

export type NotificationEventRow = { eventType:string; label:string; recipientPolicy:string; emailEnabled:boolean; lineEnabled:boolean; mandatory:boolean; updatedAt:string|null };
export type NotificationCenterData = { events:NotificationEventRow[]; providers:{ email:{enabled:boolean;configured:boolean;credentialSource:string}; line:{enabled:boolean;configured:boolean;credentialSource:string;status:string} } };

function csrfToken(){ const encoded=document.cookie.split('; ').find(x=>x.startsWith('smsv3_csrf='))?.split('=')[1]; return encoded?decodeURIComponent(encoded):undefined; }
function headers(token:string,json=false){ const h=new Headers({Authorization:'Bearer '+token}); if(json)h.set('Content-Type','application/json'); const csrf=csrfToken(); if(csrf)h.set('X-CSRF-Token',csrf); return h; }
async function request<T>(path:string,token:string,init:RequestInit={}):Promise<T>{ const r=await attendanceAuthenticatedRequest(path,token,{credentials:'include',...init}); const p=await r.json().catch(()=>({})) as {data?:T;error?:string}; if(!r.ok) throw new Error(p.error||'Notification Center request failed.'); return p.data as T; }
export const notificationCenterClient={
  get:(token:string)=>request<NotificationCenterData>('/notification-center',token,{headers:headers(token)}),
  setEmail:(token:string,eventType:string,enabled:boolean)=>request('/notification-center/events/'+encodeURIComponent(eventType)+'/email',token,{method:'PUT',headers:headers(token,true),body:JSON.stringify({enabled})}),
  testEmail:(token:string)=>request<{sent:boolean;provider:string;recipientScope:string}>('/notification-center/test-email',token,{method:'POST',headers:headers(token,true),body:'{}'})
};
