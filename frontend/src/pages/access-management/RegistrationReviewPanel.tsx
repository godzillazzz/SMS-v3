import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
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

export function RegistrationReviewPanel({ token, role, refreshSignal, onChanged, onOpenEmployeeMaster }: Props) {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [matchState, setMatchState] = useState('');
  const [loading, setLoading] = useState(false);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const selected = useMemo(() => rows.find((row) => row.id === selectedId), [rows, selectedId]);

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
    setCandidateLoading(true); setError(''); setMessage('');
    try {
      const result = await api.registrationCandidates(token, selected.id, manual ? search.trim() : '');
      setCandidates(Array.isArray(result?.data) ? result.data : []);
      setMatchState(String(result?.meta?.employeeMatchState || ''));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'ค้นหา Employee Master ไม่สำเร็จ'); }
    finally { setCandidateLoading(false); }
  };

  useEffect(() => {
    setSearch(''); setCandidates([]); setMatchState(''); setMessage(''); setError('');
    if (selected && ['PENDING', 'MATCHED'].includes(selected.status)) void runSearch(false);
  }, [selectedId]);

  if (!['ADMIN', 'MANAGER'].includes(role)) return null;

  const match = async (employeeId: string) => {
    if (!selected) return;
    setBusy(true); setError(''); setMessage('');
    try { await api.matchRegistrationRequest(token, selected.id, employeeId); setMessage('จับคู่ Employee Master แล้ว'); await load(); onChanged(); }
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
  const reject = async () => {
    if (!selected) return;
    const reason = window.prompt('เหตุผลที่ไม่อนุมัติคำขอ');
    if (!reason || reason.trim().length < 3) return;
    setBusy(true); setError(''); setMessage('');
    try { await api.rejectRegistrationRequest(token, selected.id, reason.trim()); setMessage('บันทึกการไม่อนุมัติแล้ว'); await load(); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'ไม่สามารถบันทึกได้'); }
    finally { setBusy(false); }
  };

  return <section className="registration-review" aria-label="คำขอลงทะเบียนแบบส่วนตัว">
    <header className="registration-review__header">
      <div><p>PRIVATE REGISTRATION REVIEW</p><h2>คำขอลงทะเบียนแบบส่วนตัว</h2><span>ผู้สมัครไม่สามารถเลือก Employee หรือกำหนด Role เองได้ ผู้ตรวจสอบต้องจับคู่ Employee Master ก่อนอนุมัติ</span></div>
      <button type="button" className="btn-neutral" disabled={loading} onClick={() => void load()}>↻ รีเฟรชคำขอ</button>
    </header>
    {error && <div className="alert alert-error" role="alert">{error}</div>}
    {message && <div className="access-notice" role="status">✓ {message}</div>}
    <div className="registration-review__grid">
      <div className="registration-review__requests">
        <h3>รายการคำขอ</h3>
        {loading ? <p>กำลังโหลด…</p> : rows.length ? rows.map((row) => <button type="button" key={row.id} className={row.id === selectedId ? 'is-selected' : ''} onClick={() => setSelectedId(row.id)}>
          <strong>{row.submittedName}</strong><span>{row.email}</span><small>{row.departmentHint || 'ไม่ระบุหน่วยงาน'} · {requestStatus[row.status] || row.status}</small>
        </button>) : <p className="registration-review__empty">ยังไม่มีคำขอที่ยืนยันอีเมลแล้ว</p>}
      </div>
      <div className="registration-review__detail">
        {!selected ? <p className="registration-review__empty">เลือกคำขอเพื่อเริ่มตรวจสอบ</p> : <>
          <div className="registration-review__facts"><div><span>ชื่อที่ผู้สมัครแจ้ง</span><strong>{selected.submittedName}</strong></div><div><span>อีเมล</span><strong>{selected.email}</strong></div><div><span>หน่วยงาน (hint)</span><strong>{selected.departmentHint || '-'}</strong></div><div><span>สถานะ</span><strong>{requestStatus[selected.status] || selected.status}</strong></div></div>
          {selected.matchedEmployee && <div className="registration-review__matched"><span>Employee ที่จับคู่แล้ว</span><strong>{candidateName(selected.matchedEmployee)} ({selected.matchedEmployee.employeeCode})</strong><small>{selected.matchedEmployee.department || '-'} · {selected.matchedEmployee.jobTitle || '-'}</small></div>}
          {['PENDING', 'MATCHED'].includes(selected.status) && <>
            <div className="registration-review__search"><input aria-label="ค้นหา Employee Master" placeholder="ค้นหาชื่อหรือรหัสพนักงาน (อย่างน้อย 2 ตัวอักษร)" value={search} onChange={(event) => setSearch(event.target.value)} /><button type="button" className="btn-neutral" disabled={candidateLoading || search.trim().length < 2} onClick={() => void runSearch(true)}>ค้นหา</button></div>
            {matchState === 'EMPLOYEE_NOT_FOUND' && <div className="registration-review__not-found"><strong>ไม่พบพนักงานใน Employee Master</strong><p>คำขอยังคง PENDING กรุณาสร้างพนักงานผ่าน Employee Master ตามสิทธิ์ปกติ แล้วกลับมารีเฟรช/ค้นหาใหม่</p>{role === 'ADMIN' && <button type="button" className="btn-neutral" onClick={onOpenEmployeeMaster}>ไปที่ Employee Master</button>}</div>}
            {candidateLoading ? <p>กำลังค้นหา…</p> : candidates.length > 0 && <div className="registration-review__candidates">{candidates.map((candidate) => <article key={candidate.id}><div><strong>{candidateName(candidate)}</strong><span>{candidate.employeeCode}</span><small>{candidate.department || '-'} · {candidate.jobTitle || '-'}</small></div><button type="button" className="btn-primary compact" disabled={busy} onClick={() => void match(candidate.id)}>Match</button></article>)}</div>}
            <div className="registration-review__role-note"><span>สิทธิ์เริ่มต้นหลังอนุมัติ</span><strong>VIEWER</strong><small>ไม่มี role picker ในขั้นตอนอนุมัติ การเปลี่ยน Role ภายหลังใช้เมนูจัดการสิทธิ์แยกต่างหาก</small></div>
            <div className="registration-review__actions"><button type="button" className="btn-neutral" disabled={busy} onClick={() => void reject()}>ไม่อนุมัติ</button><button type="button" className="btn-success" disabled={busy || selected.status !== 'MATCHED' || !selected.matchedEmployeeId} onClick={() => void approve()}>อนุมัติเป็น VIEWER</button></div>
          </>}
        </>}
      </div>
    </div>
  </section>;
}
