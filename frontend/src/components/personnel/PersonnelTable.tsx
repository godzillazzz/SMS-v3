import { TableActionCell, TableActionHeader } from '../TableActionColumn';
import type { PersonnelRecord } from './types';

type Props = {
  rows: PersonnelRecord[];
  canManage: boolean;
  selectedId?: string;
  onSelect(employee: PersonnelRecord): void;
  onEdit(employee: PersonnelRecord): void;
};

export function PersonnelTable({ rows, canManage, selectedId, onSelect, onEdit }: Props) {
  return <div className="personnel-table-card data-surface-card">
    <div className="personnel-table-scroll data-table-scroll">
      <table className="personnel-table data-surface-table">
        <thead><tr><th scope="col">พนักงาน</th><th scope="col">รหัสภายใน</th><th scope="col">หน่วยงาน</th><th scope="col">ตำแหน่ง</th><th scope="col">สถานะ</th>{canManage && <TableActionHeader label="จัดการ" />}</tr></thead>
        <tbody>{rows.length ? rows.map((employee) => <tr
          key={employee.id}
          data-personnel-id={employee.id}
          className={selectedId === employee.id ? 'is-selected personnel-record-row' : 'personnel-record-row'}
          tabIndex={0}
          aria-label={`เปิดรายละเอียด ${employee.firstName} ${employee.lastName}`}
          onClick={() => onSelect(employee)}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(employee); } }}
        >
          <td><button type="button" className="personnel-name-button" onClick={(event) => { event.stopPropagation(); onSelect(employee); }}>{employee.firstName} {employee.lastName}</button></td>
          <td><code>{employee.employeeCode}</code></td>
          <td>{employee.department || '—'}</td>
          <td>{employee.jobTitle || '—'}</td>
          <td><span className={`status-badge ${employee.isActive ? 'active status-badge--success' : 'inactive status-badge--neutral'}`}>{employee.isActive ? 'ใช้งาน' : 'ไม่ใช้งาน'}</span></td>
          {canManage && <TableActionCell className="personnel-row-actions data-row-actions" onClick={(event) => event.stopPropagation()}><button type="button" className="data-row-primary-action" aria-label={`แก้ไขข้อมูล ${employee.firstName} ${employee.lastName}`} onClick={() => onEdit(employee)}>แก้ไขข้อมูล</button></TableActionCell>}
        </tr>) : <tr><td colSpan={canManage ? 6 : 5} className="personnel-no-rows data-table-empty-cell">ไม่พบข้อมูลบุคลากรตามเงื่อนไขที่เลือก</td></tr>}</tbody>
      </table>
    </div>
    <div className="personnel-mobile-records" aria-label="รายการพนักงานสำหรับอุปกรณ์เคลื่อนที่">
      {rows.map((employee) => <button type="button" key={`mobile-${employee.id}`} className="personnel-mobile-record" data-personnel-id={employee.id} onClick={() => onSelect(employee)}>
        <span className="personnel-mobile-record__top"><strong>{employee.firstName} {employee.lastName}</strong><span className={`status-badge ${employee.isActive ? 'active status-badge--success' : 'inactive status-badge--neutral'}`}>{employee.isActive ? 'ใช้งาน' : 'ไม่ใช้งาน'}</span></span>
        <span className="personnel-mobile-record__meta"><small>รหัสภายใน</small><b>{employee.employeeCode}</b></span>
        <span className="personnel-mobile-record__meta"><small>หน่วยงาน</small><b>{employee.department || 'ไม่ระบุ'}</b></span>
        <span className="personnel-mobile-record__meta personnel-mobile-record__wide"><small>ตำแหน่ง</small><b>{employee.jobTitle || 'ไม่ระบุ'}</b></span>
        <em>แตะเพื่อเปิดรายละเอียด</em>
      </button>)}
    </div>
  </div>;
}
