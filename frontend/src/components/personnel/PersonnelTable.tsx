import { DataRowActionMenu } from '../DataRowActionMenu';
import type { PersonnelRecord, PersonnelRole } from './types';

type Props = {
  rows: PersonnelRecord[];
  canManage: boolean;
  role: PersonnelRole;
  selectedId?: string;
  onSelect(employee: PersonnelRecord): void;
  onEdit(employee: PersonnelRecord): void;
  onLifecycle(employee: PersonnelRecord): void;
};

export function PersonnelTable({ rows, canManage, role, selectedId, onSelect, onEdit, onLifecycle }: Props) {
  return <div className="personnel-table-card data-surface-card"><div className="personnel-table-scroll data-table-scroll"><table className="personnel-table data-surface-table"><thead><tr><th scope="col">พนักงาน</th><th scope="col">รหัสภายใน</th><th scope="col">หน่วยงาน</th><th scope="col">ตำแหน่ง</th><th scope="col">สถานะ</th>{canManage && <th scope="col">จัดการ</th>}</tr></thead><tbody>{rows.length ? rows.map((employee) => <tr key={employee.id} data-personnel-id={employee.id} className={selectedId === employee.id ? 'is-selected' : ''} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(employee); } }}><td><button type="button" className="personnel-name-button" onClick={() => onSelect(employee)}>{employee.firstName} {employee.lastName}</button></td><td><code>{employee.employeeCode}</code></td><td>{employee.department || '—'}</td><td>{employee.jobTitle || '—'}</td><td><span className={`status-badge ${employee.isActive ? 'active status-badge--success' : 'inactive status-badge--neutral'}`}>{employee.isActive ? 'ใช้งาน' : 'ไม่ใช้งาน'}</span></td>{canManage && <td className="personnel-row-actions data-row-actions"><button type="button" className="data-row-primary-action" aria-label={`แก้ไขข้อมูล ${employee.firstName} ${employee.lastName}`} onClick={() => onEdit(employee)}>แก้ไขข้อมูล</button>{role === 'ADMIN' && <DataRowActionMenu label={`การทำงานเพิ่มเติมสำหรับ ${employee.firstName} ${employee.lastName}`} actions={[{ label: 'จัดการสถานะพนักงาน', onSelect: () => onLifecycle(employee) }]} />}</td>}</tr>) : <tr><td colSpan={canManage ? 6 : 5} className="personnel-no-rows data-table-empty-cell">ไม่พบข้อมูลบุคลากรตามเงื่อนไขที่เลือก</td></tr>}</tbody></table></div></div>;
}
