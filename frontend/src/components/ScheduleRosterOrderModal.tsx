import { useEffect, useMemo, useState } from 'react';

export type ScheduleRosterEmployee = {
  id: string;
  employeeCode?: string | null;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  department?: string | null;
  jobTitle?: string | null;
};

type Props = {
  department: string;
  employees: ScheduleRosterEmployee[];
  busy?: boolean;
  onClose: () => void;
  onSave: (employeeIds: string[]) => Promise<void> | void;
};

function employeeName(employee: ScheduleRosterEmployee) {
  return employee.displayName || `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || employee.employeeCode || employee.id;
}

export function ScheduleRosterOrderModal({ department, employees, busy = false, onClose, onSave }: Props) {
  const [items, setItems] = useState<ScheduleRosterEmployee[]>(employees);
  const [draggedId, setDraggedId] = useState<string>();

  useEffect(() => setItems(employees), [employees]);
  const changed = useMemo(() => items.map((item) => item.id).join('|') !== employees.map((item) => item.id).join('|'), [employees, items]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    setItems((current) => {
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const dropBefore = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    setItems((current) => {
      const from = current.findIndex((item) => item.id === draggedId);
      const to = current.findIndex((item) => item.id === targetId);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(from < to ? to - 1 : to, 0, item);
      return next;
    });
    setDraggedId(undefined);
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="edit-dialog schedule-roster-order-dialog" role="dialog" aria-modal="true" aria-labelledby="schedule-roster-order-title" style={{ maxWidth: 680 }}>
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Roster Order</p>
            <h2 id="schedule-roster-order-title">จัดลำดับพนักงาน · {department}</h2>
          </div>
          <button type="button" className="btn-neutral small-action" disabled={busy} onClick={onClose}>ปิด</button>
        </div>
        <p className="helper-text">ลากแถว หรือใช้ปุ่มขึ้น/ลง ลำดับนี้เป็นค่าเริ่มต้นของเดือนที่ยังไม่ถูก Snapshot เท่านั้น ตารางเดือนเก่าจะไม่เปลี่ยนตาม</p>
        <div style={{ display: 'grid', gap: 8, maxHeight: '55vh', overflowY: 'auto', margin: '14px 0' }}>
          {items.map((employee, index) => (
            <div
              key={employee.id}
              draggable={!busy}
              onDragStart={() => setDraggedId(employee.id)}
              onDragEnd={() => setDraggedId(undefined)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => dropBefore(employee.id)}
              style={{ display: 'grid', gridTemplateColumns: '34px minmax(0, 1fr) auto', gap: 10, alignItems: 'center', border: '1px solid #dbe3ef', borderRadius: 10, padding: '9px 10px', background: draggedId === employee.id ? '#eff6ff' : '#fff' }}
            >
              <button type="button" aria-label={`ลาก ${employeeName(employee)}`} title="ลากเพื่อจัดลำดับ" disabled={busy} style={{ cursor: busy ? 'default' : 'grab', border: 0, background: 'transparent', fontSize: 18 }}>☰</button>
              <div style={{ minWidth: 0 }}>
                <strong>{index + 1}. {employeeName(employee)}</strong>
                <small style={{ display: 'block' }}>{employee.employeeCode || '—'}{employee.jobTitle ? ` · ${employee.jobTitle}` : ''}</small>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="btn-neutral small-action" aria-label={`เลื่อน ${employeeName(employee)} ขึ้น`} disabled={busy || index === 0} onClick={() => move(index, index - 1)}>↑</button>
                <button type="button" className="btn-neutral small-action" aria-label={`เลื่อน ${employeeName(employee)} ลง`} disabled={busy || index === items.length - 1} onClick={() => move(index, index + 1)}>↓</button>
              </div>
            </div>
          ))}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn-neutral" disabled={busy} onClick={onClose}>ยกเลิก</button>
          <button type="button" className="btn-primary" disabled={busy || !changed || !items.length} onClick={() => void onSave(items.map((item) => item.id))}>
            {busy ? 'กำลังบันทึก…' : 'บันทึกลำดับพนักงาน'}
          </button>
        </div>
      </section>
    </div>
  );
}