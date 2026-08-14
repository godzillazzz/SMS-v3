import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  formatFileSize,
  formatLicenseDate,
  formatLicenseDateTime,
  canPermanentlyDeleteDocument,
  licenseTableStatus,
  licenseValidityLabel,
  LicenseDocument,
  MAX_LICENSE_DOCUMENT_BYTES,
  licenseDocumentStatusLabel,
  sanitizeLicenseDocumentError,
  selectLicenseDocumentForTable,
  selectLicenseDocumentSummary,
  sortLicenseDocuments
} from './license-document-utils';
import '../styles/license-documents.css';
import '../styles/license-correction.css';

type EmployeeIdentity = { employeeCode: string; firstName: string; lastName: string; department?: string };
type LicenseIdentity = { id: string; licenseNumber?: string | null; licenseType?: string | null; issueDate?: string | null; expiryDate?: string | null; status?: string | null; employee: EmployeeIdentity };
type ViewResult = { url: string; mimeType: string; fileName: string };
export type LicenseTableDocumentSummary = {
  state: 'CURRENT_WITH_PENDING' | 'CURRENT_WITH_RETURNED' | 'CURRENT' | 'PENDING' | 'RETURNED_FOR_CORRECTION' | 'REJECTED' | 'EXPIRED' | 'EMPTY';
  selectedDocumentId?: string | null;
  selectedFileAvailable?: boolean;
  selectedFileDeleted?: boolean;
  currentDocumentId?: string | null;
  pendingDocumentId?: string | null;
  reviewAvailable?: boolean;
};

type Services = {
  list: (licenseId: string) => Promise<LicenseDocument[]>;
  view: (documentId: string) => Promise<ViewResult>;
  approve: (documentId: string) => Promise<void>;
  returnForCorrection: (documentId: string, reason: string) => Promise<void>;
  resubmit: (documentId: string, data: UploadData, file?: File) => Promise<void>;
  reject: (documentId: string, reason: string) => Promise<void>;
  permanentlyDelete: (documentId: string) => Promise<void>;
};

type UploadData = { licenseNumber: string; proposedStartDate: string; proposedExpiryDate: string; note?: string };

function useModalBehavior(onClose: () => void, enabled = true) {
  const onCloseRef = useRef(onClose);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!enabled) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    initialFocusRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, [enabled]);
  return initialFocusRef;
}

function ModalFrame({ labelledBy, className = '', onClose, escapeEnabled = true, children }: { labelledBy: string; className?: string; onClose: () => void; escapeEnabled?: boolean; children: React.ReactNode }) {
  const closeRef = useModalBehavior(onClose, escapeEnabled);
  return createPortal(
    <div className="license-modal-viewport" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`license-modal-dialog ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={labelledBy} onMouseDown={(event) => event.stopPropagation()}>
        <button ref={closeRef} type="button" className="license-modal-close" aria-label="ปิดหน้าต่าง" onClick={onClose}>×</button>
        {children}
      </section>
    </div>,
    document.getElementById('modal-root') || document.body
  );
}

export function LicenseDocumentViewerModal({ documentId, onRequestView, onClose }: { documentId: string; onRequestView: (id: string) => Promise<ViewResult>; onClose: () => void }) {
  const [viewer, setViewer] = useState<ViewResult>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    setViewer(undefined);
    setError(undefined);
    onRequestView(documentId).then((result) => { if (active) setViewer(result); }).catch((reason) => { if (active) setError(sanitizeLicenseDocumentError(reason)); });
    return () => { active = false; setViewer(undefined); };
  }, [documentId, onRequestView]);
  return <ModalFrame labelledBy="license-viewer-title" className="license-viewer-dialog" onClose={onClose}>
    <header className="license-modal-heading"><div><p>ตัวอย่างเอกสารใบอนุญาต</p><h2 id="license-viewer-title">{viewer?.fileName || 'กำลังเปิดเอกสาร…'}</h2></div></header>
    {!viewer && !error && <div className="license-modal-state" role="status">กำลังขอลิงก์สำหรับดูเอกสาร…</div>}
    {error && <div className="license-modal-error" role="alert">{error}</div>}
    {viewer?.mimeType === 'application/pdf' && <iframe className="license-pdf-viewer" title={viewer.fileName} src={viewer.url} />}
    {viewer && ['image/jpeg', 'image/png'].includes(viewer.mimeType) && <div className="license-image-stage"><img src={viewer.url} alt={viewer.fileName} /></div>}
    {viewer && viewer.mimeType !== 'application/pdf' && !['image/jpeg', 'image/png'].includes(viewer.mimeType) && <div className="license-modal-error" role="alert">ไม่รองรับชนิดไฟล์นี้สำหรับการแสดงผล</div>}
  </ModalFrame>;
}

export function LicenseTableDocumentColumns({ license, summary, services, isAdmin, onChanged }: { license: LicenseIdentity; summary?: LicenseTableDocumentSummary; services: Services; isAdmin: boolean; onChanged: (message: string) => void }) {
  const [viewerId, setViewerId] = useState<string>();
  const [reviewDocument, setReviewDocument] = useState<LicenseDocument>();
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string>();
  const state = summary?.state || 'EMPTY';
  const currentLabel = () => {
    if (state === 'CURRENT_WITH_PENDING') return { label: 'มีรายการรอตรวจสอบ', tone: 'pending' };
    if (state === 'CURRENT_WITH_RETURNED') return { label: 'มีรายการส่งกลับแก้ไข', tone: 'returned' };
    if (state === 'CURRENT') {
      const validity = licenseValidityLabel(license.issueDate, license.expiryDate, license.status);
      if (validity === 'หมดอายุ') return { label: 'หมดอายุ', tone: 'expired' };
      if (validity === 'ใกล้หมดอายุ') return { label: 'ใกล้หมดอายุ', tone: 'expiring' };
      return { label: 'อนุมัติแล้ว', tone: 'approved' };
    }
    if (state === 'PENDING') return { label: 'รอตรวจสอบ', tone: 'pending' };
    if (state === 'RETURNED_FOR_CORRECTION') return { label: 'ส่งกลับแก้ไข', tone: 'returned' };
    if (state === 'REJECTED') return { label: 'ไม่อนุมัติ', tone: 'rejected' };
    if (state === 'EXPIRED') return { label: 'หมดอายุ', tone: 'expired' };
    return { label: 'ยังไม่มีเอกสาร', tone: 'empty' };
  };
  const tableStatus = currentLabel();
  const openReview = async () => {
    if (!summary?.pendingDocumentId || reviewBusy) return;
    setReviewBusy(true); setReviewError(undefined);
    try {
      const documents = sortLicenseDocuments(await services.list(license.id));
      const pending = documents.find((document) => document.id === summary.pendingDocumentId && document.status === 'PENDING');
      if (!pending) { onChanged('ข้อมูลเอกสารมีการเปลี่ยนแปลง กรุณารีเฟรช'); return; }
      setReviewDocument(pending);
    } catch (reason) { setReviewError(sanitizeLicenseDocumentError(reason)); }
    finally { setReviewBusy(false); }
  };
  const canView = Boolean(summary?.selectedDocumentId && summary.selectedFileAvailable && !summary.selectedFileDeleted);
  const unavailable = Boolean(summary?.selectedDocumentId && (!summary.selectedFileAvailable || summary.selectedFileDeleted));
  return <>
    <td className="license-table-status"><span className={`status-badge license-status-${tableStatus.tone}`}>{tableStatus.label}</span></td>
    <td className="license-table-view">{canView && <button type="button" className="btn-icon-only" aria-label="ดูไฟล์ใบอนุญาต" title="ดูไฟล์ใบอนุญาต" onClick={() => setViewerId(String(summary?.selectedDocumentId))}>👁</button>}{isAdmin && summary?.reviewAvailable && summary.pendingDocumentId && <button type="button" className="btn-warning compact" aria-label="ตรวจสอบเอกสารใบอนุญาต" disabled={reviewBusy} onClick={() => void openReview()}>{reviewBusy ? 'กำลังโหลด…' : 'ตรวจสอบ'}</button>}{!canView && <span className="license-file-unavailable" title={unavailable ? 'ไฟล์ต้นฉบับถูกลบตามนโยบายจัดเก็บข้อมูล' : undefined}>{unavailable ? 'ไฟล์ถูกลบตามนโยบาย' : 'ไม่มีไฟล์'}</span>}{reviewError && <span className="license-doc-inline-error" role="alert">{reviewError}</span>}</td>
    {viewerId && <LicenseDocumentViewerModal documentId={viewerId} onRequestView={services.view} onClose={() => setViewerId(undefined)} />}
    {reviewDocument && <ReviewModal document={reviewDocument} license={license} services={services} isAdmin={isAdmin} onClose={() => setReviewDocument(undefined)} onChanged={async (message) => { setReviewDocument(undefined); onChanged(message); }} />}
  </>;
}

function DocumentFacts({ document }: { document: LicenseDocument }) {
  return <dl className="license-document-facts">
    <div><dt>ชื่อไฟล์</dt><dd>{document.safeDisplayFileName}</dd></div>
    <div><dt>ขนาด / ชนิด</dt><dd>{formatFileSize(document.fileSize)} · {document.mimeType}</dd></div>
    <div><dt>ผู้แนบ</dt><dd>{document.uploadedBy?.displayName || '-'}</dd></div>
    <div><dt>แนบเมื่อ</dt><dd>{formatLicenseDateTime(document.uploadedAt)}</dd></div>
    <div><dt>หมายเหตุ</dt><dd>{document.note || '-'}</dd></div>
    <div><dt>สถานะ</dt><dd><span className={`license-doc-badge is-${document.status.toLowerCase()}`}>{licenseDocumentStatusLabel[document.status]}</span></dd></div>
    {document.correctionReason && <div><dt>เหตุผลที่ส่งกลับแก้ไข</dt><dd>{document.correctionReason}</dd></div>}
    {document.returnedBy && <div><dt>ผู้ส่งกลับแก้ไข</dt><dd>{document.returnedBy.displayName}</dd></div>}
    {document.returnedAt && <div><dt>ส่งกลับเมื่อ</dt><dd>{formatLicenseDateTime(document.returnedAt)}</dd></div>}
  </dl>;
}

function ReviewModal({ document, license, services, isAdmin, onClose, onChanged }: { document: LicenseDocument; license: LicenseIdentity; services: Services; isAdmin: boolean; onClose: () => void; onChanged: (message: string) => Promise<void> }) {
  const [viewerId, setViewerId] = useState<string>();
  const [mode, setMode] = useState<'approve' | 'return' | 'reject'>();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const employeeName = `${license.employee.firstName} ${license.employee.lastName}`.trim();
  const submitApprove = async () => {
    if (busy) return;
    setBusy(true); setError(undefined);
    try { await services.approve(document.id); await onChanged('อนุมัติเอกสารใบอนุญาตสำเร็จแล้ว'); onClose(); }
    catch (reason) { setError(sanitizeLicenseDocumentError(reason)); }
    finally { setBusy(false); }
  };
  const submitReject = async () => {
    const cleaned = reason.trim();
    if (!cleaned) { setError('กรุณาระบุเหตุผลที่ไม่อนุมัติ'); return; }
    if (busy) return;
    setBusy(true); setError(undefined);
    try { await services.reject(document.id, cleaned); await onChanged('บันทึกผลไม่อนุมัติสำเร็จแล้ว'); onClose(); }
    catch (reason) { setError(sanitizeLicenseDocumentError(reason)); }
    finally { setBusy(false); }
  };
  const submitReturn = async () => {
    const cleaned = reason.trim();
    if (!cleaned) { setError('กรุณาระบุเหตุผลที่ส่งกลับแก้ไข'); return; }
    if (busy) return;
    setBusy(true); setError(undefined);
    try { await services.returnForCorrection(document.id, cleaned); await onChanged('ส่งกลับแก้ไขสำเร็จแล้ว'); onClose(); }
    catch (reason) { setError(sanitizeLicenseDocumentError(reason)); }
    finally { setBusy(false); }
  };
  return <>
    <ModalFrame labelledBy="license-review-title" className="license-review-dialog" onClose={onClose} escapeEnabled={!viewerId}>
      <header className="license-modal-heading"><div><p>ตรวจสอบเอกสารใบอนุญาต</p><h2 id="license-review-title">{employeeName}</h2><span>{license.employee.employeeCode} · {license.employee.department || '-'}</span></div></header>
      <DocumentFacts document={document} />
      <button type="button" className="btn-ghost license-view-button" aria-label="ดูไฟล์ใบอนุญาต" onClick={() => setViewerId(document.id)}>◉ ดูไฟล์</button>
      <section className="license-date-comparison" aria-label="เปรียบเทียบวันที่ใบอนุญาต">
        <div><h3>วันที่ปัจจุบัน</h3><p>{formatLicenseDate(license.issueDate)} – {formatLicenseDate(license.expiryDate)}</p></div>
        <div><h3>วันที่เสนอ</h3><p>{formatLicenseDate(document.proposedStartDate)} – {formatLicenseDate(document.proposedExpiryDate)}</p></div>
      </section>
      {error && <div className="license-modal-error" role="alert">{error}</div>}
      {mode === 'approve' && <div className="license-confirm-panel"><strong>ยืนยันการอนุมัติ?</strong><p>วันหลักจะเปลี่ยนจาก {formatLicenseDate(license.issueDate)} – {formatLicenseDate(license.expiryDate)} เป็น {formatLicenseDate(document.proposedStartDate)} – {formatLicenseDate(document.proposedExpiryDate)} เมื่อยืนยัน</p><div><button type="button" className="btn-neutral" disabled={busy} onClick={() => setMode(undefined)}>ย้อนกลับ</button><button type="button" className="btn-success" disabled={busy} onClick={submitApprove}>{busy ? 'กำลังอนุมัติ…' : 'ยืนยันอนุมัติ'}</button></div></div>}
      {mode === 'return' && <div className="license-confirm-panel license-return-panel"><label className="field-group"><span>เหตุผลที่ส่งกลับแก้ไข <b>*</b></span><textarea autoFocus rows={3} value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></label><div><button type="button" className="btn-neutral" disabled={busy} onClick={() => setMode(undefined)}>ยกเลิก</button><button type="button" className="btn-warning" disabled={busy || !reason.trim()} onClick={submitReturn}>{busy ? 'กำลังบันทึก…' : 'ยืนยันส่งกลับแก้ไข'}</button></div></div>}
      {mode === 'reject' && <div className="license-confirm-panel"><p>เมื่อไม่อนุมัติ ระบบจะลบไฟล์ต้นฉบับและเก็บไว้เฉพาะประวัติการดำเนินการ</p><label className="field-group"><span>เหตุผลที่ไม่อนุมัติ <b>*</b></span><textarea autoFocus rows={3} value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} /></label><div><button type="button" className="btn-neutral" disabled={busy} onClick={() => setMode(undefined)}>ยกเลิก</button><button type="button" className="btn-danger" disabled={busy || !reason.trim()} onClick={submitReject}>{busy ? 'กำลังบันทึก…' : 'ยืนยันไม่อนุมัติ'}</button></div></div>}
      {isAdmin && document.status === 'PENDING' && !mode && <footer className="license-modal-actions"><button type="button" className="btn-success" disabled={busy} onClick={() => setMode('approve')}>อนุมัติ</button><button type="button" className="btn-warning" aria-label="ส่งกลับเอกสารใบอนุญาตให้แก้ไข" disabled={busy} onClick={() => { setReason(''); setMode('return'); }}>ส่งกลับแก้ไข</button><button type="button" className="btn-danger-outline" disabled={busy} onClick={() => { setReason(''); setMode('reject'); }}>ไม่อนุมัติ</button></footer>}
    </ModalFrame>
    {viewerId && <LicenseDocumentViewerModal documentId={viewerId} onRequestView={services.view} onClose={() => setViewerId(undefined)} />}
  </>;
}

function PermanentDeleteModal({ document, services, onClose, onDeleted }: { document: LicenseDocument; services: Services; onClose: () => void; onDeleted: () => Promise<void> }) {
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => {
    if (confirmation !== 'DELETE' || busy) return;
    setBusy(true); setError(undefined);
    try { await services.permanentlyDelete(document.id); await onDeleted(); onClose(); }
    catch (reason) { setError(sanitizeLicenseDocumentError(reason)); }
    finally { setBusy(false); }
  };
  return <ModalFrame labelledBy="license-hard-delete-title" className="license-review-dialog" onClose={onClose}>
    <header className="license-modal-heading"><div><p>ลบเอกสารถาวร</p><h2 id="license-hard-delete-title">ยืนยันการลบถาวร</h2></div></header>
    <div className="license-confirm-panel license-hard-delete-panel">
      <p>การลบนี้ไม่สามารถกู้คืนได้ และจะลบไฟล์กับประวัติการดำเนินการของรายการนี้</p>
      <dl className="license-document-facts"><div><dt>เลขใบอนุญาต</dt><dd>{document.proposedLicenseNumber || '-'}</dd></div><div><dt>ชื่อไฟล์</dt><dd>{document.safeDisplayFileName}</dd></div><div><dt>สถานะ</dt><dd>{licenseDocumentStatusLabel[document.status]}</dd></div></dl>
      <label className="field-group"><span>พิมพ์ DELETE เพื่อยืนยัน</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
      {error && <div className="license-modal-error" role="alert">{error}</div>}
      <div className="license-modal-actions"><button type="button" className="btn-neutral" disabled={busy} onClick={onClose}>ยกเลิก</button><button type="button" className="btn-danger" disabled={busy || confirmation !== 'DELETE'} onClick={() => void submit()}>{busy ? 'กำลังลบ…' : 'ลบถาวร'}</button></div>
    </div>
  </ModalFrame>;
}

function HistoryModal({ documents, services, isAdmin, onClose, onDeleted }: { documents: LicenseDocument[]; services: Services; isAdmin: boolean; onClose: () => void; onDeleted: () => Promise<void> }) {
  const [viewerId, setViewerId] = useState<string>();
  const [deleteDocument, setDeleteDocument] = useState<LicenseDocument>();
  const sorted = useMemo(() => sortLicenseDocuments(documents), [documents]);
  return <>
    <ModalFrame labelledBy="license-history-title" className="license-history-dialog" onClose={onClose} escapeEnabled={!viewerId}>
      <header className="license-modal-heading"><div><p>ประวัติการดำเนินการ</p><h2 id="license-history-title">เอกสารทั้งหมด</h2><span>เรียงจากรายการล่าสุดไปเก่า</span></div></header>
      {!sorted.length && <div className="license-modal-state">ยังไม่มีประวัติเอกสาร</div>}
      <div className="license-history-list">{sorted.map((document) => <article key={document.id} className="license-history-card">
        <header><strong>ประวัติการดำเนินการ</strong><span className={`license-doc-badge is-${document.status.toLowerCase()}`}>{licenseDocumentStatusLabel[document.status]}</span></header>
        <p className="license-history-file">{document.safeDisplayFileName}</p>
        <p>{formatLicenseDate(document.proposedStartDate)} – {formatLicenseDate(document.proposedExpiryDate)}</p>
        <small>ผู้แนบ: {document.uploadedBy?.displayName || '-'} · {formatLicenseDateTime(document.uploadedAt)}</small>
        <small>ผู้ตรวจ: {document.reviewedBy?.displayName || '-'} · {formatLicenseDateTime(document.reviewedAt)}</small>
        {document.correctionReason && <p className="license-correction-reason">เหตุผลส่งกลับแก้ไข: {document.correctionReason}</p>}
        {document.rejectionReason && <p className="license-rejection-reason">เหตุผลไม่อนุมัติ: {document.rejectionReason}</p>}
        {document.returnedBy && <small>ผู้ส่งกลับแก้ไข: {document.returnedBy.displayName} · {formatLicenseDateTime(document.returnedAt)}</small>}
        {document.proposedLicenseNumber && <p>เลขใบอนุญาต: {document.proposedLicenseNumber}</p>}
        <div className="license-inline-actions">{document.fileAvailable !== false && <button type="button" className="btn-ghost compact" aria-label="ดูไฟล์ใบอนุญาต" onClick={() => setViewerId(document.id)}>◉ ดูไฟล์</button>}{isAdmin && canPermanentlyDeleteDocument(document, documents) && <button type="button" className="btn-danger-outline compact" aria-label="ลบเอกสารใบอนุญาตถาวร" onClick={() => setDeleteDocument(document)}>ลบถาวร</button>}</div>
      </article>)}</div>
    </ModalFrame>
    {viewerId && <LicenseDocumentViewerModal documentId={viewerId} onRequestView={services.view} onClose={() => setViewerId(undefined)} />}
    {deleteDocument && <PermanentDeleteModal document={deleteDocument} services={services} onClose={() => setDeleteDocument(undefined)} onDeleted={onDeleted} />}
  </>;
}

function CorrectionModal({ document, services, onClose, onChanged }: { document: LicenseDocument; services: Services; onClose: () => void; onChanged: (message: string) => Promise<void> }) {
  const [file, setFile] = useState<File>();
  const [licenseNumber, setLicenseNumber] = useState(String(document.proposedLicenseNumber || ''));
  const [proposedStartDate, setProposedStartDate] = useState(String(document.proposedStartDate || '').slice(0, 10));
  const [proposedExpiryDate, setProposedExpiryDate] = useState(String(document.proposedExpiryDate || '').slice(0, 10));
  const [note, setNote] = useState(String(document.note || ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!licenseNumber.trim()) { setError('กรุณากรอกเลขใบอนุญาต'); return; }
    if (file && file.size > MAX_LICENSE_DOCUMENT_BYTES) { setError('ไฟล์ต้องมีขนาดไม่เกิน 2 MB'); return; }
    if (!proposedStartDate || !proposedExpiryDate || proposedStartDate > proposedExpiryDate) { setError('วันที่เริ่มต้นต้องไม่เกินวันหมดอายุ'); return; }
    if (busy) return;
    setBusy(true); setError(undefined);
    try { await services.resubmit(document.id, { licenseNumber: licenseNumber.trim(), proposedStartDate, proposedExpiryDate, note }, file); await onChanged(file ? 'เปลี่ยนไฟล์และส่งตรวจสอบใหม่สำเร็จแล้ว' : 'แก้ไขและส่งตรวจสอบใหม่สำเร็จแล้ว'); onClose(); }
    catch (reason) { setError(sanitizeLicenseDocumentError(reason)); }
    finally { setBusy(false); }
  };
  return <ModalFrame labelledBy="license-correction-title" className="license-review-dialog" onClose={onClose}>
    <header className="license-modal-heading"><div><p>แก้ไขเอกสารใบอนุญาต</p><h2 id="license-correction-title">แก้ไขและส่งตรวจสอบใหม่</h2><span>ไฟล์เดิมยังคงอยู่จนกว่าจะเปลี่ยนไฟล์สำเร็จ</span></div></header>
    {document.correctionReason && <div className="license-correction-reason-panel"><strong>เหตุผลที่ส่งกลับแก้ไข</strong><p>{document.correctionReason}</p></div>}
    <form className="license-upload-form" onSubmit={submit}>
      <label className="field-group"><span>เลขใบอนุญาต <b>*</b></span><input value={licenseNumber} maxLength={100} onChange={(event) => setLicenseNumber(event.target.value)} required /></label>
      <label className="field-group"><span>ไฟล์ใหม่ (ไม่บังคับ)</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => setFile(event.target.files?.[0])} /><small>{file ? 'จะอัปโหลดไฟล์ใหม่ก่อนบันทึกการอ้างอิง' : 'เว้นว่างเพื่อใช้ไฟล์เดิม'}</small></label>
      <div className="license-date-comparison"><label className="field-group"><span>วันที่เริ่มต้น <b>*</b></span><input type="date" value={proposedStartDate} onChange={(event) => setProposedStartDate(event.target.value)} required /></label><label className="field-group"><span>วันหมดอายุ <b>*</b></span><input type="date" value={proposedExpiryDate} onChange={(event) => setProposedExpiryDate(event.target.value)} required /></label></div>
      <label className="field-group"><span>หมายเหตุ</span><textarea rows={3} value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} /></label>
      {error && <div className="license-modal-error" role="alert">{error}</div>}
      <div className="license-modal-actions"><button type="button" className="btn-neutral" disabled={busy} onClick={onClose}>ยกเลิก</button><button type="submit" className="btn-primary" disabled={busy}>{busy ? 'กำลังส่ง…' : 'ส่งตรวจสอบใหม่'}</button></div>
    </form>
  </ModalFrame>;
}

export function LicenseEditModal({ license, isAdmin, services, onUpload, onChanged, onClose }: { license: LicenseIdentity; isAdmin: boolean; services: Services; onUpload: (data: UploadData, file: File) => Promise<void>; onChanged: (message: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<'details' | 'documents'>('details');
  const [documents, setDocuments] = useState<LicenseDocument[]>([]);
  const [file, setFile] = useState<File>();
  const [licenseNumber, setLicenseNumber] = useState(String(license.licenseNumber || ''));
  const [proposedStartDate, setProposedStartDate] = useState(String(license.issueDate || '').slice(0, 10));
  const [proposedExpiryDate, setProposedExpiryDate] = useState(String(license.expiryDate || '').slice(0, 10));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [reviewDocument, setReviewDocument] = useState<LicenseDocument>();
  const [correctionDocument, setCorrectionDocument] = useState<LicenseDocument>();
  const [viewerId, setViewerId] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const load = async () => { try { setDocuments(sortLicenseDocuments(await services.list(license.id))); } catch (reason) { setError(sanitizeLicenseDocumentError(reason)); } };
  useEffect(() => { void load(); }, [license.id]);
  const summary = selectLicenseDocumentSummary(documents);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) { setError('กรุณาเลือกไฟล์ใบอนุญาต'); return; }
    if (file.size > MAX_LICENSE_DOCUMENT_BYTES) { setError('ไฟล์ต้องมีขนาดไม่เกิน 2 MB'); return; }
    if (!licenseNumber.trim()) { setError('กรุณากรอกเลขใบอนุญาต'); return; }
    if (!proposedStartDate || !proposedExpiryDate || proposedStartDate > proposedExpiryDate) { setError('วันที่เริ่มต้นต้องไม่เกินวันหมดอายุ'); return; }
    setBusy(true); setError(undefined);
    try { await onUpload({ licenseNumber: licenseNumber.trim(), proposedStartDate, proposedExpiryDate, note }, file); setFile(undefined); setNote(''); await load(); onChanged('ส่งเอกสารใบอนุญาตตรวจสอบสำเร็จแล้ว'); }
    catch (reason) { setError(sanitizeLicenseDocumentError(reason)); }
    finally { setBusy(false); }
  };
  const changed = async (message: string) => { await load(); onChanged(message); };
  const documentLine = (document: LicenseDocument) => <div className="license-edit-document" key={document.id}><div><span className={`license-doc-badge is-${document.status.toLowerCase()}`}>{licenseDocumentStatusLabel[document.status]}</span><strong>{document.proposedLicenseNumber || license.licenseNumber || 'ยังไม่มีเลขใบอนุญาต'}</strong><small>{formatLicenseDate(document.proposedStartDate)} – {formatLicenseDate(document.proposedExpiryDate)}</small>{document.correctionReason && <small className="license-correction-reason">เหตุผล: {document.correctionReason}</small>}</div><div className="license-inline-actions">{document.fileAvailable !== false && <button type="button" className="btn-icon-only" aria-label="ดูไฟล์ใบอนุญาต" title="ดูไฟล์ใบอนุญาต" onClick={() => setViewerId(document.id)}>◉</button>}{document.fileAvailable === false && <span title="ไฟล์ต้นฉบับถูกลบตามนโยบายจัดเก็บข้อมูล">ไฟล์ถูกลบตามนโยบาย</span>}{isAdmin && document.status === 'PENDING' && <button type="button" className="btn-warning compact" onClick={() => setReviewDocument(document)}>ตรวจสอบ</button>}{document.status === 'RETURNED_FOR_CORRECTION' && document.fileAvailable !== false && <button type="button" className="btn-warning compact" onClick={() => setCorrectionDocument(document)}>แก้ไขและส่งตรวจสอบใหม่</button>}</div></div>;
  return <>
    <ModalFrame labelledBy="license-edit-title" className="license-edit-dialog" onClose={onClose} escapeEnabled={!reviewDocument && !correctionDocument && !viewerId}>
      <header className="license-modal-heading"><div><p>จัดการใบอนุญาต</p><h2 id="license-edit-title">{license.employee.firstName} {license.employee.lastName}</h2><span>{license.employee.employeeCode} · {license.employee.department || '-'}</span></div></header>
      <div className="license-edit-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === 'details'} className={tab === 'details' ? 'is-active' : ''} onClick={() => setTab('details')}>ข้อมูลใบอนุญาต</button><button type="button" role="tab" aria-selected={tab === 'documents'} className={tab === 'documents' ? 'is-active' : ''} onClick={() => setTab('documents')}>เอกสารและประวัติการดำเนินการ</button></div>
      {tab === 'details' && <dl className="license-document-facts"><div><dt>เลขใบอนุญาตปัจจุบัน</dt><dd>{license.licenseNumber || 'ยังไม่มีเลขใบอนุญาต'}</dd></div><div><dt>ประเภทใบอนุญาต</dt><dd>{license.licenseType || '-'}</dd></div><div><dt>วันที่เริ่มต้นปัจจุบัน</dt><dd>{formatLicenseDate(license.issueDate)}</dd></div><div><dt>วันหมดอายุปัจจุบัน</dt><dd>{formatLicenseDate(license.expiryDate)}</dd></div><div><dt>สถานะ</dt><dd>{license.status || '-'}</dd></div><div><dt>หน่วยงาน</dt><dd>{license.employee.department || '-'}</dd></div></dl>}
      {tab === 'documents' && <div className="license-edit-documents"><div className="license-edit-current"><h3>เอกสารปัจจุบัน</h3>{summary.current ? documentLine(summary.current) : <p>ยังไม่มีเอกสารที่อนุมัติแล้ว</p>}{summary.pending.length > 0 && <><h3>เอกสารต่ออายุที่รอตรวจสอบ</h3>{summary.pending.map(documentLine)}</>}{summary.returned.length > 0 && <><h3>เอกสารที่ส่งกลับแก้ไข</h3>{summary.returned.map(documentLine)}</>}{documents.length > 0 && <button type="button" className="btn-info-outline compact" onClick={() => setHistoryOpen(true)}>ดูประวัติการดำเนินการ</button>}</div><form className="license-upload-form" onSubmit={submit}><h3>แนบใบอนุญาตใหม่</h3><label className="field-group"><span>เลขใบอนุญาต <b>*</b></span><input value={licenseNumber} maxLength={100} onChange={(event) => setLicenseNumber(event.target.value)} required /></label><label className="field-group"><span>ไฟล์ใบอนุญาต <b>*</b></span><input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => setFile(event.target.files?.[0])} required /><small>PDF, JPG หรือ PNG ขนาดไม่เกิน 2 MB</small></label><div className="license-date-comparison"><label className="field-group"><span>วันที่เริ่มต้น <b>*</b></span><input type="date" value={proposedStartDate} onChange={(event) => setProposedStartDate(event.target.value)} required /></label><label className="field-group"><span>วันหมดอายุ <b>*</b></span><input type="date" value={proposedExpiryDate} onChange={(event) => setProposedExpiryDate(event.target.value)} required /></label></div><label className="field-group"><span>หมายเหตุ</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} /></label>{error && <div className="license-modal-error" role="alert">{error}</div>}<button type="submit" className="btn-primary" disabled={busy}>{busy ? 'กำลังส่ง…' : 'ส่งตรวจสอบ'}</button></form></div>}
    </ModalFrame>
    {reviewDocument && <ReviewModal document={reviewDocument} license={license} services={services} isAdmin={isAdmin} onClose={() => setReviewDocument(undefined)} onChanged={changed} />}
    {correctionDocument && <CorrectionModal document={correctionDocument} services={services} onClose={() => setCorrectionDocument(undefined)} onChanged={changed} />}
    {viewerId && <LicenseDocumentViewerModal documentId={viewerId} onRequestView={services.view} onClose={() => setViewerId(undefined)} />}
    {historyOpen && <HistoryModal documents={documents} services={services} isAdmin={isAdmin} onClose={() => setHistoryOpen(false)} onDeleted={async () => { await load(); onChanged('ลบรายการและไฟล์ถาวรแล้ว'); }} />}
  </>;
}

export function LicenseDocumentsCell({ license, isAdmin, refreshSignal, services, onUpload, onChanged, onEdit }: { license: LicenseIdentity; isAdmin: boolean; refreshSignal: number; services: Services; onUpload: () => void; onChanged: (message: string) => void; onEdit?: () => void }) {
  const [documents, setDocuments] = useState<LicenseDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reviewDocument, setReviewDocument] = useState<LicenseDocument>();
  const [viewerId, setViewerId] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const load = async () => {
    setLoading(true); setError(undefined);
    try { setDocuments(sortLicenseDocuments(await services.list(license.id))); }
    catch (reason) { setError(sanitizeLicenseDocumentError(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [license.id, refreshSignal]);
  const summary = useMemo(() => selectLicenseDocumentSummary(documents), [documents]);
  const changed = async (message: string) => { await load(); setNotice(message); window.setTimeout(() => onChanged(message), 1200); };
  const documentLine = (document: LicenseDocument, renewal = false) => <div className="license-document-line" key={document.id}>
    <div><span className={`license-doc-badge is-${document.status.toLowerCase()}`}>{renewal ? 'ฉบับต่ออายุรอตรวจสอบ' : licenseDocumentStatusLabel[document.status]}</span>{document.proposedLicenseNumber && <small>{renewal ? `เลขใหม่รอตรวจสอบ: ${document.proposedLicenseNumber}` : `เลขใบอนุญาต: ${document.proposedLicenseNumber}`}</small>}<small>{formatLicenseDate(document.proposedStartDate)} – {formatLicenseDate(document.proposedExpiryDate)}</small></div>
    <div className="license-inline-actions">{document.fileAvailable !== false && <button type="button" className="btn-icon-only" aria-label="ดูไฟล์ใบอนุญาต" title="ดูไฟล์ใบอนุญาต" onClick={() => setViewerId(document.id)}>◉</button>}{isAdmin && document.status === 'PENDING' && <button type="button" className="btn-warning compact" onClick={() => setReviewDocument(document)}>ตรวจสอบ</button>}</div>
  </div>;
  return <div className="license-documents-cell">
    {loading && <span className="license-doc-loading" role="status">กำลังอ่านเอกสาร…</span>}
    {error && <span className="license-doc-inline-error" role="alert">{error}</span>}
    {!loading && !error && !documents.length && <div className="license-document-summary"><span className="license-doc-badge is-empty">ยังไม่มีไฟล์</span></div>}
    {summary.current && <>{documentLine(summary.current)}<small className="license-primary-status">สถานะใบอนุญาต: {licenseValidityLabel(license.issueDate, license.expiryDate, license.status)}</small></>}
    {summary.pending.map((document) => documentLine(document, Boolean(summary.current)))}
    {!summary.pending.length && summary.latestRejected && (!summary.current || summary.latestRejected.version > summary.current.version) && documentLine(summary.latestRejected)}
    {!loading && !error && documents.length > 0 && <div className="license-document-footer"><button type="button" className="btn-info-outline compact" onClick={onEdit || onUpload}>แก้ไข</button></div>}
    {!loading && !error && !documents.length && <button type="button" className="btn-info-outline compact" onClick={onEdit || onUpload}>แก้ไข</button>}
    {notice && <span className="license-doc-notice" role="status">{notice}</span>}
    {viewerId && <LicenseDocumentViewerModal documentId={viewerId} onRequestView={services.view} onClose={() => setViewerId(undefined)} />}
    {reviewDocument && <ReviewModal document={reviewDocument} license={license} services={services} isAdmin={isAdmin} onClose={() => setReviewDocument(undefined)} onChanged={changed} />}
    {historyOpen && <HistoryModal documents={documents} services={services} isAdmin={isAdmin} onClose={() => setHistoryOpen(false)} onDeleted={async () => { await load(); onChanged('ลบรายการและไฟล์ถาวรแล้ว'); }} />}
  </div>;
}
