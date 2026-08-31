import { useCallback, useEffect, useState } from 'react';
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

function aliasesText(values: string[]) {
  return values.join(', ');
}

function parseAliases(value: string) {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

export function ApprovalAuthorityMatrixPanel({ token }: { token: string }) {
  const [items, setItems] = useState<ApprovalPolicy[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ApprovalPolicy>>({});
  const [loading, setLoading] = useState(true);
  const [busyType, setBusyType] = useState('');
  const [notice, setNotice] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(undefined);
    try {
      const result = await getApprovalPolicies(token);
      const policies = Array.isArray(result?.data) ? result.data as ApprovalPolicy[] : [];
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

    <div className="alert alert-info">
      Admin authority, การห้ามอนุมัติตนเอง และ escalation ของใบลาเป็นข้อบังคับของระบบ · Configuration ทำได้เฉพาะภายในขอบเขตที่ปลอดภัยและไม่สามารถลด guard เหล่านี้ได้
    </div>

    {loading ? <div className="loading-row">กำลังอ่าน Approval policy…</div> : <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr><th>ประเภทคำขอ</th><th>ผู้อนุมัติ</th><th>ใกล้ SLA</th><th>เกิน SLA</th><th>ข้อบังคับ</th><th>จัดการ</th></tr>
        </thead>
        <tbody>{items.map((policy) => {
          const draft = drafts[policy.requestType] || policy;
          const managerAllowed = policy.safeReviewerRoles.includes('MANAGER');
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
            <td><label className="field-group compact-field"><input aria-label={`Due soon ${policy.requestType}`} type="number" min={1} max={168} value={draft.dueSoonHours} onChange={(event) => updateDraft(policy.requestType, { dueSoonHours: Number(event.target.value) })} /><small>ชั่วโมง</small></label></td>
            <td><label className="field-group compact-field"><input aria-label={`Overdue ${policy.requestType}`} type="number" min={2} max={720} value={draft.overdueHours} onChange={(event) => updateDraft(policy.requestType, { overdueHours: Number(event.target.value) })} /><small>ชั่วโมง</small></label></td>
            <td><small>{policy.protectedInvariants.join(' · ')}</small></td>
            <td><button className="btn-primary compact" disabled={busyType === policy.requestType || draft.overdueHours <= draft.dueSoonHours} onClick={() => void save(policy.requestType)}>{busyType === policy.requestType ? 'กำลังบันทึก…' : 'บันทึก'}</button></td>
          </tr>;
        })}</tbody>
      </table>
    </div>}

    {drafts.LEAVE_REQUEST && <div className="line-secure-grid approval-position-aliases">
      <label className="field-group">
        <span>คำเรียกตำแหน่ง Supervisor เพิ่มเติม</span>
        <input
          value={aliasesText(drafts.LEAVE_REQUEST.additionalSupervisorAliases)}
          placeholder="เช่น หัวหน้าชุด, shift supervisor"
          onChange={(event) => updateDraft('LEAVE_REQUEST', { additionalSupervisorAliases: parseAliases(event.target.value) })}
        />
        <small>เพิ่มได้เท่านั้น; คำหลัก Supervisor/หัวหน้า/ซุปเปอร์ไวเซอร์ถูกป้องกันและยังมีผลเสมอ</small>
      </label>
      <label className="field-group">
        <span>คำเรียกตำแหน่ง Manager เพิ่มเติม</span>
        <input
          value={aliasesText(drafts.LEAVE_REQUEST.additionalManagerAliases)}
          placeholder="เช่น section lead"
          onChange={(event) => updateDraft('LEAVE_REQUEST', { additionalManagerAliases: parseAliases(event.target.value) })}
        />
        <small>ใช้เพิ่มการจำแนก escalation โดยไม่สามารถลบ core Manager/ผู้จัดการ ได้</small>
      </label>
    </div>}

    {notice && <div className={notice.includes('สำเร็จ') ? 'settings-notice success' : 'settings-notice error'}>{notice}</div>}
    <div className="line-settings-actions"><button className="btn-neutral small-action" disabled={loading || Boolean(busyType)} onClick={() => void load()}>↻ รีเฟรช</button></div>
  </section>;
}
