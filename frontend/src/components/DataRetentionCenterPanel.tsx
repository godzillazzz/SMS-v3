import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  cancelRetentionChange,
  createRetentionChange,
  getRetentionPolicies,
  previewRetentionPolicy,
  runRetentionCleanup,
  type RetentionPolicy,
  type RetentionPreview,
  type RetentionState
} from '../data-retention-client';

type Draft = Omit<RetentionPolicy, 'timezone'>;

const labels = {
  operationalUsageMonths: 'Operational / usage logs',
  attendanceRawMonths: 'Attendance raw events',
  patrolRawMonths: 'Patrol / checkpoint raw scans'
} satisfies Record<keyof Draft, string>;

const impactKey = {
  operationalUsageMonths: 'OPERATIONAL_USAGE',
  attendanceRawMonths: 'ATTENDANCE_RAW',
  patrolRawMonths: 'PATROL_RAW'
} as const;

function thaiDateTime(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(value));
}

function draftFrom(policy: RetentionPolicy): Draft {
  return {
    operationalUsageMonths: policy.operationalUsageMonths,
    attendanceRawMonths: policy.attendanceRawMonths,
    patrolRawMonths: policy.patrolRawMonths
  };
}

export function DataRetentionCenterPanel({ token }: { token: string }) {
  const [state, setState] = useState<RetentionState>();
  const [draft, setDraft] = useState<Draft>();
  const [preview, setPreview] = useState<RetentionPreview>();
  const [reason, setReason] = useState('');
  const [ackImpact, setAckImpact] = useState(false);
  const [cleanupAck, setCleanupAck] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<string>();

  const load = useCallback(async ({ preserveNotice = false } = {}) => {
    setLoading(true);
    if (!preserveNotice) setNotice(undefined);
    try {
      const result = await getRetentionPolicies(token);
      const next = result?.data as RetentionState;
      setState(next);
      setDraft(draftFrom(next.policy));
      setPreview(undefined);
      setAckImpact(false);
      setCleanupAck(false);
      if (!next.pendingChange) { setShowCancel(false); setCancelReason(''); }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'อ่าน Data Retention policy ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const changed = useMemo(() => Boolean(state && draft && (
    draft.operationalUsageMonths !== state.policy.operationalUsageMonths
    || draft.attendanceRawMonths !== state.policy.attendanceRawMonths
    || draft.patrolRawMonths !== state.policy.patrolRawMonths
  )), [state, draft]);

  const update = (key: keyof Draft, value: number) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setPreview(undefined);
    setAckImpact(false);
    setNotice(undefined);
  };

  const doPreview = async () => {
    if (!draft) return;
    setBusy('preview'); setNotice(undefined);
    try {
      const result = await previewRetentionPolicy(token, draft);
      setPreview(result.data as RetentionPreview);
      setAckImpact(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'ตรวจสอบผลกระทบไม่สำเร็จ');
    } finally { setBusy(''); }
  };

  const save = async () => {
    if (!draft || !preview) return;
    setBusy('save'); setNotice(undefined);
    try {
      const result = await createRetentionChange(token, {
        proposedPolicy: draft,
        expectedPreviewDigest: preview.previewDigest,
        acknowledgeImpact: preview.reduction ? ackImpact : false,
        reason
      });
      const scheduled = result?.data?.status === 'SCHEDULED';
      setNotice(scheduled
        ? 'บันทึกการลด Retention แล้ว ระบบจะมีผลหลังช่วง Safety Delay 24 ชั่วโมง'
        : 'บันทึก Retention policy และมีผลทันทีแล้ว');
      setReason('');
      await load({ preserveNotice: true });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'บันทึก Retention policy ไม่สำเร็จ');
    } finally { setBusy(''); }
  };

  const cancelPending = async () => {
    if (!state?.pendingChange) return;
    setBusy('cancel'); setNotice(undefined);
    try {
      await cancelRetentionChange(token, state.pendingChange.id, cancelReason);
      setNotice('ยกเลิก Retention change ที่รอดำเนินการแล้ว');
      setShowCancel(false); setCancelReason('');
      await load({ preserveNotice: true });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'ยกเลิก Retention change ไม่สำเร็จ');
    } finally { setBusy(''); }
  };

  const runCleanup = async () => {
    if (!cleanupAck) return;
    setBusy('cleanup'); setNotice(undefined);
    try {
      const result = await runRetentionCleanup(token, { acknowledgeCleanup: true, batchSize: 200, maxBatches: 5 });
      const status = result?.data?.status || 'SUCCESS';
      setNotice(`Cleanup จบแล้ว · สถานะ ${status}`);
      await load({ preserveNotice: true });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'รัน Data Retention cleanup ไม่สำเร็จ');
    } finally { setBusy(''); }
  };

  if (loading && !state) return <section className="line-settings-card retention-center-card"><div className="loading-row">กำลังอ่าน Data Retention policy…</div></section>;
  if (!state || !draft) return <section className="line-settings-card retention-center-card">{notice && <div className="settings-notice error">{notice}</div>}<button className="btn-neutral small-action" onClick={() => void load()}>↻ ลองใหม่</button></section>;

  return <section className="line-settings-card retention-center-card">
    <div className="line-settings-title">
      <span>⌛</span>
      <div>
        <h2>Data Retention Center / การเก็บรักษาข้อมูล</h2>
        <p>กำหนดอายุข้อมูลตามปฏิทิน Asia/Bangkok พร้อม Preview, Safety Delay และ Audit ก่อนการลบจริง</p>
      </div>
    </div>

    <div className="alert alert-info retention-protected-note">
      <strong>Protected invariants:</strong> Security/Governance Audit และ Certified Attendance Summary จะไม่ถูกลบโดย Retention cleanup · Attendance raw event ที่อ้างอิงโดย Correction จะถูกเก็บเป็นหลักฐาน
    </div>

    <div className="retention-timezone"><span>Timezone authority</span><strong>Asia/Bangkok</strong><small>ถูกล็อกโดยระบบและแก้ไขไม่ได้</small></div>

    {state.pendingChange && <div className="retention-pending">
      <div><strong>มี Retention change รอมีผล</strong><span>มีผลประมาณ {thaiDateTime(state.pendingChange.effectiveAt)}</span><small>เหตุผล: {state.pendingChange.reason}</small></div>
      {!showCancel ? <button className="btn-neutral small-action" disabled={Boolean(busy)} onClick={() => setShowCancel(true)}>ยกเลิกรายการรอมีผล</button> : <div className="retention-cancel-controls">
        <label className="field-group"><span>เหตุผลที่ยกเลิก</span><input value={cancelReason} minLength={5} maxLength={1000} onChange={(event) => setCancelReason(event.target.value)} /></label>
        <button className="btn-neutral small-action" disabled={cancelReason.trim().length < 5 || busy === 'cancel'} onClick={() => void cancelPending()}>{busy === 'cancel' ? 'กำลังยกเลิก…' : 'ยืนยันยกเลิก'}</button>
      </div>}
    </div>}

    <div className="retention-policy-grid">
      {(Object.keys(labels) as Array<keyof Draft>).map((key) => {
        const impact = preview?.impacts[impactKey[key]];
        const currentCutoff = key === 'operationalUsageMonths' ? state.cutoffs.operationalUsage : key === 'attendanceRawMonths' ? state.cutoffs.attendanceRaw : state.cutoffs.patrolRaw;
        return <article key={key} className="retention-policy-card">
          <header><strong>{labels[key]}</strong><span className={impact?.adapterStatus === 'NOT_AVAILABLE' ? 'status-badge status-badge--neutral' : 'status-badge status-badge--success'}>{impact?.adapterStatus || (key === 'patrolRawMonths' ? 'NOT_AVAILABLE' : 'ACTIVE')}</span></header>
          <label className="field-group"><span>เก็บรักษา</span><div className="retention-month-input"><input aria-label={labels[key]} type="number" min={1} max={120} value={draft[key]} disabled={Boolean(state.pendingChange) || Boolean(busy)} onChange={(event) => update(key, Number(event.target.value))} /><span>เดือน</span></div></label>
          <small>ค่าปัจจุบัน {state.policy[key]} เดือน · cutoff ปัจจุบัน {thaiDateTime(currentCutoff)}</small>
          {impact && <div className="retention-impact">
            <span>Cutoff ใหม่: {thaiDateTime(impact.cutoff)}</span>
            <span>ลบได้: <b>{Number(impact.eligible || 0).toLocaleString()}</b> รายการ</span>
            {key === 'attendanceRawMonths' && <>
              <span>เดือนยังไม่ Certified: <b>{Number(impact.blockedUncertified || 0).toLocaleString()}</b></span>
              <span>หลักฐาน Correction ที่ป้องกันไว้: <b>{Number(impact.protectedByCorrection || 0).toLocaleString()}</b></span>
            </>}
            {impact.reason && <small>{impact.reason}</small>}
          </div>}
        </article>;
      })}
    </div>

    <label className="field-group retention-reason"><span>เหตุผล / หมายเหตุ <b>*</b></span><textarea rows={3} minLength={5} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="ระบุเหตุผลสำหรับ Audit" /></label>

    {preview && <div className="retention-preview">
      <strong>ผลตรวจสอบผลกระทบ</strong>
      <span>{preview.reduction ? 'มีการลดระยะเก็บรักษา — จะยังไม่ลบทันที' : 'ไม่มีการลดระยะเก็บรักษา — policy สามารถมีผลทันที'}</span>
      {preview.reduction && <><span>Safety Delay: {preview.cleanupDelayHours} ชั่วโมง</span><label className="retention-ack"><input type="checkbox" checked={ackImpact} onChange={(event) => setAckImpact(event.target.checked)} /> ตรวจสอบผลกระทบแล้ว และยืนยันให้ตั้งเวลาการลด Retention ตาม Safety Delay</label></>}
      {preview.impacts.ATTENDANCE_RAW.blockedMonths?.length ? <small>เดือน Attendance ที่ยังไม่ Certified และจะไม่ถูกลบ: {preview.impacts.ATTENDANCE_RAW.blockedMonths.map((item) => item.month).join(', ')}</small> : null}
    </div>}

    {notice && <div className={notice.includes('ไม่สำเร็จ') ? 'settings-notice error' : 'settings-notice success'}>{notice}</div>}

    <div className="line-settings-actions">
      <button className="btn-neutral small-action" disabled={Boolean(busy) || Boolean(state.pendingChange)} onClick={() => void doPreview()}>{busy === 'preview' ? 'กำลังตรวจสอบ…' : 'ตรวจสอบผลกระทบ'}</button>
      <button className="btn-primary compact" disabled={!changed || !preview || reason.trim().length < 5 || Boolean(busy) || Boolean(state.pendingChange) || (preview.reduction && !ackImpact)} onClick={() => void save()}>{busy === 'save' ? 'กำลังบันทึก…' : 'บันทึก Retention policy'}</button>
      <button className="btn-neutral small-action" disabled={Boolean(busy)} onClick={() => void load()}>↻ รีเฟรช</button>
    </div>

    <div className="retention-cleanup-box">
      <div><strong>Controlled Cleanup</strong><span>ลบเฉพาะข้อมูลที่ผ่าน policy และ safety guards แบบ bounded batches</span></div>
      <label className="retention-ack"><input type="checkbox" checked={cleanupAck} onChange={(event) => setCleanupAck(event.target.checked)} /> ยืนยันให้รัน Cleanup รอบถัดไปตาม policy ปัจจุบัน</label>
      <button className="btn-neutral small-action" disabled={!cleanupAck || Boolean(busy)} onClick={() => void runCleanup()}>{busy === 'cleanup' ? 'กำลัง Cleanup…' : 'รัน Cleanup รอบถัดไป'}</button>
    </div>

    <div className="retention-runs">
      <strong>Cleanup ล่าสุด</strong>
      {state.recentRuns.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">เวลา</th><th scope="col">Trigger</th><th scope="col">สถานะ</th><th scope="col">Error</th></tr></thead><tbody>
        {state.recentRuns.slice(0, 8).map((run) => <tr key={run.id}><td>{thaiDateTime(run.startedAt)}</td><td>{run.trigger}</td><td>{run.status}</td><td>{run.errorCode || '—'}</td></tr>)}
      </tbody></table></div> : <small>ยังไม่มี Cleanup run</small>}
    </div>
  </section>;
}
