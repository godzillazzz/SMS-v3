import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { acquireDocumentScrollLock } from '../../document-scroll-lock';
import { SmsIcon } from '../../components/SmsIcon';
import '../../styles/registration-review.css';

type RequestRow = {
  id: string;
  submittedName: string;
  email: string;
  departmentHint?: string | null;
  status: 'PENDING' | 'MATCHED' | 'APPROVED' | 'REJECTED';
  matchedEmployeeId?: string | null;
  matchedEmployee?: Candidate | null;
  createdAt?: string;
};
type Candidate = {
  id: string;
  employeeCode: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  department?: string | null;
  jobTitle?: string | null;
};

type Props = {
  token: string;
  role: string;
  refreshSignal: number;
  onChanged(): void;
  onOpenEmployeeMaster(): void;
};

const candidateName = (row: Candidate) => row.displayName || `${row.firstName || ''} ${row.lastName || ''}`.trim();
const requestStatus: Record<string, string> = { PENDING: 'รอตรวจสอบ', MATCHED: 'จับคู่แล้ว', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ไม่อนุมัติ' };
const requestTone: Record<string, string> = { PENDING: 'warning', MATCHED: 'info', APPROVED: 'success', REJECTED: 'danger' };

function formatRequestDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' }).format(date);
}

function ReviewProgress({ status, candidateSelected }: { status: RequestRow['status']; candidateSelected: boolean }) {
  const activeStep = status === 'APPROVED' ? 4 : status === 'MATCHED' ? 3 : status === 'PENDING' && candidateSelected ? 2 : 1;
  const labels = ['ตรวจสอบคำขอ', 'จับคู่พนักงาน', 'อนุมัติบัญชี'];
  return <div className="registration-review__progress-wrap">
    <div className="registration-review__progress-heading"><span>ขั้นตอนการตรวจสอบ</span>{status === 'REJECTED' && <strong>สิ้นสุดโดยไม่อนุมัติ</strong>}</div>
    <ol className={`registration-review__progress ${status === 'REJECTED' ? 'is-rejected' : ''}`} aria-label="ขั้นตอนการตรวจสอบคำขอลงทะเบียน">
      {labels.map((label, index) => {
        const step = index + 1;
        const state = status === 'REJECTED' ? (step === 1 ? 'complete' : 'upcoming') : step < activeStep ? 'complete' : step === activeStep ? 'active' : 'upcoming';
        return <li key={label} className={`is-${state}`} aria-current={state === 'active' ? 'step' : undefined}><span>{state === 'complete' ? <SmsIcon name="approval" size={15} /> : step}</span><b>{label}</b></li>;
      })}
    </ol>
  </div>;
}

export function RegistrationReviewPanel({ token, role, refreshSignal, onChanged, onOpenEmployeeMaster }: Props) {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [matchState, setMatchState] = useState('');
  const [loading, setLoading] = useState(false);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectValidation, setRejectValidation] = useState('');
  const [mobileDetail, setMobileDetail] = useState(false);
  const rejectTriggerRef = useRef<HTMLButtonElement | null>(null);
  const rejectTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const selected = useMemo(() => rows.find((row) => row.id === selectedId), [rows, selectedId]);
  const selectedCandidate = useMemo(() => candidates.find((candidate) => candidate.id === selectedCandidateId), [candidates, selectedCandidateId]);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const result = await api.registrationRequests(token);
      const next = Array.isArray(result?.data) ? result.data as RequestRow[] : [];
      setRows(next);
      setSelectedId((current) => next.some((row) => row.id === current) ? current : next[0]?.id || '');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'โหลดคำขอลงทะเบียนไม่สำเร็จ'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (['ADMIN', 'MANAGER'].includes(role)) void load(); }, [token, role, refreshSignal]);

  const runSearch = async (manual = false) => {
    if (!selected) return;
    setCandidateLoading(true); setError(''); setMessage(''); setSelectedCandidateId('');
    try {
      const result = await api.registrationCandidates(token, selected.id, manual ? search.trim() : '');
      setCandidates(Array.isArray(result?.data) ? result.data : []);
      setMatchState(String(result?.meta?.employeeMatchState || ''));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'ค้นหา Employee Master ไม่สำเร็จ'); }
    finally { setCandidateLoading(false); }
  };

  useEffect(() => {
    setSearch(''); setCandidates([]); setSelectedCandidateId(''); setMatchState(''); setMessage(''); setError('');
    if (selected && ['PENDING', 'MATCHED'].includes(selected.status)) void runSearch(false);
  }, [selectedId]);

  const closeReject = () => {
    setRejectOpen(false);
    setRejectValidation('');
    window.setTimeout(() => rejectTriggerRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!rejectOpen) return undefined;
    const releaseScrollLock = acquireDocumentScrollLock();
    const timer = window.setTimeout(() => rejectTextareaRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeReject(); };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
      releaseScrollLock();
    };
  }, [rejectOpen]);

  if (!['ADMIN', 'MANAGER'].includes(role)) return null;

  const match = async (employeeId: string) => {
    if (!selected) return;
    setBusy(true); setError(''); setMessage('');
    try { await api.matchRegistrationRequest(token, selected.id, employeeId); setMessage('จับคู่ Employee Master แล้ว'); setSelectedCandidateId(''); await load(); onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'จับคู่ไม่สำเร็จ'); }
    finally { setBusy(false); }
  };
  const approve = async () => {
    if (!selected) return;
    setBusy(true); setError(''); setMessage('');
    try { await api.approveRegistrationRequest(token, selected.id); setMessage('อนุมัติบัญชีแล้ว — สิทธิ์เริ่มต้น VIEWER'); await load(); onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'อนุมัติไม่สำเร็จ'); }
    finally { setBusy(false); }
  };
  const openReject = (trigger: HTMLButtonElement) => {
    rejectTriggerRef.current = trigger;
    setRejectReason('');
    setRejectValidation('');
    setRejectOpen(true);
  };
  const reject = async () => {
    if (!selected) return;
    const reason = rejectReason.trim();
    if (reason.length < 3) { setRejectValidation('กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร'); rejectTextareaRef.current?.focus(); return; }
    setBusy(true); setError(''); setMessage('');
    try { await api.rejectRegistrationRequest(token, selected.id, reason); setMessage('บันทึกการไม่อนุมัติแล้ว'); setRejectOpen(false); setRejectReason(''); setRejectValidation(''); await load(); onChanged(); window.setTimeout(() => rejectTriggerRef.current?.focus(), 0); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'ไม่สามารถบันทึกได้'); }
    finally { setBusy(false); }
  };

  const selectRequest = (id: string) => { setSelectedId(id); setMobileDetail(true); };
  const terminal = selected && ['APPROVED', 'REJECTED'].includes(selected.status);
  const approvalDisabled = busy || selected?.status !== 'MATCHED' || !selected?.matchedEmployeeId;

  return <section className="registration-review" aria-label="คำขอลงทะเบียนแบบส่วนตัว">
    <header className="registration-review__header">
      <div><h2>คำขอลงทะเบียน</h2><span>ตรวจสอบข้อมูลผู้สมัครและจับคู่กับ Employee Master ก่อนตัดสินใจอนุมัติบัญชี</span></div>
      <button type="button" className="btn-neutral registration-review__refresh" disabled={loading} onClick={() => void load()}><SmsIcon name="history" size={17} />รีเฟรช</button>
    </header>
    {error && <div className="registration-review__feedback registration-review__feedback--error" role="alert" aria-live="assertive"><SmsIcon name="shield" size={18} /><span>{error}</span></div>}
    {message && <div className="registration-review__feedback registration-review__feedback--success" role="status" aria-live="polite"><SmsIcon name="approval" size={18} /><span>{message}</span></div>}
    <div className={`registration-review__grid ${mobileDetail ? 'is-mobile-detail' : ''}`}>
      <aside className="registration-review__requests" aria-label="รายการคำขอลงทะเบียน">
        <div className="registration-review__section-heading"><div><h3>รายการคำขอ</h3></div><strong>{loading ? '…' : rows.length}</strong></div>
        {loading ? <p className="registration-review__loading" role="status">กำลังโหลดคำขอ…</p> : rows.length ? <div className="registration-review__request-list">{rows.map((row) => {
          const createdAt = formatRequestDate(row.createdAt);
          return <button type="button" key={row.id} className={`registration-review__request registration-review__request--${requestTone[row.status] || 'neutral'} ${row.id === selectedId ? 'is-selected' : ''}`} aria-pressed={row.id === selectedId} onClick={() => selectRequest(row.id)}>
            <span className="registration-review__request-top"><strong>{row.submittedName}</strong><em className={`registration-review__status registration-review__status--${requestTone[row.status] || 'neutral'}`}>{requestStatus[row.status] || row.status}</em></span>
            <span className="registration-review__request-email">{row.email}</span>
            <small>{row.departmentHint || 'ไม่ระบุหน่วยงาน'}{createdAt ? ` · ${createdAt}` : ''}</small>
          </button>;
        })}</div> : <p className="registration-review__empty">ยังไม่มีคำขอที่ยืนยันอีเมลแล้ว</p>}
      </aside>

      <div className="registration-review__detail">
        {!selected ? <div className="registration-review__empty registration-review__empty--detail"><SmsIcon name="users" size={24} /><strong>เลือกคำขอเพื่อเริ่มตรวจสอบ</strong><span>เลือกรายการด้านซ้ายเพื่อดูข้อมูลที่ผู้สมัครแจ้งและค้นหา Employee Master</span></div> : <>
          <button type="button" className="registration-review__mobile-back" onClick={() => setMobileDetail(false)}>กลับไปรายการคำขอ</button>
          <section className="registration-review__summary" aria-labelledby="registration-review-summary-title">
            <div className="registration-review__summary-heading"><div><h3 id="registration-review-summary-title">ข้อมูลที่ผู้สมัครแจ้ง</h3></div><em className={`registration-review__status registration-review__status--${requestTone[selected.status] || 'neutral'}`}>{requestStatus[selected.status] || selected.status}</em></div>
            <p className="registration-review__summary-help">ข้อมูลที่ผู้สมัครแจ้ง ใช้ประกอบการตรวจสอบเท่านั้น ไม่ใช่ข้อมูลยืนยันตัวบุคคลจาก Employee Master</p>
            <dl className="registration-review__facts">
              <div><dt>ชื่อที่ผู้สมัครแจ้ง</dt><dd>{selected.submittedName}</dd></div>
              <div><dt>อีเมล</dt><dd>{selected.email}</dd></div>
              <div><dt>หน่วยงาน / พื้นที่</dt><dd>{selected.departmentHint || '-'}</dd></div>
              <div><dt>สถานะคำขอ</dt><dd>{requestStatus[selected.status] || selected.status}</dd></div>
            </dl>
          </section>

          <ReviewProgress status={selected.status} candidateSelected={Boolean(selectedCandidate)} />

          {selected.matchedEmployee && <section className="registration-review__matched" aria-label="Employee Master ที่จับคู่แล้ว">
            <div className="registration-review__matched-icon"><SmsIcon name="approval" size={20} /></div>
            <div><span>จับคู่ Employee Master แล้ว</span><strong>{candidateName(selected.matchedEmployee)}</strong><p><b>{selected.matchedEmployee.employeeCode}</b><small>{selected.matchedEmployee.department || '-'} · {selected.matchedEmployee.jobTitle || '-'}</small></p><em>การจับคู่พนักงานยังไม่ใช่การอนุมัติบัญชี</em></div>
          </section>}

          {terminal ? <section className={`registration-review__terminal registration-review__terminal--${requestTone[selected.status]}`}>
            <SmsIcon name={selected.status === 'APPROVED' ? 'approval' : 'shield'} size={21} />
            <div><strong>{selected.status === 'APPROVED' ? 'คำขอนี้ได้รับการอนุมัติแล้ว' : 'คำขอนี้ถูกบันทึกว่าไม่อนุมัติแล้ว'}</strong><span>รายการนี้เป็นประวัติการตรวจสอบและไม่มีการดำเนินการเพิ่มเติมจากหน้านี้</span></div>
          </section> : <>
            <section className="registration-review__employee-workspace" aria-labelledby="registration-review-employee-title">
              <header><div><span>Employee Master</span><h3 id="registration-review-employee-title">ค้นหาและตรวจสอบพนักงาน</h3></div><SmsIcon name="search" size={20} /></header>
              <label className="registration-review__search-label" htmlFor="registration-employee-search">ค้นหา Employee Master</label>
              <div className="registration-review__search"><input id="registration-employee-search" placeholder="ค้นหาชื่อหรือรหัสพนักงาน (อย่างน้อย 2 ตัวอักษร)" value={search} onChange={(event) => setSearch(event.target.value)} /><button type="button" className="btn-neutral" disabled={candidateLoading || search.trim().length < 2} onClick={() => void runSearch(true)}>{candidateLoading ? 'กำลังค้นหา…' : 'ค้นหา'}</button></div>

              {matchState === 'EMPLOYEE_NOT_FOUND' && <div className="registration-review__not-found" role="status"><SmsIcon name="search" size={20} /><div><strong>ไม่พบพนักงานใน Employee Master</strong><p>คำขอยังคงรอตรวจสอบ กรุณาสร้างพนักงานผ่าน Employee Master ตามสิทธิ์ปกติ แล้วกลับมารีเฟรชหรือค้นหาใหม่</p>{role === 'ADMIN' && <button type="button" className="btn-neutral" onClick={onOpenEmployeeMaster}>ไปที่ Employee Master</button>}</div></div>}

              {candidateLoading ? <p className="registration-review__loading" role="status">กำลังค้นหา Employee Master…</p> : candidates.length > 0 && <div className="registration-review__candidates" aria-label="ผลการค้นหา Employee Master">{candidates.map((candidate) => {
                const isSelected = candidate.id === selectedCandidateId;
                return <article key={candidate.id} className={isSelected ? 'is-selected' : ''}>
                  <div className="registration-review__candidate-main"><span className="registration-review__candidate-avatar" aria-hidden="true"><SmsIcon name="users" size={18} /></span><div><strong>{candidateName(candidate)}</strong><span>{candidate.employeeCode}</span><small>{candidate.department || '-'} · {candidate.jobTitle || '-'}</small></div></div>
                  <button type="button" className="btn-neutral" aria-pressed={isSelected} disabled={busy} onClick={() => setSelectedCandidateId(candidate.id)}>{isSelected ? 'เลือกแล้ว' : 'เลือกพนักงาน'}</button>
                </article>;
              })}</div>}
            </section>

            {selectedCandidate && <section className="registration-review__comparison" aria-labelledby="registration-review-comparison-title">
              <header><div><h3 id="registration-review-comparison-title">เปรียบเทียบก่อนจับคู่</h3></div><p>ตรวจสอบข้อมูลทั้งสองฝั่งก่อนยืนยันการเชื่อมโยงกับ Employee Master</p></header>
              <div className="registration-review__compare-grid">
                <article><span>ข้อมูลผู้สมัคร</span><dl><div><dt>ชื่อที่แจ้ง</dt><dd>{selected.submittedName}</dd></div><div><dt>หน่วยงานที่แจ้ง</dt><dd>{selected.departmentHint || '-'}</dd></div></dl></article>
                <article><span>Employee Master</span><dl><div><dt>ชื่อพนักงาน</dt><dd>{candidateName(selectedCandidate)}</dd></div><div><dt>หน่วยงาน</dt><dd>{selectedCandidate.department || '-'}</dd></div><div><dt>รหัสภายใน</dt><dd>{selectedCandidate.employeeCode}</dd></div><div><dt>ตำแหน่ง</dt><dd>{selectedCandidate.jobTitle || '-'}</dd></div></dl></article>
              </div>
              <div className="registration-review__match-action"><p><SmsIcon name="shield" size={16} />การเลือกนี้เป็นการตรวจสอบโดยผู้มีสิทธิ์ ไม่ใช่การยืนยันตัวตนอัตโนมัติ</p><button type="button" className="btn-primary" disabled={busy} onClick={() => void match(selectedCandidate.id)}>{busy ? 'กำลังจับคู่…' : 'จับคู่พนักงาน'}</button></div>
            </section>}

            <section className="registration-review__approval" aria-labelledby="registration-review-approval-title">
              <div className="registration-review__role-note"><span>สิทธิ์เริ่มต้นหลังอนุมัติ</span><strong id="registration-review-approval-title">VIEWER</strong><small>การเปลี่ยนสิทธิ์ภายหลังดำเนินการผ่านเมนูผู้ใช้และสิทธิ์</small></div>
              <div className="registration-review__actions"><button ref={rejectTriggerRef} type="button" className="registration-review__reject" disabled={busy} onClick={(event) => openReject(event.currentTarget)}>ไม่อนุมัติ</button><button type="button" className="btn-success" disabled={approvalDisabled} onClick={() => void approve()}>อนุมัติเป็น VIEWER</button></div>
            </section>
          </>}
        </>}
      </div>
    </div>

    {rejectOpen && selected && <div className="registration-review__dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeReject(); }}>
      <section className="registration-review__dialog" role="dialog" aria-modal="true" aria-labelledby="registration-reject-title" aria-describedby="registration-reject-context">
        <header><div><span>REJECT REGISTRATION REQUEST</span><h2 id="registration-reject-title">ไม่อนุมัติคำขอ</h2></div><button type="button" className="registration-review__dialog-close" onClick={closeReject} aria-label="ปิดหน้าต่างไม่อนุมัติคำขอ"><SmsIcon name="close" size={19} /></button></header>
        <div className="registration-review__dialog-body">
          <div className="registration-review__dialog-context" id="registration-reject-context"><span>คำขอของ</span><strong>{selected.submittedName}</strong><small>{selected.email}</small></div>
          <label htmlFor="registration-reject-reason">เหตุผลที่ไม่อนุมัติ</label>
          <textarea ref={rejectTextareaRef} id="registration-reject-reason" value={rejectReason} onChange={(event) => { setRejectReason(event.target.value); if (rejectValidation) setRejectValidation(''); }} rows={5} aria-invalid={Boolean(rejectValidation)} aria-describedby={rejectValidation ? 'registration-reject-validation' : undefined} />
          {rejectValidation && <p className="registration-review__dialog-error" id="registration-reject-validation" role="alert">{rejectValidation}</p>}
        </div>
        <footer><button type="button" className="btn-neutral" disabled={busy} onClick={closeReject}>ยกเลิก</button><button type="button" className="btn-danger" disabled={busy} onClick={() => void reject()}>{busy ? 'กำลังบันทึก…' : 'ไม่อนุมัติคำขอ'}</button></footer>
      </section>
    </div>}
  </section>;
}
