import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  formatFileSize,
  formatLicenseDate,
  formatLicenseDateTime,
  licenseValidityLabel,
  LicenseDocument,
  licenseDocumentStatusLabel,
  sanitizeLicenseDocumentError,
  selectLicenseDocumentSummary,
  sortLicenseDocuments
} from './license-document-utils';
import '../styles/license-documents.css';

type EmployeeIdentity = { employeeCode: string; firstName: string; lastName: string; department?: string };
type LicenseIdentity = { id: string; issueDate?: string | null; expiryDate?: string | null; status?: string | null; employee: EmployeeIdentity };
type ViewResult = { url: string; mimeType: string; fileName: string };

type Services = {
  list: (licenseId: string) => Promise<LicenseDocument[]>;
  view: (documentId: string) => Promise<ViewResult>;
  approve: (documentId: string) => Promise<void>;
  reject: (documentId: string, reason: string) => Promise<void>;
};

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

function DocumentFacts({ document }: { document: LicenseDocument }) {
  return <dl className="license-document-facts">
    <div><dt>ชื่อไฟล์</dt><dd>{document.safeDisplayFileName}</dd></div>
    <div><dt>ขนาด / ชนิด</dt><dd>{formatFileSize(document.fileSize)} · {document.mimeType}</dd></div>
    <div><dt>ผู้แนบ</dt><dd>{document.uploadedBy?.displayName || '-'}</dd></div>
    <div><dt>แนบเมื่อ</dt><dd>{formatLicenseDateTime(document.uploadedAt)}</dd></div>
    <div><dt>หมายเหตุ</dt><dd>{document.note || '-'}</dd></div>
    <div><dt>สถานะ</dt><dd><span className={`license-doc-badge is-${document.status.toLowerCase()}`}>{licenseDocumentStatusLabel[document.status]}</span></dd></div>
  </dl>;
}

function ReviewModal({ document, license, services, onClose, onChanged }: { document: LicenseDocument; license: LicenseIdentity; services: Services; onClose: () => void; onChanged: (message: string) => Promise<void> }) {
  const [viewerId, setViewerId] = useState<string>();
  const [mode, setMode] = useState<'approve' | 'reject'>();
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
  return <>
    <ModalFrame labelledBy="license-review-title" className="license-review-dialog" onClose={onClose} escapeEnabled={!viewerId}>
      <header className="license-modal-heading"><div><p>ตรวจสอบเอกสารใบอนุญาต</p><h2 id="license-review-title">{employeeName}</h2><span>{license.employee.employeeCode} · {license.employee.department || '-'}</span></div></header>
      <DocumentFacts document={document} />
      <button type="button" className="btn-neutral license-view-button" aria-label={`ดูไฟล์ ${document.safeDisplayFileName}`} onClick={() => setViewerId(document.id)}>◉ ดูไฟล์</button>
      <section className="license-date-comparison" aria-label="เปรียบเทียบวันที่ใบอนุญาต">
        <div><h3>วันที่ปัจจุบัน</h3><p>{formatLicenseDate(license.issueDate)} – {formatLicenseDate(license.expiryDate)}</p></div>
        <div><h3>วันที่เสนอ</h3><p>{formatLicenseDate(document.proposedStartDate)} – {formatLicenseDate(document.proposedExpiryDate)}</p></div>
      </section>
      {error && <div className="license-modal-error" role="alert">{error}</div>}
      {mode === 'approve' && <div className="license-confirm-panel"><strong>ยืนยันการอนุมัติ?</strong><p>วันหลักจะเปลี่ยนจาก {formatLicenseDate(license.issueDate)} – {formatLicenseDate(license.expiryDate)} เป็น {formatLicenseDate(document.proposedStartDate)} – {formatLicenseDate(document.proposedExpiryDate)} เมื่อยืนยัน</p><div><button type="button" className="btn-neutral" disabled={busy} onClick={() => setMode(undefined)}>ย้อนกลับ</button><button type="button" className="btn-success" disabled={busy} onClick={submitApprove}>{busy ? 'กำลังอนุมัติ…' : 'ยืนยันอนุมัติ'}</button></div></div>}
      {mode === 'reject' && <div className="license-confirm-panel"><label className="field-group"><span>เหตุผลที่ไม่อนุมัติ <b>*</b></span><textarea autoFocus rows={3} value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} /></label><div><button type="button" className="btn-neutral" disabled={busy} onClick={() => setMode(undefined)}>ย้อนกลับ</button><button type="button" className="btn-danger" disabled={busy || !reason.trim()} onClick={submitReject}>{busy ? 'กำลังบันทึก…' : 'ยืนยันไม่อนุมัติ'}</button></div></div>}
      {!mode && <footer className="license-modal-actions"><button type="button" className="btn-danger" disabled={busy} onClick={() => setMode('reject')}>ไม่อนุมัติ</button><button type="button" className="btn-success" disabled={busy} onClick={() => setMode('approve')}>อนุมัติ</button></footer>}
    </ModalFrame>
    {viewerId && <LicenseDocumentViewerModal documentId={viewerId} onRequestView={services.view} onClose={() => setViewerId(undefined)} />}
  </>;
}

function HistoryModal({ documents, services, onClose }: { documents: LicenseDocument[]; services: Services; onClose: () => void }) {
  const [viewerId, setViewerId] = useState<string>();
  const sorted = useMemo(() => sortLicenseDocuments(documents), [documents]);
  return <>
    <ModalFrame labelledBy="license-history-title" className="license-history-dialog" onClose={onClose} escapeEnabled={!viewerId}>
      <header className="license-modal-heading"><div><p>ประวัติเอกสารใบอนุญาต</p><h2 id="license-history-title">เอกสารทั้งหมด</h2><span>เรียงจากฉบับใหม่ไปเก่า</span></div></header>
      {!sorted.length && <div className="license-modal-state">ยังไม่มีประวัติเอกสาร</div>}
      <div className="license-history-list">{sorted.map((document) => <article key={document.id} className="license-history-card">
        <header><strong>ฉบับที่ {document.version}</strong><span className={`license-doc-badge is-${document.status.toLowerCase()}`}>{licenseDocumentStatusLabel[document.status]}</span></header>
        <p className="license-history-file">{document.safeDisplayFileName}</p>
        <p>{formatLicenseDate(document.proposedStartDate)} – {formatLicenseDate(document.proposedExpiryDate)}</p>
        <small>ผู้แนบ: {document.uploadedBy?.displayName || '-'} · {formatLicenseDateTime(document.uploadedAt)}</small>
        <small>ผู้ตรวจ: {document.reviewedBy?.displayName || '-'} · {formatLicenseDateTime(document.reviewedAt)}</small>
        {document.rejectionReason && <p className="license-rejection-reason">เหตุผล: {document.rejectionReason}</p>}
        <button type="button" className="btn-neutral compact" aria-label={`ดูไฟล์ฉบับที่ ${document.version}`} onClick={() => setViewerId(document.id)}>◉ ดูไฟล์</button>
      </article>)}</div>
    </ModalFrame>
    {viewerId && <LicenseDocumentViewerModal documentId={viewerId} onRequestView={services.view} onClose={() => setViewerId(undefined)} />}
  </>;
}

export function LicenseDocumentsCell({ license, isAdmin, refreshSignal, services, onUpload, onChanged }: { license: LicenseIdentity; isAdmin: boolean; refreshSignal: number; services: Services; onUpload: () => void; onChanged: (message: string) => void }) {
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
    <div><span className={`license-doc-badge is-${document.status.toLowerCase()}`}>{renewal ? 'ฉบับต่ออายุรอตรวจสอบ' : licenseDocumentStatusLabel[document.status]}</span><small>{formatLicenseDate(document.proposedStartDate)} – {formatLicenseDate(document.proposedExpiryDate)}</small><small>ผู้แนบ: {document.uploadedBy?.displayName || '-'} · {formatLicenseDateTime(document.uploadedAt)}</small>{document.rejectionReason && <small className="license-rejection-reason">เหตุผล: {document.rejectionReason}</small>}</div>
    <div className="license-inline-actions"><button type="button" className="btn-icon-only" aria-label={`ดูไฟล์ ${document.safeDisplayFileName}`} onClick={() => setViewerId(document.id)}>◉</button>{isAdmin && document.status === 'PENDING' && <button type="button" className="btn-warning compact" onClick={() => setReviewDocument(document)}>ตรวจสอบ</button>}</div>
  </div>;
  return <div className="license-documents-cell">
    {loading && <span className="license-doc-loading" role="status">กำลังอ่านเอกสาร…</span>}
    {error && <span className="license-doc-inline-error" role="alert">{error}</span>}
    {!loading && !error && !documents.length && <div className="license-document-empty"><span className="license-doc-badge is-empty">ยังไม่มีไฟล์</span><button type="button" className="btn-neutral compact" onClick={onUpload}>แนบใบอนุญาต</button><button type="button" className="btn-neutral compact" onClick={() => setHistoryOpen(true)}>ดูประวัติ</button></div>}
    {summary.current && <>{documentLine(summary.current)}<small className="license-primary-status">สถานะใบอนุญาต: {licenseValidityLabel(license.issueDate, license.expiryDate, license.status)}</small></>}
    {summary.pending.map((document) => documentLine(document, Boolean(summary.current)))}
    {!summary.pending.length && summary.latestRejected && (!summary.current || summary.latestRejected.version > summary.current.version) && documentLine(summary.latestRejected)}
    {!loading && !error && documents.length > 0 && <div className="license-document-footer"><button type="button" className="btn-neutral compact" onClick={() => setHistoryOpen(true)}>ดูประวัติ</button><button type="button" className="btn-neutral compact" onClick={onUpload}>{summary.current ? 'แนบฉบับต่ออายุ' : 'แนบฉบับใหม่'}</button></div>}
    {notice && <span className="license-doc-notice" role="status">{notice}</span>}
    {viewerId && <LicenseDocumentViewerModal documentId={viewerId} onRequestView={services.view} onClose={() => setViewerId(undefined)} />}
    {reviewDocument && <ReviewModal document={reviewDocument} license={license} services={services} onClose={() => setReviewDocument(undefined)} onChanged={changed} />}
    {historyOpen && <HistoryModal documents={documents} services={services} onClose={() => setHistoryOpen(false)} />}
  </div>;
}
