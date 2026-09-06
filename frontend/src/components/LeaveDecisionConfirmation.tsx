import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { acquireDocumentScrollLock } from '../document-scroll-lock';
import { RequestErrorContent, type RequestErrorInput } from '../request-error';

export type LeaveDecisionAction = 'approve' | 'reject' | 'return' | 'cancel';

export type LeaveDecisionTarget = {
  employeeName: string;
  department: string;
  leaveType: string;
  dateRange: string;
  dayCount: string;
  reason: string;
  substitute: string;
  status: string;
};

type DecisionPresentation = {
  title: string;
  eyebrow: string;
  consequence: string;
  confirmLabel: string;
  tone: 'success' | 'warning' | 'danger';
  requiresReason: boolean;
  reasonLabel?: string;
};

export const leaveDecisionPresentation = (action: LeaveDecisionAction, status = ''): DecisionPresentation => {
  if (action === 'approve') return {
    title: 'ยืนยันอนุมัติคำขอลา',
    eyebrow: 'ยืนยันการอนุมัติ',
    consequence: 'คำขอนี้จะเปลี่ยนสถานะเป็นอนุมัติ และดำเนินการตามกฎการลาและตารางกะของระบบ',
    confirmLabel: 'ยืนยันอนุมัติคำขอ',
    tone: 'success',
    requiresReason: false
  };
  if (action === 'reject') return {
    title: 'ยืนยันไม่อนุมัติคำขอลา',
    eyebrow: 'ยืนยันการไม่อนุมัติ',
    consequence: 'คำขอนี้จะเปลี่ยนสถานะเป็นไม่อนุมัติ และผู้ขอจะไม่สามารถใช้คำขอนี้เป็นรายการอนุมัติได้',
    confirmLabel: 'ยืนยันไม่อนุมัติ',
    tone: 'danger',
    requiresReason: false
  };
  if (action === 'return') return {
    title: 'ยืนยันส่งคำขอลากลับไปแก้ไข',
    eyebrow: 'ส่งกลับเพื่อแก้ไข',
    consequence: 'คำขอจะกลับไปให้ผู้ขอแก้ไขข้อมูล โดยเหตุผลนี้จะถูกบันทึกประกอบการตรวจสอบ',
    confirmLabel: 'ส่งกลับไปแก้ไข',
    tone: 'warning',
    requiresReason: true,
    reasonLabel: 'ระบุเหตุผลที่ส่งกลับไปแก้ไข (จำเป็น)'
  };
  const approved = status === 'APPROVED';
  return {
    title: approved ? 'ยืนยันยกเลิกใบลาที่อนุมัติแล้ว' : 'ยืนยันยกเลิกคำขอลา',
    eyebrow: approved ? 'ยกเลิกรายการที่อนุมัติแล้ว' : 'ยกเลิกคำขอ',
    consequence: approved
      ? 'ใบลาที่อนุมัติแล้วจะถูกยกเลิกตามกฎเดิมของระบบ และการดำเนินการจะถูกบันทึกใน Audit'
      : 'คำขอลานี้จะถูกยกเลิก และเหตุผลจะถูกบันทึกไว้ในประวัติคำขอ',
    confirmLabel: approved ? 'ยืนยันยกเลิกใบลา' : 'ยืนยันยกเลิกคำขอ',
    tone: 'danger',
    requiresReason: true,
    reasonLabel: approved ? 'ระบุเหตุผลการยกเลิกใบลาที่อนุมัติแล้ว (จำเป็น)' : 'ระบุเหตุผลการยกเลิกคำขอ (จำเป็น)'
  };
};

export function LeaveDecisionConfirmation({
  target,
  action,
  busy = false,
  error,
  onConfirm,
  onClose
}: {
  target: LeaveDecisionTarget;
  action: LeaveDecisionAction;
  busy?: boolean;
  error?: RequestErrorInput;
  onConfirm(reason?: string): Promise<void> | void;
  onClose(): void;
}) {
  const presentation = leaveDecisionPresentation(action, target.status);
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy || submitting);
  onCloseRef.current = onClose;
  busyRef.current = busy || submitting;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseScrollLock = acquireDocumentScrollLock();
    const timer = window.setTimeout(() => {
      (presentation.requiresReason ? reasonRef.current : confirmRef.current)?.focus({ preventScroll: true });
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      )).filter((element) => !element.hasAttribute('hidden'));
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      releaseScrollLock();
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [presentation.requiresReason]);

  const reasonError = presentation.requiresReason && reasonTouched && reason.trim().length < 3
    ? 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร'
    : '';
  const effectiveBusy = busy || submitting;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (effectiveBusy) return;
    if (presentation.requiresReason && reason.trim().length < 3) {
      setReasonTouched(true);
      reasonRef.current?.focus({ preventScroll: true });
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm(presentation.requiresReason ? reason.trim() : undefined);
    } finally {
      setSubmitting(false);
    }
  };

  if (typeof document === 'undefined') return null;
  const descriptionId = `leave-decision-description-${action}`;
  const reasonId = `leave-decision-reason-${action}`;
  const reasonErrorId = `${reasonId}-error`;
  const describedBy = [descriptionId, reasonError ? reasonErrorId : ''].filter(Boolean).join(' ');

  return createPortal(
    <div className="modal-backdrop leave-decision-modal-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className={`edit-dialog leave-decision-dialog leave-decision-dialog--${presentation.tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`leave-decision-title-${action}`}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        <header className="leave-decision-dialog__header">
          <div>
            <p className="eyebrow">{presentation.eyebrow}</p>
            <h2 id={`leave-decision-title-${action}`}>{presentation.title}</h2>
          </div>
          <button type="button" className="leave-decision-dialog__close" aria-label="ปิด" disabled={effectiveBusy} onClick={onClose}>×</button>
        </header>
        <div className="leave-decision-dialog__body">
          <div className="leave-decision-dialog__identity">
            <strong>{target.employeeName || 'ไม่ระบุชื่อพนักงาน'}</strong>
            <span>{target.department || 'ไม่ระบุแผนก'} · {target.leaveType || 'ไม่ระบุประเภทลา'}</span>
          </div>
          <dl className="leave-decision-dialog__summary">
            <div><dt>วันที่ลา</dt><dd>{target.dateRange || '—'}</dd></div>
            <div><dt>จำนวนวัน</dt><dd>{target.dayCount || '—'} วัน</dd></div>
            <div><dt>ผู้ปฏิบัติงานแทน</dt><dd>{target.substitute || '—'}</dd></div>
            <div><dt>สถานะปัจจุบัน</dt><dd>{target.status || '—'}</dd></div>
          </dl>
          <div className="leave-decision-dialog__request-copy">
            <span>เหตุผล / รายละเอียดคำขอ</span>
            <p>{target.reason || 'ไม่ได้ระบุเหตุผลเพิ่มเติม'}</p>
          </div>
          <p id={descriptionId} className={`leave-decision-dialog__consequence leave-decision-dialog__consequence--${presentation.tone}`} role="status">
            {presentation.consequence}
          </p>
          {error && <div className="leave-decision-dialog__error" role="alert" aria-live="assertive"><strong>ดำเนินการไม่สำเร็จ</strong><RequestErrorContent error={error} /></div>}
          {presentation.requiresReason && <div className="leave-decision-dialog__reason-field">
            <label htmlFor={reasonId}>{presentation.reasonLabel}</label>
            <textarea
              ref={reasonRef}
              id={reasonId}
              value={reason}
              rows={4}
              maxLength={500}
              required
              aria-invalid={Boolean(reasonError)}
              aria-describedby={reasonError ? `${descriptionId} ${reasonErrorId}` : descriptionId}
              onChange={(event) => setReason(event.target.value)}
              onBlur={() => setReasonTouched(true)}
            />
            <small>เหตุผลจะถูกบันทึกไว้ประกอบการตรวจสอบ · อย่างน้อย 3 ตัวอักษร</small>
            {reasonError && <span id={reasonErrorId} className="leave-decision-dialog__reason-error" role="alert">{reasonError}</span>}
          </div>}
        </div>
        <form className="leave-decision-dialog__actions" onSubmit={submit}>
          <button type="button" className="btn-neutral" disabled={effectiveBusy} onClick={onClose}>ยกเลิก</button>
          <button ref={confirmRef} type="submit" className={`btn-${presentation.tone}`} disabled={effectiveBusy || Boolean(reasonError)} aria-busy={effectiveBusy}>
            {effectiveBusy ? 'กำลังดำเนินการ…' : presentation.confirmLabel}
          </button>
        </form>
      </section>
    </div>,
    document.body
  );
}
