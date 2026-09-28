import { SmsIcon, type SmsIconName } from '../SmsIcon';
import type { DashboardNavigate, DashboardPage } from './types';

type FlowStep={page:DashboardPage;icon:SmsIconName;eyebrow:string;title:string;detail:string;count?:number};
export function WorkQueueJourney({canManage,pendingApprovalCount=0,onOpenApprovalCenter,onNavigate}:{canManage:boolean;pendingApprovalCount?:number;onOpenApprovalCenter?():void;onNavigate:DashboardNavigate}){
 const steps:FlowStep[]=[
  {page:'schedule',icon:'calendar',eyebrow:'01 · PLAN',title:'ตรวจตารางเวร',detail:'เริ่มจากกำลังคนและตารางปฏิบัติงาน'},
  {page:'employees',icon:'employees',eyebrow:'02 · VERIFY',title:'ตรวจความพร้อมบุคลากร',detail:'ข้อมูลพนักงานและความพร้อมก่อนปฏิบัติงาน'},
  ...(canManage?[{page:'leavePending' as DashboardPage,icon:'approval' as SmsIconName,eyebrow:'03 · DECIDE',title:'จัดการงานรออนุมัติ',detail:'รวมรายการที่ต้องตัดสินใจและติดตาม',count:pendingApprovalCount}]:[]),
 ];
 return <section className="workflow-journey" aria-label="เส้นทางงานที่แนะนำ"><header><div><p className="nexus-kicker">TODAY / RECOMMENDED FLOW</p><h2>ทำงานต่อจากตรงนี้</h2><span>เรียงงานตามบริบทปฏิบัติการ ลดการย้อนหาเมนู</span></div>{canManage&&pendingApprovalCount>0&&<button type="button" className="workflow-journey__priority" onClick={onOpenApprovalCenter}><SmsIcon name="bell" size={16}/><b>{pendingApprovalCount}</b> รายการต้องตรวจ</button>}</header><div className="workflow-journey__steps">{steps.map((step,index)=><button type="button" key={step.page} onClick={()=>onNavigate(step.page)}><span className="workflow-journey__index">{String(index+1).padStart(2,'0')}</span><span className="workflow-journey__icon"><SmsIcon name={step.icon} size={19}/></span><span className="workflow-journey__copy"><small>{step.eyebrow}</small><strong>{step.title}</strong><em>{step.detail}</em></span>{step.count? <b className="workflow-journey__count">{step.count>99?'99+':step.count}</b>:<span className="workflow-journey__arrow" aria-hidden="true">→</span>}</button>)}</div></section>
}
