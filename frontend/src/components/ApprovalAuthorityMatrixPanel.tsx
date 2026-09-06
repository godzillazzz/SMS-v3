import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import {
  getApprovalPolicies,
  updateApprovalPolicy,
  type ApprovalPolicy,
  type ApprovalPolicyInput
} from '../approval-policy-client';

function clonePolicy(policy: ApprovalPolicy): ApprovalPolicy {
  return {
    ...policy,
    reviewerRoles: [...policy.reviewerRoles],
    safeReviewerRoles: [...policy.safeReviewerRoles],
    additionalSupervisorAliases: [...policy.additionalSupervisorAliases],
    additionalManagerAliases: [...policy.additionalManagerAliases],
    protectedInvariants: [...policy.protectedInvariants]
  };
}

function policyHasChanges(policy: ApprovalPolicy, draft: ApprovalPolicy) {
  return JSON.stringify(policy.reviewerRoles) !== JSON.stringify(draft.reviewerRoles)
    || Number(policy.dueSoonHours) !== Number(draft.dueSoonHours)
    || Number(policy.overdueHours) !== Number(draft.overdueHours)
    || JSON.stringify(policy.additionalSupervisorAliases) !== JSON.stringify(draft.additionalSupervisorAliases)
    || JSON.stringify(policy.additionalManagerAliases) !== JSON.stringify(draft.additionalManagerAliases);
}

export function ApprovalAuthorityMatrixPanel({ token }: { token: string }) {
  const [items, setItems] = useState<ApprovalPolicy[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ApprovalPolicy>>({});
  const [loading, setLoading] = useState(true);
  const [busyType, setBusyType] = useState('');
  const [notice, setNotice] = useState<string>();
  const [positionOptions, setPositionOptions] = useState<Array<{ id: string; name: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(undefined);
    try {
      const [result, masterResult] = await Promise.all([getApprovalPolicies(token), api.personnelMasters(token, true)]);
      const policies = Array.isArray(result?.data) ? result.data as ApprovalPolicy[] : [];
      const masterData = masterResult?.data as { positions?: Array<{ id: string; name: string }> } | undefined;
      setPositionOptions(Array.isArray(masterData?.positions) ? masterData!.positions : []);
      setItems(policies);
      setDrafts(Object.fromEntries(policies.map((policy) => [policy.requestType, clonePolicy(policy)])));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'อ่าน Approval Authority Matrix ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const updateDraft = (requestType: string, change: Partial<ApprovalPolicy>) => {
    setDrafts((current) => ({
      ...current,
      [requestType]: { ...(current[requestType] || items.find((item) => item.requestType === requestType)!), ...change }
    }));
  };

  const save = async (requestType: string) => {
    const draft = drafts[requestType];
    if (!draft) return;
    setBusyType(requestType);
    setNotice(undefined);
    try {
      const input: ApprovalPolicyInput = {
        reviewerRoles: draft.reviewerRoles,
        dueSoonHours: Number(draft.dueSoonHours),
        overdueHours: Number(draft.overdueHours),
        additionalSupervisorAliases: draft.additionalSupervisorAliases,
        additionalManagerAliases: draft.additionalManagerAliases
      };
      await updateApprovalPolicy(token, requestType, input);
      setNotice(`บันทึกนโยบาย ${draft.label} สำเร็จแล้ว`);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'บันทึก Approval policy ไม่สำเร็จ');
    } finally {
      setBusyType('');
    }
  };

  return <section className="line-settings-card approval-authority-matrix-card">
    <div className="line-settings-title">
      <span>✓</span>
      <div>
        <h2>Approval Authority Matrix / SLA</h2>
        <p>กำหนดผู้มีอำนาจตรวจคำขอและเกณฑ์ SLA รายประเภท ภายใต้ security ceiling ที่ระบบบังคับไว้</p>
      </div>
    </div>

    <div id="approval-policy-governance-note" className="alert alert-info" role="note">
      Admin authority, การห้ามอนุมัติตนเอง และ escalation ของใบลาเป็นข้อบังคับของระบบ · Configuration ทำได้เฉพาะภายในขอบเขตที่ปลอดภัยและไม่สามารถลด guard เหล่านี้ได้
    </div>

    {loading ? <div className="loading-row" role="status" aria-live="polite">กำลังอ่าน Approval policy…</div> : <>
      <div className="table-wrap approval-policy-desktop-table">
        <table className="data-table" aria-describedby="approval-policy-description">
          <caption id="approval-policy-description" className="visually-hidden">ตารางผู้มีอำนาจอนุมัติและเกณฑ์ SLA แยกตามประเภทคำขอ</caption>
          <thead>
            <tr><th scope="col">ประเภทคำขอ</th><th scope="col">ผู้อนุมัติ</th><th scope="col">ใกล้ SLA</th><th scope="col">เกิน SLA</th><th scope="col">ข้อบังคับ</th><th scope="col">จัดการ</th></tr>
          </thead>
          <tbody>{items.length ? items.map((policy) => {
            const draft = drafts[policy.requestType] || policy;
            const managerAllowed = policy.safeReviewerRoles.includes('MANAGER');
            const changed = policyHasChanges(policy, draft);
            return <tr key={policy.requestType}>
              <td><strong>{policy.label}</strong><small className="cell-note">{policy.requestType}</small></td>
              <td>
                <div className="approval-role-controls">
                  <label><input type="checkbox" checked disabled /> Admin</label>
                  <label>
                    <input
                      type="checkbox"
                      checked={draft.reviewerRoles.includes('MANAGER')}
                      disabled={!managerAllowed || busyType === policy.requestType}
                      onChange={(event) => updateDraft(policy.requestType, {
                        reviewerRoles: event.target.checked ? ['ADMIN', 'MANAGER'] : ['ADMIN']
                      })}
                    /> Manager
                  </label>
                </div>
                {!managerAllowed && <small className="cell-note">Admin-only ถูกล็อกโดยระบบ</small>}
              </td>
              <td><label className="field-group compact-field"><span className="visually-hidden">ใกล้ SLA</span><input aria-label={`ชั่วโมงใกล้ SLA ${policy.label}`} type="number" min={1} max={168} value={draft.dueSoonHours} onChange={(event) => updateDraft(policy.requestType, { dueSoonHours: Number(event.target.value) })} /><small>ชั่วโมง</small></label></td>
              <td><label className="field-group compact-field"><span className="visually-hidden">เกิน SLA</span><input aria-label={`ชั่วโมงเกิน SLA ${policy.label}`} type="number" min={2} max={720} value={draft.overdueHours} onChange={(event) => updateDraft(policy.requestType, { overdueHours: Number(event.target.value) })} /><small>ชั่วโมง</small></label></td>
              <td><small>{policy.protectedInvariants.join(' · ')}</small></td>
              <td><div className="approval-policy-save-cell">{changed && <small className="approval-policy-dirty">มีการแก้ไข</small>}<button className="btn-primary compact" disabled={busyType === policy.requestType || draft.overdueHours <= draft.dueSoonHours} onClick={() => void save(policy.requestType)}>{busyType === policy.requestType ? 'กำลังบันทึก…' : 'บันทึก'}</button></div></td>
            </tr>;
          }) : <tr><td colSpan={6}><div className="data-state data-state--empty"><strong>ไม่พบ Approval policy ที่กำหนดไว้</strong><span>ระบบยังไม่สามารถแสดงรายการ policy สำหรับบัญชีนี้ได้</span></div></td></tr>}</tbody>
        </table>
      </div>
      <div className="approval-policy-mobile-list" aria-label="Approval policy แบบรายการ">
        {items.length ? items.map((policy) => {
          const draft = drafts[policy.requestType] || policy;
          const managerAllowed = policy.safeReviewerRoles.includes('MANAGER');
          const changed = policyHasChanges(policy, draft);
          const key = policy.requestType.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          const dueSoonId = `approval-policy-${key}-due-soon`;
          const overdueId = `approval-policy-${key}-overdue`;
          return <article className="approval-policy-mobile-card" key={policy.requestType}>
            <header className="approval-policy-mobile-card__header">
              <div><p className="eyebrow">ประเภทคำขอ</p><h3>{policy.label}</h3><code>{policy.requestType}</code></div>
              {changed && <span className="approval-policy-dirty">มีการแก้ไข</span>}
            </header>
            <section className="approval-policy-mobile-card__section" aria-labelledby={`${key}-reviewer-heading`}>
              <h4 id={`${key}-reviewer-heading`}>ผู้มีอำนาจอนุมัติ</h4>
              <div className="approval-role-controls">
                <label><input type="checkbox" checked disabled /> Admin <small>จำเป็น</small></label>
                <label><input type="checkbox" checked={draft.reviewerRoles.includes('MANAGER')} disabled={!managerAllowed || busyType === policy.requestType} onChange={(event) => updateDraft(policy.requestType, { reviewerRoles: event.target.checked ? ['ADMIN', 'MANAGER'] : ['ADMIN'] })} /> Manager</label>
              </div>
              {!managerAllowed && <p className="approval-policy-lock-note">Admin-only ถูกล็อกโดย security ceiling</p>}
            </section>
            <section className="approval-policy-mobile-card__section" aria-labelledby={`${key}-sla-heading`}>
              <h4 id={`${key}-sla-heading`}>เกณฑ์ SLA</h4>
              <div className="approval-policy-sla-fields">
                <label htmlFor={dueSoonId}><span>ใกล้ SLA</span><input id={dueSoonId} aria-label={`ชั่วโมงใกล้ SLA ${policy.label}`} type="number" min={1} max={168} value={draft.dueSoonHours} onChange={(event) => updateDraft(policy.requestType, { dueSoonHours: Number(event.target.value) })} /><small>ชั่วโมง</small></label>
                <label htmlFor={overdueId}><span>เกิน SLA</span><input id={overdueId} aria-label={`ชั่วโมงเกิน SLA ${policy.label}`} type="number" min={2} max={720} value={draft.overdueHours} onChange={(event) => updateDraft(policy.requestType, { overdueHours: Number(event.target.value) })} /><small>ชั่วโมง</small></label>
              </div>
              {draft.overdueHours <= draft.dueSoonHours && <p className="approval-policy-validation" role="alert">เกณฑ์เกิน SLA ต้องมากกว่าเกณฑ์ใกล้ SLA</p>}
            </section>
            <section className="approval-policy-mobile-card__section approval-policy-invariants" aria-labelledby={`${key}-invariants-heading`}>
              <h4 id={`${key}-invariants-heading`}>ข้อบังคับที่ลดไม่ได้</h4>
              <ul>{policy.protectedInvariants.map((invariant) => <li key={invariant}>{invariant}</li>)}</ul>
            </section>
            <footer className="approval-policy-mobile-card__footer">
              <span>{changed ? 'ตรวจสอบค่าที่แก้ไขก่อนบันทึก' : 'ค่าปัจจุบันจากระบบ'}</span>
              <button className="btn-primary" disabled={busyType === policy.requestType || draft.overdueHours <= draft.dueSoonHours} onClick={() => void save(policy.requestType)}>{busyType === policy.requestType ? 'กำลังบันทึก…' : 'บันทึก policy นี้'}</button>
            </footer>
          </article>;
        }) : <div className="data-state data-state--empty"><strong>ไม่พบ Approval policy ที่กำหนดไว้</strong><span>ระบบยังไม่สามารถแสดงรายการ policy สำหรับบัญชีนี้ได้</span></div>}
      </div>
    </>}

    {drafts.LEAVE_REQUEST && <div className="line-secure-grid approval-position-aliases">
      {(['additionalSupervisorAliases', 'additionalManagerAliases'] as const).map((field) => {
        const selected = drafts.LEAVE_REQUEST[field];
        const known = new Set(positionOptions.map((item) => item.name));
        const legacy = selected.filter((value) => !known.has(value));
        const title = field === 'additionalSupervisorAliases' ? 'ตำแหน่ง Supervisor เพิ่มเติม' : 'ตำแหน่ง Manager เพิ่มเติม';
        return <fieldset className="field-group" key={field}><legend>{title}</legend><div className="approval-position-master-options">{positionOptions.map((item) => <label key={item.id}><input type="checkbox" checked={selected.includes(item.name)} onChange={(event) => { const preservedLegacy = selected.filter((value) => !known.has(value)); const selectedKnown = selected.filter((value) => known.has(value) && value !== item.name); updateDraft('LEAVE_REQUEST', { [field]: [...preservedLegacy, ...selectedKnown, ...(event.target.checked ? [item.name] : [])] }); }} />{item.name}</label>)}</div>{legacy.length > 0 && <small>Legacy aliases ที่คงไว้เพื่อ compatibility: {legacy.join(', ')} · เพิ่มค่าใหม่ได้เฉพาะจาก Position Master</small>}<small>{field === 'additionalSupervisorAliases' ? 'Core Supervisor aliases ยังถูกป้องกันและมีผลเสมอ' : 'Core Manager aliases ยังถูกป้องกันและมีผลเสมอ'}</small></fieldset>;
      })}
    </div>}

        {notice && <div role={notice.includes('สำเร็จ') ? 'status' : 'alert'} aria-live={notice.includes('สำเร็จ') ? 'polite' : 'assertive'} className={notice.includes('สำเร็จ') ? 'settings-notice success' : 'settings-notice error'}>{notice}</div>}
    <div className="line-settings-actions"><button className="btn-neutral small-action" disabled={loading || Boolean(busyType)} onClick={() => void load()}>↻ รีเฟรช</button></div>
  </section>;
}
