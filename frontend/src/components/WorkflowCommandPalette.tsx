import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SmsIcon, type SmsIconName } from './SmsIcon';

type CommandItem={id:string;label:string;group:string;icon:SmsIconName};
export function WorkflowCommandPalette({open,items,onClose,onNavigate}:{open:boolean;items:CommandItem[];onClose():void;onNavigate(id:string):void}){
 const [query,setQuery]=useState(''); const inputRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(open){setQuery('');window.setTimeout(()=>inputRef.current?.focus(),0)}},[open]);
 useEffect(()=>{if(!open)return;const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[open,onClose]);
 const results=useMemo(()=>{const q=query.trim().toLocaleLowerCase('th-TH');return q?items.filter(x=>`${x.label} ${x.group}`.toLocaleLowerCase('th-TH').includes(q)):items},[items,query]);
 if(!open)return null;
 return createPortal(<div className="workflow-command-layer" role="presentation" onMouseDown={(e)=>{if(e.target===e.currentTarget)onClose()}}><section className="workflow-command" role="dialog" aria-modal="true" aria-label="ไปยังงานหรือหน้าที่ต้องการ"><header><SmsIcon name="search" size={18}/><input ref={inputRef} value={query} onChange={e=>setQuery(e.target.value)} placeholder="ค้นหางานหรือหน้าที่ต้องการ..." aria-label="ค้นหาเมนูงาน"/><kbd>ESC</kbd></header><div className="workflow-command__meta"><span>QUICK NAVIGATION</span><small>{results.length} รายการ</small></div><div className="workflow-command__results">{results.map(item=><button type="button" key={item.id} onClick={()=>{onNavigate(item.id);onClose()}}><span className="workflow-command__icon"><SmsIcon name={item.icon} size={18}/></span><span><strong>{item.label}</strong><small>{item.group}</small></span><kbd>↵</kbd></button>)}{!results.length&&<div className="workflow-command__empty"><strong>ไม่พบเมนูที่ตรงกัน</strong><span>ลองค้นหาด้วยชื่อเมนูหรือกลุ่มงาน</span></div>}</div><footer><span><kbd>Ctrl</kbd> + <kbd>K</kbd> เปิดเมนูด่วนได้จากทุกหน้า</span><span>สิทธิ์การเข้าถึงยังคงเป็นไปตาม Role ปัจจุบัน</span></footer></section></div>,document.body)
}
