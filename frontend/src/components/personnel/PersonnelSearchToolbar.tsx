import { Button, Field, Icon, SelectInput, TextInput } from '../ui/primitives';

type Props = { search: string; department: string; status: string; departments: string[]; onSearch(value: string): void; onDepartment(value: string): void; onStatus(value: string): void; onClear(): void };
export function PersonnelSearchToolbar({ search, department, status, departments, onSearch, onDepartment, onStatus, onClear }: Props) {
  const active = Boolean(search || department || status);
  return <section className="personnel-search-panel" aria-label="ค้นหาและกรองบุคลากร">
    <div className="personnel-search-row">
      <label className="personnel-search-input"><Icon>⌕</Icon><TextInput aria-label="ค้นหาบุคลากร" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="ค้นหารหัส ชื่อ หน่วยงาน หรือตำแหน่ง" /></label>
      <Field label="กรองหน่วยงาน" htmlFor="personnel-department-filter" labelClassName="ui-visually-hidden" className="personnel-search-filter">
        <SelectInput id="personnel-department-filter" aria-label="กรองหน่วยงาน" value={department} onChange={(event) => onDepartment(event.target.value)}><option value="">ทุกหน่วยงาน</option>{departments.map((item) => <option key={item} value={item}>{item}</option>)}</SelectInput>
      </Field>
      <Field label="กรองสถานะ" htmlFor="personnel-status-filter" labelClassName="ui-visually-hidden" className="personnel-search-filter">
        <SelectInput id="personnel-status-filter" aria-label="กรองสถานะ" value={status} onChange={(event) => onStatus(event.target.value)}><option value="">ทุกสถานะ</option><option value="active">ใช้งาน</option><option value="inactive">ไม่ใช้งาน</option></SelectInput>
      </Field>
      {active && <Button type="button" variant="neutral" size="small" onClick={onClear}>ล้างตัวกรอง</Button>}
    </div>
    {active && <div className="personnel-filter-chips" aria-label="ตัวกรองที่ใช้งาน">
      {search && <Button type="button" size="compact" onClick={() => onSearch('')}>ค้นหา: {search} ×</Button>}
      {department && <Button type="button" size="compact" onClick={() => onDepartment('')}>หน่วยงาน: {department} ×</Button>}
      {status && <Button type="button" size="compact" onClick={() => onStatus('')}>สถานะ: {status === 'active' ? 'ใช้งาน' : 'ไม่ใช้งาน'} ×</Button>}
    </div>}
  </section>;
}
