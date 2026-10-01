import { useMemo, useState } from 'react';
import { inspectAttendanceDeviceKeyStorageReadOnly, type AttendanceDeviceKeyStorageDiagnostic } from '../../lib/attendance-device-key-diagnostic';
import '../../styles/g06-preview-device-diagnostic.css';

type DeclaredBrowserContext = 'UNKNOWN' | 'SAFARI_TAB' | 'SAFARI_PRIVATE' | 'HOME_SCREEN_PWA' | 'OTHER';

function detectPresentation() {
  const isStandalone = Boolean(
    window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isSafariLike = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua);
  return {
    displayMode: isStandalone ? 'standalone' : 'browser',
    iosUserAgentSignal: isIOS ? 'iOS/iPadOS user-agent signal' : 'No iOS/iPadOS user-agent signal',
    browserSignal: isSafariLike ? 'Safari-like user-agent signal' : 'Other/unknown browser signal'
  };
}

function displayStatus(result: AttendanceDeviceKeyStorageDiagnostic | null) {
  if (!result) return 'ยังไม่ได้ตรวจ';
  const labels: Record<AttendanceDeviceKeyStorageDiagnostic['status'], string> = {
    READ_OK: 'อ่านรายการ enrollment ID ได้แบบ read-only',
    INDEXED_DB_UNAVAILABLE: 'IndexedDB ใช้งานหรืออ่านไม่ได้',
    SAFE_ENUMERATION_UNSUPPORTED: 'เบราว์เซอร์ไม่มี API ตรวจฐานข้อมูลก่อนเปิดอย่างปลอดภัย จึงไม่เปิด IndexedDB',
    DATABASE_NOT_FOUND: 'ไม่พบฐานข้อมูลใน origin นี้',
    OBJECT_STORE_NOT_FOUND: 'พบฐานข้อมูล แต่ไม่มี object store ที่คาดไว้',
    DATABASE_CHANGED_DURING_READ: 'ฐานข้อมูลเปลี่ยนระหว่างตรวจ จึงหยุดโดยไม่สร้างหรืออัปเกรด',
    READ_FAILED: 'อ่าน metadata/primary keys ไม่สำเร็จ'
  };
  return labels[result.status];
}

export function G06PreviewDeviceContextDiagnosticPage() {
  const presentation = useMemo(detectPresentation, []);
  const [declaredContext, setDeclaredContext] = useState<DeclaredBrowserContext>('UNKNOWN');
  const [activeDeviceId, setActiveDeviceId] = useState('');
  const [inspection, setInspection] = useState<AttendanceDeviceKeyStorageDiagnostic | null>(null);
  const [busy, setBusy] = useState(false);

  const runReadOnlyInspection = async () => {
    setBusy(true);
    try {
      setInspection(await inspectAttendanceDeviceKeyStorageReadOnly(activeDeviceId));
    } finally {
      setBusy(false);
    }
  };

  return <main className="g06-preview-diagnostic">
    <header className="g06-preview-diagnostic__header">
      <p className="g06-preview-diagnostic__eyebrow">G06 · PREVIEW · READ-ONLY</p>
      <h1>ตรวจ Browser Storage ของอุปกรณ์ลงเวลา</h1>
      <p>หน้านี้อ่าน origin, primary keys และ safe CryptoKey metadata ใน browser นี้เท่านั้น ไม่มีการเริ่ม Attendance verification หรือสร้าง/แก้ข้อมูล</p>
    </header>

    <section className="g06-preview-diagnostic__notice" role="note">
      <strong>ข้อจำกัด origin</strong>
      <p>หน้านี้อยู่บน Preview origin ซึ่งแยก storage จาก Production origin ตามกฎ same-origin ของเบราว์เซอร์ ผล IndexedDB ด้านล่างจึงเป็นของ Preview hostname ที่แสดงเท่านั้น และใช้ยืนยัน key ของ Production Home Screen/PWA ไม่ได้</p>
    </section>

    <section className="g06-preview-diagnostic__card" aria-labelledby="g06-context-title">
      <h2 id="g06-context-title">Browser context ปัจจุบัน</h2>
      <dl>
        <div><dt>Origin</dt><dd data-testid="diagnostic-origin">{window.location.origin}</dd></div>
        <div><dt>Hostname</dt><dd>{window.location.hostname}</dd></div>
        <div><dt>Secure context</dt><dd>{window.isSecureContext ? 'YES' : 'NO'}</dd></div>
        <div><dt>Display mode</dt><dd>{presentation.displayMode}</dd></div>
        <div><dt>Browser signal</dt><dd>{presentation.iosUserAgentSignal}; {presentation.browserSignal}</dd></div>
        <div><dt>Declared launch context</dt><dd>
          <select aria-label="Context ที่เปิดหน้านี้" value={declaredContext} onChange={(event) => setDeclaredContext(event.target.value as DeclaredBrowserContext)}>
            <option value="UNKNOWN">ยังไม่ระบุ</option>
            <option value="SAFARI_TAB">Safari tab ปกติ</option>
            <option value="SAFARI_PRIVATE">Safari Private Browsing</option>
            <option value="HOME_SCREEN_PWA">Home Screen / PWA</option>
            <option value="OTHER">Browser/profile อื่น</option>
          </select>
        </dd></div>
      </dl>
      <p className="g06-preview-diagnostic__footnote">Web API ไม่สามารถระบุชื่อ Safari profile หรือยืนยัน Private Browsing ได้แน่นอน ค่า context ด้านบนจึงแยก browser signal กับข้อมูลที่ผู้ใช้ยืนยันเอง</p>
    </section>

    <section className="g06-preview-diagnostic__card" aria-labelledby="g06-storage-title">
      <h2 id="g06-storage-title">IndexedDB ที่ origin นี้</h2>
      <p>ฐานข้อมูล <code>smsv3-attendance-device-keys</code> · object store <code>deviceKeys</code></p>
      <label className="g06-preview-diagnostic__field">
        <span>Active device ID จากหลักฐาน server ก่อนหน้า (ไม่ส่งไป server)</span>
        <input autoCapitalize="off" autoComplete="off" spellCheck={false} value={activeDeviceId} onChange={(event) => setActiveDeviceId(event.target.value)} />
      </label>
      <button type="button" disabled={busy} onClick={() => void runReadOnlyInspection()}>
        {busy ? 'กำลังอ่านแบบ read-only…' : 'ตรวจ IndexedDB ของ origin นี้'}
      </button>
      <p className="g06-preview-diagnostic__footnote">การตรวจใช้ database enumeration ก่อน ถ้า browser ไม่มี API นี้จะหยุดโดยไม่เปิดฐานข้อมูล; เมื่อพบฐานข้อมูลจะใช้ transaction แบบ readonly และอ่านเฉพาะ primary keys ไม่อ่าน record หรือ CryptoKey</p>
      {inspection && <div className="g06-preview-diagnostic__result" role="status" aria-live="polite">
        <h3>ผลการตรวจ</h3>
        <dl>
          <div><dt>Result</dt><dd>{displayStatus(inspection)}</dd></div>
          <div><dt>Database</dt><dd>{inspection.databaseName} · {inspection.databaseVersion === null ? 'version unknown' : `version ${inspection.databaseVersion}`}</dd></div>
          <div><dt>Object store</dt><dd>{inspection.objectStoreName} · {inspection.objectStorePresent === null ? 'unknown' : inspection.objectStorePresent ? 'present' : 'not present'}</dd></div>
          <div><dt>Key path</dt><dd>{inspection.keyPath || 'unknown'}</dd></div>
          <div><dt>Stored enrollment IDs</dt><dd data-testid="stored-enrollment-ids">{inspection.storedEnrollmentIds.length ? inspection.storedEnrollmentIds.join(', ') : 'none reported'}</dd></div>
          <div><dt>Active ID in this origin</dt><dd>{inspection.activeDeviceId || 'not provided'}</dd></div>
          <div><dt>Primary key ID present</dt><dd>{inspection.activeRecordPresent === null ? 'UNKNOWN' : inspection.activeRecordPresent ? 'YES' : 'NO'}</dd></div>
          <div><dt>Local private CryptoKey</dt><dd>{inspection.activePrivateKeyPresent === null ? 'UNKNOWN' : inspection.activePrivateKeyPresent ? 'PRESENT — non-exportable signing key' : `NOT USABLE (${inspection.activeKeyStatus})`}</dd></div>
          <div><dt>Key metadata</dt><dd>{inspection.activeKeyMetadata ? `${inspection.activeKeyMetadata.algorithm || 'unknown'} · ${inspection.activeKeyMetadata.namedCurve || 'unknown'} · extractable=${String(inspection.activeKeyMetadata.extractable)} · usages=${inspection.activeKeyMetadata.usages.join(',') || 'none'}` : 'not available'}</dd></div>
          <div><dt>Raw private-key bytes</dt><dd>NOT READ / NOT EXPORTED / NOT LOGGED</dd></div>
        </dl>
      </div>}
    </section>

    <section className="g06-preview-diagnostic__card" aria-labelledby="g06-chain-title">
      <h2 id="g06-chain-title">Verification chain — diagnostic boundary</h2>
      <dl>
        <div><dt>Server active device lookup</dt><dd>NOT CALLED — Preview page does not query Production or Preview APIs</dd></div>
        <div><dt>verification.deviceEnrollmentId</dt><dd>NOT ISSUED — no verification session was started</dd></div>
        <div><dt>Device proof request</dt><dd>NOT SENT</dd></div>
        <div><dt>Attendance mutation/event</dt><dd>NOT CALLED / NOT CREATED BY THIS DIAGNOSTIC</dd></div>
      </dl>
      <p className="g06-preview-diagnostic__footnote">การตรวจใช้ database enumeration ก่อน ถ้า browser ไม่มี API นี้จะหยุดโดยไม่เปิดฐานข้อมูล; เมื่อพบฐานข้อมูลจะใช้ transaction แบบ readonly อ่าน primary keys และอ่าน record ของ active ID ในหน่วยความจำเพื่อคืนเฉพาะ boolean/algorithm metadata ไม่ส่ง record หรือ CryptoKey ออกจากหน้านี้</p>
    </section>
  </main>;
}
