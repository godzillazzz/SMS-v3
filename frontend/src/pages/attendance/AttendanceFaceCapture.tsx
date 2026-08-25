import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SmsIcon } from '../../components/SmsIcon';

type Props = {
  open: boolean;
  busy?: boolean;
  onConfirm: (photo: Blob) => Promise<void>;
  onClose: () => void;
};

const MAX_CAPTURE_EDGE = 960;
const JPEG_QUALITY = 0.82;

function cameraErrorMessage(reason: unknown) {
  const name = reason instanceof DOMException ? reason.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'ไม่ได้รับสิทธิ์กล้องหน้า กรุณาอนุญาต Camera สำหรับเว็บไซต์นี้';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'ไม่พบกล้องหน้าที่พร้อมใช้งานบนอุปกรณ์นี้';
  if (name === 'NotReadableError') return 'กล้องกำลังถูกใช้งานโดยแอปอื่น กรุณาปิดแอปกล้องแล้วลองใหม่';
  return reason instanceof Error ? reason.message : 'ไม่สามารถเปิดกล้องหน้าได้';
}

export function AttendanceFaceCapture({ open, busy = false, onConfirm, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const cameraRequestEpochRef = useRef(0);
  const onCloseRef = useRef(onClose);
  const [starting, setStarting] = useState(false);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  onCloseRef.current = onClose;

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const purgeCanvas = () => {
    if (!canvasRef.current) return;
    canvasRef.current.width = 1;
    canvasRef.current.height = 1;
  };

  const clearPhoto = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setPhoto(null);
    purgeCanvas();
  };

  const startCamera = async () => {
    const cameraEpoch = cameraRequestEpochRef.current + 1;
    cameraRequestEpochRef.current = cameraEpoch;
    setError(undefined);
    setStarting(true);
    stopStream();
    clearPhoto();
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('เบราว์เซอร์นี้ไม่รองรับกล้องที่ระบบต้องใช้');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'user' },
          width: { ideal: 720 },
          height: { ideal: 960 }
        }
      });
      if (cameraEpoch !== cameraRequestEpochRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (!videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        return;
      }
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    } catch (reason) {
      if (cameraEpoch !== cameraRequestEpochRef.current) return;
      stopStream();
      setError(cameraErrorMessage(reason));
    } finally {
      if (cameraEpoch === cameraRequestEpochRef.current) setStarting(false);
    }
  };

  useEffect(() => {
    if (!open) {
      cameraRequestEpochRef.current += 1;
      stopStream();
      clearPhoto();
      setError(undefined);
      return;
    }
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    void startCamera();

    const stopAndCloseForLifecycle = () => {
      cameraRequestEpochRef.current += 1;
      stopStream();
      clearPhoto();
      document.body.style.overflow = previousBodyOverflow;
      onCloseRef.current();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') stopAndCloseForLifecycle();
    };
    const handlePageHide = () => stopAndCloseForLifecycle();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      cameraRequestEpochRef.current += 1;
      stopStream();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
      purgeCanvas();
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [open]);


  const capture = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setError('ภาพจากกล้องหน้ายังไม่พร้อม กรุณารอสักครู่แล้วลองใหม่');
      return;
    }
    const scale = Math.min(1, MAX_CAPTURE_EDGE / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      setError('ไม่สามารถเตรียมภาพสดสำหรับตรวจใบหน้าได้');
      purgeCanvas();
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    purgeCanvas();
    if (!blob || blob.size < 64) {
      setError('ถ่ายภาพสดไม่สำเร็จ กรุณาลองใหม่');
      return;
    }
    stopStream();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const nextUrl = URL.createObjectURL(blob);
    previewUrlRef.current = nextUrl;
    setPhoto(blob);
    setPreviewUrl(nextUrl);
    setError(undefined);
  };

  const retake = async () => {
    if (busy) return;
    clearPhoto();
    await startCamera();
  };

  const confirm = async () => {
    if (!photo || busy) return;
    setError(undefined);
    try {
      await onConfirm(photo);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ไม่สามารถตรวจใบหน้าได้');
    }
  };

  if (!open) return null;

  return createPortal(<div className="attendance-face-backdrop" role="presentation">
    <section className="attendance-face-dialog" role="dialog" aria-modal="true" aria-labelledby="attendance-face-title">
      <header>
        <div><p>LIVE FACE · MEMORY ONLY</p><h2 id="attendance-face-title">ถ่ายภาพสดยืนยันใบหน้า</h2><span>ใช้กล้องหน้าเท่านั้น ภาพอยู่ชั่วคราวในหน่วยความจำและไม่บันทึกลงเครื่องหรือ Storage ในรอบนี้</span></div>
        <button type="button" className="drawer-close overlay-close" disabled={busy} onClick={() => onClose()} aria-label="ปิด"><SmsIcon name="close" size={20} /></button>
      </header>

      <div className="attendance-face-camera">
        {previewUrl
          ? <img src={previewUrl} alt="ภาพสดสำหรับตรวจสอบก่อนส่ง" />
          : <video ref={videoRef} playsInline muted autoPlay />}
        <canvas ref={canvasRef} className="attendance-face-canvas" aria-hidden="true" />
        {!previewUrl && <div className="attendance-face-guide" aria-hidden="true"><span /></div>}
        {starting && <div className="attendance-face-status"><SmsIcon name="clock" size={22} /><span>กำลังเปิดกล้องหน้า…</span></div>}
      </div>

      {error && <div className="alert alert-error attendance-face-error" role="alert">{error}</div>}
      <div className="attendance-face-privacy"><SmsIcon name="shield" size={17} /><span>ไม่มี file picker / Gallery และไม่มี localStorage, sessionStorage หรือ IndexedDB สำหรับภาพสดนี้ เมื่อปิด/ออกจากแอป/สลับหน้าจอ ระบบจะทิ้งภาพและหยุดกล้องทันที</span></div>

      <footer>
        {previewUrl
          ? <><button type="button" className="btn-neutral" disabled={busy} onClick={() => void retake()}>ถ่ายใหม่</button><button type="button" className="btn-primary" disabled={busy || !photo} onClick={() => void confirm()}><SmsIcon name="shield" size={17} />{busy ? 'กำลังส่งให้ Server ตรวจ…' : 'ยืนยันและตรวจใบหน้า'}</button></>
          : <><button type="button" className="btn-neutral" disabled={busy} onClick={() => onClose()}>ยกเลิก</button><button type="button" className="btn-primary" disabled={busy || starting || Boolean(error)} onClick={() => void capture()}><SmsIcon name="quality" size={17} />ถ่ายภาพสด</button></>}
      </footer>
    </section>
  </div>, document.body);
}
