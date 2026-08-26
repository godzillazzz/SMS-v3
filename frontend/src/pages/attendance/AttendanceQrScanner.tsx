import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import jsQR from 'jsqr';
import { SmsIcon } from '../../components/SmsIcon';

type Props = {
  open: boolean;
  onDetected: (qrToken: string) => void;
  onClose: () => void;
  autoFlow?: boolean;
  onFailure?: (message: string) => void;
};

type ScannerState = 'STARTING' | 'SCANNING' | 'ERROR';

const MIN_QR_LENGTH = 24;
const MAX_QR_LENGTH = 512;
const SCAN_INTERVAL_MS = 220;
const MAX_DECODE_WIDTH = 720;
const AUTO_FLOW_TIMEOUT_MS = 30000;

function cameraErrorMessage(error: unknown) {
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name || '') : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'ไม่ได้รับสิทธิ์ใช้กล้อง กรุณาอนุญาต Camera สำหรับเว็บไซต์นี้แล้วลองใหม่';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'ไม่พบกล้องที่สามารถใช้สแกน QR บนอุปกรณ์นี้';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'กล้องกำลังถูกใช้งานโดยแอปอื่น กรุณาปิดแอปที่ใช้กล้องแล้วลองใหม่';
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return 'ไม่สามารถเปิดกล้องด้วยค่าที่ร้องขอได้ กรุณาลองใหม่';
  return 'ไม่สามารถเปิดกล้องสำหรับสแกน QR ได้ กรุณาลองใหม่หรือใช้ช่องกรอก QR ด้านหลัง';
}

export function AttendanceQrScanner({ open, onDetected, onClose, autoFlow = false, onFailure }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onDetectedRef = useRef(onDetected);
  const onCloseRef = useRef(onClose);
  const [state, setState] = useState<ScannerState>('STARTING');
  const [error, setError] = useState<string>();

  useEffect(() => { onDetectedRef.current = onDetected; }, [onDetected]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    let active = true;
    let stream: MediaStream | null = null;
    let scanTimer: number | undefined;
    let autoFlowTimeout: number | undefined;
    let decoding = false;
    let lastRejectedValue = '';

    const stop = () => {
      if (scanTimer !== undefined) window.clearInterval(scanTimer);
      if (autoFlowTimeout !== undefined) window.clearTimeout(autoFlowTimeout);
      scanTimer = undefined;
      autoFlowTimeout = undefined;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      }
      if (canvasRef.current) {
        canvasRef.current.width = 1;
        canvasRef.current.height = 1;
      }
    };

    const stopAndCloseForLifecycle = () => {
      if (!active) return;
      active = false;
      stop();
      document.body.style.overflow = previousBodyOverflow;
      onCloseRef.current();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') stopAndCloseForLifecycle();
    };
    const handlePageHide = () => stopAndCloseForLifecycle();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    const scanFrame = () => {
      if (!active || decoding) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return;

      decoding = true;
      try {
        const scale = Math.min(1, MAX_DECODE_WIDTH / video.videoWidth);
        const width = Math.max(1, Math.round(video.videoWidth * scale));
        const height = Math.max(1, Math.round(video.videoHeight * scale));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('QR_CANVAS_CONTEXT_UNAVAILABLE');
        context.drawImage(video, 0, 0, width, height);
        const frame = context.getImageData(0, 0, width, height);
        const decoded = jsQR(frame.data, width, height, { inversionAttempts: 'attemptBoth' });
        const value = decoded?.data?.trim() || '';
        if (!value) return;

        if (value.length < MIN_QR_LENGTH || value.length > MAX_QR_LENGTH) {
          if (value !== lastRejectedValue) {
            lastRejectedValue = value;
            setError('พบ QR แต่รูปแบบข้อมูลไม่ตรงกับ Attendance Site QR กรุณาสแกนป้ายที่จุดปฏิบัติงาน');
          }
          return;
        }

        stop();
        if (!active) return;
        onDetectedRef.current(value);
      } catch (reason) {
        if (!active) return;
        setState('ERROR');
        setError(reason instanceof Error && reason.message === 'QR_CANVAS_CONTEXT_UNAVAILABLE'
          ? 'เบราว์เซอร์ไม่สามารถประมวลผลภาพจากกล้องเพื่ออ่าน QR ได้'
          : 'เกิดข้อผิดพลาดระหว่างอ่าน QR กรุณาปิดกล้องแล้วลองใหม่');
      } finally {
        decoding = false;
      }
    };

    const start = async () => {
      setState('STARTING');
      setError(undefined);
      if (!window.isSecureContext) {
        setState('ERROR');
        setError('การสแกน QR ต้องเปิดระบบผ่าน HTTPS เพื่ออนุญาตการใช้กล้องอย่างปลอดภัย');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setState('ERROR');
        setError('เบราว์เซอร์นี้ไม่รองรับ Camera API กรุณาใช้ช่องกรอก QR ด้านหลัง');
        return;
      }

      try {
        const nextStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });
        if (!active) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = nextStream;
        const video = videoRef.current;
        if (!video) {
          stop();
          return;
        }
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();
        if (!active) {
          stop();
          return;
        }
        setState('SCANNING');
        scanTimer = window.setInterval(scanFrame, SCAN_INTERVAL_MS);
        if (autoFlow) {
          autoFlowTimeout = window.setTimeout(() => {
            if (!active) return;
            const message = 'ยังสแกน QR ของ Site ไม่สำเร็จภายในเวลาที่กำหนด กรุณากด “ลงเวลา” แล้วลองใหม่';
            onFailure?.(message);
            stopAndCloseForLifecycle();
          }, AUTO_FLOW_TIMEOUT_MS);
        }
      } catch (reason) {
        stop();
        if (!active) return;
        setState('ERROR');
        const message = cameraErrorMessage(reason);
        setError(message);
        if (autoFlow) { onFailure?.(message); onCloseRef.current(); }
      }
    };

    void start();
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      stop();
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [open, autoFlow]);

  if (!open) return null;

  return createPortal(<div className="attendance-qr-backdrop" role="presentation" onMouseDown={(event) => { if (!autoFlow && event.target === event.currentTarget) onClose(); }}>
    <section className="attendance-qr-dialog" role="dialog" aria-modal="true" aria-labelledby="attendance-qr-title">
      <header>
        <div><p>ยืนยันพื้นที่</p><h2 id="attendance-qr-title">สแกน QR จุดปฏิบัติงาน</h2><span>เล็งกล้องไปที่ QR บริเวณจุดปฏิบัติงาน ระบบจะอ่านให้อัตโนมัติ</span></div>
        {!autoFlow && <button type="button" className="drawer-close overlay-close" onClick={onClose} aria-label="ปิดกล้องสแกน QR"><SmsIcon name="close" size={20} /></button>}
      </header>

      <div className={`attendance-qr-camera ${state === 'ERROR' ? 'has-error' : ''}`}>
        <video ref={videoRef} autoPlay muted playsInline aria-label="ภาพจากกล้องสำหรับสแกน QR" />
        <canvas ref={canvasRef} className="attendance-qr-decode-canvas" aria-hidden="true" />
        {state !== 'ERROR' && <div className="attendance-qr-target" aria-hidden="true"><span /><span /><span /><span /></div>}
        {state === 'STARTING' && <div className="attendance-qr-camera-status"><SmsIcon name="refresh" size={22} /><strong>กำลังเปิดกล้อง…</strong></div>}
        {state === 'SCANNING' && <div className="attendance-qr-scan-hint">เล็ง QR ให้อยู่ภายในกรอบ</div>}
        {state === 'ERROR' && <div className="attendance-qr-camera-status is-error"><SmsIcon name="shield" size={22} /><strong>ไม่สามารถสแกนด้วยกล้องได้</strong></div>}
      </div>

      {error && <div className="alert alert-error attendance-qr-error" role="alert">{error}</div>}
      <div className="attendance-qr-privacy"><SmsIcon name="shield" size={17} /><span>ใช้กล้องเฉพาะขณะสแกน QR และไม่บันทึกภาพหรือวิดีโอจากกล้อง</span></div>
      {!autoFlow && <footer><button type="button" className="btn-neutral" onClick={onClose}>ปิดกล้อง / กรอก QR เอง</button></footer>}
    </section>
  </div>, document.body);
}
