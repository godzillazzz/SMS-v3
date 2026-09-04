import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createAutoSchedulePattern,
  describePattern,
  getAutoSchedulePatterns,
  updateAutoSchedulePattern,
  type AutoSchedulePattern,
  type AutoSchedulePatternStep,
  type CreateAutoSchedulePatternInput,
  type UpdateAutoSchedulePatternInput
} from '../auto-schedule-pattern-client';
import { getShiftTypes } from '../shift-type-client';

const thaiWeekdays = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
const weeklyPhaseCodes = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function defaultSteps(mode: AutoSchedulePattern['mode'], shiftCode = 'D'): AutoSchedulePatternStep[] {
  if (mode === 'WEEKLY') {
    return weeklyPhaseCodes.map((phaseCode, index) => ({
      phaseCode,
      shiftCode: index === 6 ? 'OFF' : shiftCode,
      label: `วัน${thaiWeekdays[index]} · ${index === 6 ? 'วันหยุด' : 'กะทำงาน'}`
    }));
  }
  return [
    { phaseCode: 'STEP1', shiftCode, label: 'ขั้นที่ 1' },
    { phaseCode: 'STEP2', shiftCode: 'OFF', label: 'ขั้นที่ 2 · วันหยุด' }
  ];
}

function cloneSteps(steps: AutoSchedulePatternStep[]) {
  return steps.map((step) => ({ ...step }));
}

export function AutoSchedulePatternPanel({ token }: { token: string }) {
  const [items, setItems] = useState<AutoSchedulePattern[]>([]);
  const [shiftCodes, setShiftCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const [editForm, setEditForm] = useState<UpdateAutoSchedulePatternInput>({});
  const [createForm, setCreateForm] = useState<CreateAutoSchedulePatternInput>({
    code: '',
    name: '',
    mode: 'CYCLE',
    steps: defaultSteps('CYCLE'),
    isActive: true,
    targetGroup: 'MANUAL',
    sortOrder: 100
  });

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(undefined);
    try {
      const [patterns, shifts] = await Promise.all([
        getAutoSchedulePatterns(token, { includeInactive: true }),
        getShiftTypes(token)
      ]);
      setItems(Array.isArray(patterns?.data) ? patterns.data : []);
      const codes: string[] = (Array.isArray(shifts?.data) ? shifts.data : [])
        .filter((row: { isActive?: boolean }) => row.isActive !== false)
        .map((row: { code?: unknown }) => String(row.code || '').toUpperCase())
        .filter((code: string) => code && code !== 'AL');
      setShiftCodes([...new Set(codes)]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'อ่าน Auto Schedule Pattern Master ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const availableShiftCodes = useMemo(
    () => shiftCodes.length ? shiftCodes : ['D', 'N', 'OFF'],
    [shiftCodes]
  );

  const beginEdit = (row: AutoSchedulePattern) => {
    setEditingId(row.id);
    setEditForm({
      name: row.name,
      mode: row.mode,
      steps: cloneSteps(row.steps),
      isActive: row.isActive,
      targetGroup: row.targetGroup,
      sortOrder: row.sortOrder
    });
    setNotice(undefined);
  };

  const setCreateMode = (mode: AutoSchedulePattern['mode']) => {
    setCreateForm((current) => ({
      ...current,
      mode,
      steps: defaultSteps(mode, availableShiftCodes.find((code) => code !== 'OFF') || 'D')
    }));
  };

  const setEditMode = (row: AutoSchedulePattern, mode: AutoSchedulePattern['mode']) => {
    setEditForm((current) => ({
      ...current,
      mode,
      steps: mode === row.mode ? cloneSteps(row.steps) : defaultSteps(mode, availableShiftCodes.find((code) => code !== 'OFF') || 'D')
    }));
  };

  const changeStep = (kind: 'create' | 'edit', index: number, field: keyof AutoSchedulePatternStep, value: string) => {
    if (kind === 'create') {
      setCreateForm((current) => {
        const steps = cloneSteps(current.steps);
        steps[index] = { ...steps[index], [field]: value };
        return { ...current, steps };
      });
      return;
    }
    setEditForm((current) => {
      const steps = cloneSteps((current.steps as AutoSchedulePatternStep[]) || []);
      steps[index] = { ...steps[index], [field]: value };
      return { ...current, steps };
    });
  };

  const addCycleStep = (kind: 'create' | 'edit') => {
    if (kind === 'create') {
      setCreateForm((current) => ({
        ...current,
        steps: [...current.steps, { phaseCode: `STEP${current.steps.length + 1}`, shiftCode: availableShiftCodes[0] || 'D', label: `ขั้นที่ ${current.steps.length + 1}` }]
      }));
      return;
    }
    setEditForm((current) => {
      const steps = (current.steps as AutoSchedulePatternStep[]) || [];
      return {
        ...current,
        steps: [...steps, { phaseCode: `STEP${steps.length + 1}`, shiftCode: availableShiftCodes[0] || 'D', label: `ขั้นที่ ${steps.length + 1}` }]
      };
    });
  };

  const removeCycleStep = (kind: 'create' | 'edit', index: number) => {
    if (kind === 'create') {
      setCreateForm((current) => ({ ...current, steps: current.steps.filter((_, stepIndex) => stepIndex !== index) }));
      return;
    }
    setEditForm((current) => ({
      ...current,
      steps: ((current.steps as AutoSchedulePatternStep[]) || []).filter((_, stepIndex) => stepIndex !== index)
    }));
  };

  const submitCreate = async () => {
    setBusy(true);
    setNotice(undefined);
    try {
      await createAutoSchedulePattern(token, {
        ...createForm,
        code: createForm.code.trim().toUpperCase(),
        name: createForm.name.trim(),
        targetGroup: 'MANUAL',
        steps: createForm.steps.map((step) => ({
          phaseCode: step.phaseCode.trim().toUpperCase(),
          shiftCode: step.shiftCode.trim().toUpperCase(),
          label: step.label.trim()
        }))
      });
      setCreateForm({ code: '', name: '', mode: 'CYCLE', steps: defaultSteps('CYCLE'), isActive: true, targetGroup: 'MANUAL', sortOrder: 100 });
      setNotice('เพิ่ม Auto Schedule Pattern สำเร็จแล้ว');
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'เพิ่ม Auto Schedule Pattern ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async (row: AutoSchedulePattern) => {
    setBusy(true);
    setNotice(undefined);
    try {
      const steps = ((editForm.steps as AutoSchedulePatternStep[]) || row.steps).map((step) => ({
        phaseCode: step.phaseCode.trim().toUpperCase(),
        shiftCode: step.shiftCode.trim().toUpperCase(),
        label: step.label.trim()
      }));
      await updateAutoSchedulePattern(token, row.id, {
        name: String(editForm.name ?? row.name).trim(),
        mode: (editForm.mode ?? row.mode) as AutoSchedulePattern['mode'],
        steps,
        isActive: Boolean(editForm.isActive ?? row.isActive),
        targetGroup: row.targetGroup,
        sortOrder: Number(editForm.sortOrder ?? row.sortOrder)
      });
      setEditingId(undefined);
      setEditForm({});
      setNotice('บันทึก Auto Schedule Pattern สำเร็จแล้ว');
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'บันทึก Auto Schedule Pattern ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const renderSteps = (
    steps: AutoSchedulePatternStep[],
    mode: AutoSchedulePattern['mode'],
    kind: 'create' | 'edit',
    systemLocked = false
  ) => <div className="pattern-step-editor">
    {steps.map((step, index) => <div className="pattern-step-row" key={`${step.phaseCode}-${index}`}>
      <input
        aria-label={`Phase ${index + 1}`}
        value={step.phaseCode}
        disabled={mode === 'WEEKLY' || systemLocked}
        maxLength={20}
        onChange={(event) => changeStep(kind, index, 'phaseCode', event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
      />
      <select
        aria-label={`Shift ${index + 1}`}
        value={step.shiftCode}
        onChange={(event) => changeStep(kind, index, 'shiftCode', event.target.value)}
      >
        {availableShiftCodes.map((code) => <option key={code} value={code}>{code}</option>)}
      </select>
      <input
        aria-label={`Label ${index + 1}`}
        value={step.label}
        maxLength={100}
        onChange={(event) => changeStep(kind, index, 'label', event.target.value)}
      />
      {mode === 'CYCLE' && !systemLocked && steps.length > 1
        ? <button type="button" className="btn-danger-outline compact" onClick={() => removeCycleStep(kind, index)}>ลบขั้น</button>
        : <span />}
    </div>)}
    {mode === 'CYCLE' && !systemLocked && steps.length < 31
      ? <button type="button" className="btn-neutral small-action" onClick={() => addCycleStep(kind)}>＋ เพิ่มขั้น</button>
      : null}
  </div>;

  return <section className="line-settings-card auto-schedule-pattern-master-card">
    <div className="line-settings-title">
      <span>🪄</span>
      <div>
        <h2>Auto Schedule Pattern Manager</h2>
        <p>บริหารแพทเทิร์นและ Phase ที่ไม้กายสิทธิ์ใช้จริง โดย Preview ก่อน Commit และไม่เขียนทับกะ/ชั่วโมงย้อนหลัง</p>
      </div>
    </div>

    {loading ? <div className="loading-row">กำลังอ่าน Pattern Master…</div> : <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th scope="col">Pattern</th><th scope="col">รูปแบบ</th><th scope="col">เป้าหมายอัตโนมัติ</th><th scope="col">ลำดับกะ</th><th scope="col">สถานะ</th><th scope="col">จัดการ</th></tr></thead>
        <tbody>{items.map((row) => {
          const editing = editingId === row.id;
          const editMode = (editForm.mode ?? row.mode) as AutoSchedulePattern['mode'];
          const editSteps = (editForm.steps as AutoSchedulePatternStep[]) || row.steps;
          return <tr key={row.id}>
            <td><strong>{row.name}</strong><small className="cell-note">{row.code}{row.isSystem ? ' · Core' : ' · Custom'}</small></td>
            <td>{editing && !row.isSystem
              ? <select value={editMode} onChange={(event) => setEditMode(row, event.target.value as AutoSchedulePattern['mode'])}><option value="CYCLE">Cycle</option><option value="WEEKLY">Weekly</option></select>
              : row.mode}</td>
            <td>{row.targetGroup === 'SUPERVISOR' ? 'หัวหน้างาน' : row.targetGroup === 'GENERAL' ? 'พนักงานทั่วไป' : 'เลือกเอง'}</td>
            <td>{editing
              ? renderSteps(editSteps, editMode, 'edit', false)
              : <span title={row.steps.map((step) => `${step.phaseCode}: ${step.shiftCode}`).join(' · ')}>{describePattern(row)}</span>}</td>
            <td>{editing
              ? <select disabled={row.isSystem} value={String(Boolean(editForm.isActive ?? row.isActive))} onChange={(event) => setEditForm((current) => ({ ...current, isActive: event.target.value === 'true' }))}><option value="true">ใช้งาน</option><option value="false">ปิดใช้งาน</option></select>
              : <span className={`status-badge ${row.isActive ? 'status-badge--success' : 'status-badge--neutral'}`}>{row.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}</span>}</td>
            <td>{editing
              ? <div className="row-actions">
                  <button className="btn-primary compact" disabled={busy} onClick={() => void submitEdit(row)}>บันทึก</button>
                  <button className="btn-neutral small-action" disabled={busy} onClick={() => { setEditingId(undefined); setEditForm({}); }}>ยกเลิก</button>
                </div>
              : <button className="btn-neutral small-action" disabled={busy} onClick={() => beginEdit(row)}>แก้ไข</button>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>}

    <div className="line-secure-grid">
      <label className="field-group"><span>รหัส Pattern ใหม่</span><input value={createForm.code} maxLength={40} placeholder="เช่น TEAM_A_ROTATE" onChange={(event) => setCreateForm((current) => ({ ...current, code: event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') }))} /><small>รหัสแก้ไม่ได้หลังสร้าง และ Custom pattern จะเป็น “เลือกเอง” เท่านั้น</small></label>
      <label className="field-group"><span>ชื่อ Pattern</span><input value={createForm.name} maxLength={150} placeholder="เช่น แพทเทิร์นทีม A" onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))} /></label>
      <label className="field-group"><span>ชนิด</span><select value={createForm.mode} onChange={(event) => setCreateMode(event.target.value as AutoSchedulePattern['mode'])}><option value="CYCLE">Cycle · วนตาม Phase</option><option value="WEEKLY">Weekly · จันทร์-อาทิตย์</option></select></label>
      <label className="field-group"><span>ลำดับแสดงผล</span><input type="number" min={0} max={9999} value={createForm.sortOrder} onChange={(event) => setCreateForm((current) => ({ ...current, sortOrder: Number(event.target.value) }))} /></label>
    </div>
    {renderSteps(createForm.steps, createForm.mode, 'create')}

    <div className="alert alert-info">Core SUPERVISOR / ROTATE ปิดใช้งาน เปลี่ยนรหัส หรือเปลี่ยนกลุ่มเป้าหมายไม่ได้ · ไม่มีคำสั่ง Delete · การแก้แพทเทิร์นมีผลกับ Preview/การจัดกะครั้งถัดไปเท่านั้น</div>
    {notice && <div className={notice.includes('สำเร็จ') ? 'settings-notice success' : 'settings-notice error'}>{notice}</div>}
    <div className="line-settings-actions">
      <button className="btn-primary compact" disabled={busy || !createForm.code.trim() || !createForm.name.trim() || !createForm.steps.length} onClick={() => void submitCreate()}>＋ เพิ่ม Pattern</button>
      <button className="btn-neutral small-action" disabled={busy} onClick={() => void load()}>↻ รีเฟรช</button>
    </div>
  </section>;
}
