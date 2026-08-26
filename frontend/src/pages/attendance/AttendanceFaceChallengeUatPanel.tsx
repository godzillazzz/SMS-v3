import { useState } from 'react';
import { SmsIcon } from '../../components/SmsIcon';
import {
  AttendanceFlowError,
  attendanceFaceChallengeUatCapture,
  attendanceFaceChallengeUatStart,
  type AttendanceActiveChallenge
} from './attendance-client';
import { AttendanceFaceCapture } from './AttendanceFaceCapture';

type Props = {
  token: string;
  online: boolean;
  readOnly: boolean;
};

type UatAttempt = {
  attemptId: string;
  activeChallenge: AttendanceActiveChallenge;
};

const FACE_CHALLENGE_UAT_ENABLED = import.meta.env.VITE_G06_FACE_CHALLENGE_UAT === 'true';

export function AttendanceFaceChallengeUatPanel({ token, online, readOnly }: Props) {
  const [attempt, setAttempt] = useState<UatAttempt | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  if (!FACE_CHALLENGE_UAT_ENABLED) return null;

  const blocked = readOnly || !online || busy;

  const resetAttempt = () => {
    if (busy) return;
    setCameraOpen(false);
    setAttempt(null);
    setMessage(undefined);
    setError(undefined);
  };

  const startUat = async () => {
    if (blocked) return;
    setBusy(true);
    setMessage(undefined);
    setError(undefined);
    try {
      const started = await attendanceFaceChallengeUatStart(token);
      if (
        started.uatOnly !== true
        || started.verifierCalled !== false
        || started.verificationAccepted !== false
        || started.attendanceAccepted !== false
        || started.retained !== false
        || !started.attemptId
        || !started.activeChallenge
        || started.activeChallenge.frameCount !== 4
      ) {
        throw new Error('Server ส่งสถานะ UAT ที่ไม่ปลอดภัย ระบบหยุดแบบ fail-closed');
      }
      setAttempt({ attemptId: started.attemptId, activeChallenge: started.activeChallenge });
      setCameraOpen(true);
    } catch (reason) {
      if (reason instanceof AttendanceFlowError) setError(reason.message);
      else setError(reason instanceof Error ? reason.message : 'ไม่สามารถเริ่ม Active Challenge UAT ได้');
    } finally {
      setBusy(false);
    }
  };

  const submitCapture = async ({ photo, challengeFrames }: { photo: Blob; challengeFrames: Blob[] }) => {
    if (!attempt) throw new Error('UAT attempt ไม่พร้อม กรุณาเริ่มใหม่');
    setBusy(true);
    setMessage(undefined);
    setError(undefined);
    try {
      const result = await attendanceFaceChallengeUatCapture(token, attempt.attemptId, photo, challengeFrames);
      if (
        result.uatOnly !== true
        || result.captureReceived !== true
        || result.verifierCalled !== false
        || result.verificationAccepted !== false
        || result.attendanceAccepted !== false
        || result.receipt !== null
        || result.retained !== false
      ) {
        throw new Error('UAT response พยายามยกระดับเป็นผลยืนยันตัวตน ระบบปฏิเสธแบบ fail-closed');
      }
      setCameraOpen(false);
      setAttempt(null);
      setMessage('ทดสอบกล้องหน้า + Active Challenge สำเร็จ: Server รับชุดภาพชั่วคราวแล้วทิ้งทันที โดยไม่ได้เรียก Face Verifier, ไม่ออก receipt และไม่สร้าง AttendanceEvent');
    } catch (reason) {
      const text = reason instanceof AttendanceFlowError
        ? reason.message
        : reason instanceof Error
          ? reason.message
          : 'ไม่สามารถส่งชุดภาพ Active Challenge UAT ได้';
      setError(text);
      throw reason;
    } finally {
      setBusy(false);
    }
  };

  return <section className="attendance-uat-card" aria-label="Active Challenge Preview UAT">
    <AttendanceFaceCapture
      open={cameraOpen && online && !readOnly}
      busy={busy}
      challenge={attempt?.activeChallenge || null}
      rehearsalOnly
      onConfirm={submitCapture}
      onClose={() => {
        if (busy) return;
        setCameraOpen(false);
        setAttempt(null);
      }}
    />

    <header>
      <span className="attendance-uat-card__icon"><SmsIcon name="quality" size={21} /></span>
      <div>
        <p className="eyebrow">PREVIEW UAT · NO FACE PASS · NO ATTENDANCE WRITE</p>
        <h2>ทดสอบกล้องหน้า + Active Challenge</h2>
        <p>ใช้ตรวจการเปิดกล้องหน้า คำสั่งสุ่มจาก Server การเก็บ 4 เฟรม + final still และ lifecycle clearing บนอุปกรณ์จริงเท่านั้น</p>
      </div>
    </header>

    <div className="attendance-uat-boundary">
      <SmsIcon name="shield" size={18} />
      <span>โหมดนี้ไม่เรียก Face Verifier, ไม่เทียบ Reference Photo, ไม่ออก verification receipt และไม่สร้าง AttendanceEvent ภาพอยู่ชั่วคราวใน RAM และ Server zero/ทิ้ง buffer หลังรับคำขอ</span>
    </div>

    {!online && <div className="alert alert-error">ออฟไลน์ — Active Challenge UAT ต้องเชื่อมต่อ Preview Server</div>}
    {readOnly && <div className="settings-notice">View As เป็น read-only — ไม่อนุญาตให้เปิดกล้อง UAT แทนผู้ใช้งาน</div>}
    {error && <div className="alert alert-error" role="alert">{error}</div>}
    {message && <div className="attendance-uat-success" role="status"><SmsIcon name="check" size={18} /><span>{message}</span></div>}

    <footer>
      {attempt && !cameraOpen
        ? <button type="button" className="btn-neutral" disabled={blocked} onClick={() => setCameraOpen(true)}>เปิดกล้อง UAT อีกครั้ง</button>
        : null}
      <button type="button" className="btn-primary" disabled={blocked} onClick={() => void startUat()}>
        <SmsIcon name="quality" size={17} />{busy ? 'กำลังเตรียม UAT…' : 'เริ่มทดสอบ Active Challenge'}
      </button>
      {(attempt || message || error) && <button type="button" className="btn-neutral" disabled={busy} onClick={resetAttempt}>ล้างผล UAT</button>}
    </footer>
  </section>;
}
