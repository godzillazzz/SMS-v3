// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { PageHeader, SectionCard, StepFlow, MetricCard } from './components/layout';
afterEach(cleanup);
describe('T30a shared layout foundation', () => {
  it('renders semantic Thai headings, descriptions, actions and card content', () => {
    render(<><PageHeader kicker="ข้อมูลปฏิบัติการ" title="รายการของหน่วยงาน" description="ตรวจข้อมูลก่อนทำงาน" actions={<button>เปิดรายการ</button>} /><SectionCard kicker="ข้อมูลที่ตรวจสอบแล้ว" title="รายการสำคัญ" description="ข้อมูลตามสิทธิ์"><p>เนื้อหารายการ</p></SectionCard><MetricCard label="รายการรออนุมัติ" value={12} description="รายการตามสิทธิ์" icon="approval" /></>);
    expect(screen.getByRole('heading', { level:1 }).textContent).toBe('รายการของหน่วยงาน');
    expect(screen.getByRole('region', { name:'รายการสำคัญ' }).textContent).toContain('เนื้อหารายการ');
    expect(screen.getByRole('button', { name:'เปิดรายการ' })).toBeTruthy();
    expect(screen.getByRole('region', { name:'รายการรออนุมัติ' }).textContent).toContain('12');
  });
  it('uses accessible existing SVG icons and callbacks without inventing navigation or data actions', () => {
    const click=vi.fn();
    const {container}=render(<StepFlow description="เลือกงานที่พร้อม" steps={[{id:'one',icon:'calendar',label:'ขั้นที่หนึ่ง',title:'เลือกเดือน',desc:'เดือนที่ต้องการ',onClick:click,current:true},{id:'two',icon:'check',label:'ขั้นที่สอง',title:'ตรวจรายการ',desc:'รายการครบแล้ว',completed:true}]} />);
    fireEvent.click(screen.getByRole('button', {name:/เลือกเดือน/}));
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', {name:/ตรวจรายการ/}).getAttribute('disabled')).toBe('');
    expect(container.querySelector('[aria-current="step"]')).toBeTruthy();
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);
    expect(container.textContent).toContain('เสร็จแล้ว');
  });
  it('keeps shared component headings/labels free of emoji and uses approved layout tokens', () => {
    const dir=path.resolve(__dirname,'components/layout');
    for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.tsx'))) expect(fs.readFileSync(path.join(dir,f),'utf8')).not.toMatch(/\p{Extended_Pictographic}/u);
    const css=fs.readFileSync(path.resolve(__dirname,'styles/layout-foundation.css'),'utf8');
    for(const token of ['--layout-card-radius:16px','--layout-nested-radius:10px','--layout-card-padding:24px','--layout-card-padding:16px','--layout-gap:16px','"Kanit"','"Noto Sans Thai"']) expect(css).toContain(token);
    expect(css).toContain('background:transparent');
  });
});
