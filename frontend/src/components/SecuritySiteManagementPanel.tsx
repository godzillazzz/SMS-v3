import { useEffect, useMemo, useState } from 'react';
import { ApiRequestError, api } from '../api';
import '../styles/security-site-management.css';
import {
  createSecuritySiteQrDataUrl,
  printSecuritySiteQrDocument,
  securitySiteQrFilename
} from './security-site-qr';
import type {
  SecuritySite as ApiSecuritySite,
  SecuritySiteDepartmentMapping as ApiDepartmentMapping,
  SecuritySiteInput,
  SecuritySiteOverlapWarning,
  SecuritySiteQrCredential
} from '../api';

type SecuritySite = ApiSecuritySite;
type QrCredential = SecuritySiteQrCredential;
type DepartmentMapping = ApiDepartmentMapping;
type OverlapWarning = SecuritySiteOverlapWarning;

type SiteForm = {
  code: string;
  name: string;
  latitude: string;
  longitude: string;
  geofenceRadiusMeters: string;
};

const emptyForm: SiteForm = { code: '', name: '', latitude: '', longitude: '', geofenceRadiusMeters: '100' };

export function securitySiteTokenRole(token: string) {
  try {
    const payload = token.split('.')[1];
    if (!payload || typeof globalThis.atob !== 'function') return '';
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const parsed = JSON.parse(globalThis.atob(padded)) as { role?: unknown };
    return String(parsed.role || '').trim().toUpperCase();
  } catch {
    return '';
  }
}

function numberOrNull(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function displayDate(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(value));
}

function requestErrorMessage(reason: unknown, fallback: string) {
  return reason instanceof ApiRequestError || reason instanceof Error ? reason.message : fallback;
}

type GeneratedQr = {
  dataUrl: string;
  credential: QrCredential;
  siteCode: string;
  siteName: string;
};

function SitePreview({ site }: { site: SecuritySite | null }) {
  if (!site) return <div className="security-site-map-empty">เลือก Site เพื่อดู Geofence preview</div>;
  const radius = Math.max(28, Math.min(74, Math.round(Number(site.geofenceRadiusMeters) / 4)));
  return <div className="security-site-map" aria-label="Security Site geofence schematic preview">
    <svg viewBox="0 0 240 170" role="img" aria-label={`Geofence ${site.code}`}>
      <path d="M0 35 H240 M0 85 H240 M0 135 H240 M45 0 V170 M120 0 V170 M195 0 V170" className="security-site-map__grid" />
      <circle cx="120" cy="85" r={radius} className="security-site-map__radius" />
      <circle cx="120" cy="85" r="6" className="security-site-map__pin" />
      <path d="M120 52 L120 76 M108 85 L132 85" className="security-site-map__crosshair" />
    </svg>
    <div className="security-site-map__legend"><strong>{site.code} · {site.name}</strong><span>{site.latitude}, {site.longitude}</span><span>รัศมี {site.geofenceRadiusMeters} ม.</span><small>ภาพนี้เป็น schematic preview; Server ใช้พิกัดจริงคำนวณ Haversine + Geofence</small></div>
  </div>;
}

export function SecuritySiteManagementPanel({ token }: { token: string }) {
  const isAdmin = useMemo(() => securitySiteTokenRole(token) === 'ADMIN', [token]);
  const [sites, setSites] = useState<SecuritySite[]>([]);
  const [departments, setDepartments] = useState<DepartmentMapping[]>([]);
  const [overlaps, setOverlaps] = useState<OverlapWarning[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [form, setForm] = useState<SiteForm>(emptyForm);
  const [mappingSiteIds, setMappingSiteIds] = useState<string[]>([]);
  const [defaultSiteId, setDefaultSiteId] = useState('');
  const [rawQrToken, setRawQrToken] = useState('');
  const [generatedQr, setGeneratedQr] = useState<GeneratedQr | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const selectedSite = sites.find((site) => site.id === selectedSiteId) || null;
  const activeSites = sites.filter((site) => site.isActive);
  const selectedMapping = departments.find((department) => department.departmentName === selectedDepartment) || null;
  const selectedOverlaps = selectedSite
    ? overlaps.filter((warning) => warning.siteId === selectedSite.id || warning.otherSiteId === selectedSite.id)
    : overlaps;

  const applySite = (site: SecuritySite | null) => {
    setSelectedSiteId(site?.id || '');
    setForm(site ? {
      code: site.code,
      name: site.name,
      latitude: String(site.latitude ?? ''),
      longitude: String(site.longitude ?? ''),
      geofenceRadiusMeters: String(site.geofenceRadiusMeters)
    } : emptyForm);
    setRawQrToken('');
    setGeneratedQr(null);
    setError(undefined);
    setNotice(undefined);
  };

  const applyMapping = (mapping: DepartmentMapping | null) => {
    setSelectedDepartment(mapping?.departmentName || '');
    setMappingSiteIds(mapping?.siteIds || []);
    setDefaultSiteId(mapping?.defaultSiteId || '');
    setError(undefined);
    setNotice(undefined);
  };

  const reload = async (preferredSiteId?: string, preferredDepartment?: string) => {
    if (!isAdmin) return;
    setLoading(true);
    setError(undefined);
    try {
      const [{ data: siteData }, { data: departmentData }] = await Promise.all([
        api.getSecuritySites(token),
        api.getSecuritySiteDepartments(token)
      ]);
      setSites(siteData.sites || []);
      setOverlaps(siteData.overlapWarnings || []);
      setDepartments(departmentData || []);
      const nextSiteId = preferredSiteId || selectedSiteId;
      const nextSite = siteData.sites.find((site) => site.id === nextSiteId) || null;
      if (nextSite) applySite(nextSite);
      else if (selectedSiteId && !nextSite) applySite(null);
      const nextDepartmentName = preferredDepartment || selectedDepartment;
      const nextDepartment = departmentData.find((department) => department.departmentName === nextDepartmentName) || null;
      if (nextDepartment) applyMapping(nextDepartment);
      else if (selectedDepartment && !nextDepartment) applyMapping(null);
    } catch (reason) {
      setError(requestErrorMessage(reason, 'ไม่สามารถโหลด Security Site configuration ได้'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (isAdmin) void reload(); }, [isAdmin, token]);

  if (!isAdmin) return null;

  const saveSite = async () => {
    const latitude = numberOrNull(form.latitude);
    const longitude = numberOrNull(form.longitude);
    const radius = numberOrNull(form.geofenceRadiusMeters);
    if (!form.code.trim() || !form.name.trim() || latitude === null || longitude === null || radius === null) {
      setError('กรุณาระบุ Code, ชื่อ Site, พิกัด และรัศมี Geofence ให้ครบ');
      return;
    }
    setSaving(true); setError(undefined); setNotice(undefined);
    try {
      const payload: SecuritySiteInput = {
        code: form.code.trim(),
        name: form.name.trim(),
        latitude,
        longitude,
        geofenceRadiusMeters: Math.round(radius)
      };
      const { data: saved } = selectedSite
        ? await api.updateSecuritySite(token, selectedSite.id, payload)
        : await api.createSecuritySite(token, payload);
      setNotice(selectedSite ? 'บันทึก Security Site แล้ว' : 'เพิ่ม Security Site แล้ว');
      await reload(saved.id, selectedDepartment);
    } catch (reason) {
      setError(requestErrorMessage(reason, 'บันทึก Security Site ไม่สำเร็จ'));
    } finally { setSaving(false); }
  };

  const toggleSiteActive = async () => {
    if (!selectedSite) return;
    setSaving(true); setError(undefined); setNotice(undefined);
    try {
      await api.updateSecuritySite(token, selectedSite.id, { isActive: !selectedSite.isActive });
      setNotice(selectedSite.isActive ? 'ปิดใช้งาน Site แล้ว' : 'เปิดใช้งาน Site แล้ว');
      await reload(selectedSite.id, selectedDepartment);
    } catch (reason) {
      setError(requestErrorMessage(reason, 'เปลี่ยนสถานะ Site ไม่สำเร็จ'));
    } finally { setSaving(false); }
  };

  const saveMapping = async () => {
    if (!selectedDepartment) return;
    if (defaultSiteId && !mappingSiteIds.includes(defaultSiteId)) {
      setError('Default Site ต้องอยู่ใน Allowed Sites ของ Department เดียวกัน');
      return;
    }
    setSaving(true); setError(undefined); setNotice(undefined);
    try {
      await api.updateSecuritySiteDepartmentMapping(token, { departmentName: selectedDepartment, siteIds: mappingSiteIds, defaultSiteId: defaultSiteId || null });
      setNotice(`บันทึก Site authority ของ ${selectedDepartment} แล้ว`);
      await reload(selectedSiteId, selectedDepartment);
    } catch (reason) {
      setError(requestErrorMessage(reason, 'บันทึก Department ↔ Site mapping ไม่สำเร็จ'));
    } finally { setSaving(false); }
  };

  const toggleMappedSite = (siteId: string, checked: boolean) => {
    setMappingSiteIds((current) => checked ? [...new Set([...current, siteId])] : current.filter((id) => id !== siteId));
    if (!checked && defaultSiteId === siteId) setDefaultSiteId('');
  };

  const rotateQr = async () => {
    const site = selectedSite;
    if (!site) return;
    setSaving(true); setError(undefined); setNotice(undefined); setRawQrToken(''); setGeneratedQr(null);
    try {
      const { data: result } = await api.rotateSecuritySiteQr(token, site.id);
      setRawQrToken(result.qrToken);
      const nextQr: GeneratedQr = {
        dataUrl: await createSecuritySiteQrDataUrl(result.qrToken),
        credential: result.credential,
        siteCode: site.code,
        siteName: site.name
      };
      setGeneratedQr(nextQr);
      await reload(site.id, selectedDepartment);
      setRawQrToken(result.qrToken);
      setGeneratedQr(nextQr);
      setNotice(`ออก QR credential version ${result.credential.version} แล้ว`);
    } catch (reason) {
      setError(requestErrorMessage(reason, 'Rotate QR ไม่สำเร็จ'));
    } finally { setSaving(false); }
  };

  const revokeQr = async () => {
    if (!selectedSite?.currentQrCredential) return;
    setSaving(true); setError(undefined); setNotice(undefined); setRawQrToken(''); setGeneratedQr(null);
    try {
      await api.revokeSecuritySiteQr(token, selectedSite.id, selectedSite.currentQrCredential.id);
      setNotice('ยกเลิก QR credential ปัจจุบันแล้ว');
      await reload(selectedSite.id, selectedDepartment);
    } catch (reason) {
      setError(requestErrorMessage(reason, 'Revoke QR ไม่สำเร็จ'));
    } finally { setSaving(false); }
  };

  const copyQrToken = async () => {
    if (!rawQrToken) return;
    if (!navigator.clipboard?.writeText) {
      setError('เบราว์เซอร์นี้ไม่รองรับการคัดลอก Token อัตโนมัติ');
      return;
    }
    try {
      await navigator.clipboard.writeText(rawQrToken);
      setNotice('คัดลอก QR Token แล้ว');
    } catch {
      setError('คัดลอก QR Token ไม่สำเร็จ กรุณาใช้ปุ่มคัดลอกของเบราว์เซอร์');
    }
  };

  const printQr = async () => {
    if (!generatedQr) return;
    setError(undefined);
    try {
      await printSecuritySiteQrDocument({
        dataUrl: generatedQr.dataUrl,
        siteCode: generatedQr.siteCode,
        siteName: generatedQr.siteName,
        version: generatedQr.credential.version,
        generatedLabel: displayDate(generatedQr.credential.createdAt),
        validFromLabel: displayDate(generatedQr.credential.validFrom)
      });
    } catch (reason) {
      setError(requestErrorMessage(reason, 'เปิดเอกสารพิมพ์ QR ไม่สำเร็จ กรุณาลองใหม่'));
    }
  };

  const saveQr = () => {
    if (!generatedQr) return;
    try {
      const link = document.createElement('a');
      link.href = generatedQr.dataUrl;
      link.download = securitySiteQrFilename(generatedQr.siteCode, generatedQr.credential.version);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setNotice('บันทึก QR เป็น PNG แล้ว');
    } catch {
      setError('บันทึก QR เป็น PNG ไม่สำเร็จ เบราว์เซอร์อาจไม่อนุญาตการดาวน์โหลดอัตโนมัติ');
    }
  };

  return <section className="security-site-admin" aria-label="Admin Security Site Management">
    <header className="security-site-admin__header">
      <div><p className="eyebrow">ADMIN · ATTENDANCE SITE AUTHORITY</p><h2>Security Site Management</h2><p>กำหนด Site, Geofence, Department ↔ Site และ Default/Home Site โดยไม่ผูก Site ถาวรไว้ที่ Employee</p></div>
      <button type="button" className="btn-neutral" disabled={loading || saving} onClick={() => void reload()}>↻ รีเฟรช</button>
    </header>

    <div className="security-site-authority-rule"><strong>Expected Site authority</strong><span>1. Schedule Site override</span><span>2. Department Default Site</span><span>3. BLOCK — ไม่เดา Site</span></div>
    {error && <div className="alert alert-error" role="alert">{error}</div>}
    {notice && <div className="settings-notice" role="status">{notice}</div>}

    <div className="security-site-admin__grid">
      <article className="security-site-admin__card">
        <div className="security-site-admin__card-title"><div><h3>Site master</h3><small>เพิ่ม / แก้ไข / deactivate / reactivate · ไม่มี hard delete</small></div><button type="button" className="btn-neutral small-action" onClick={() => applySite(null)}>+ Site ใหม่</button></div>
        <label className="field-group"><span>เลือก Site</span><select value={selectedSiteId} onChange={(event) => applySite(sites.find((site) => site.id === event.target.value) || null)}><option value="">— Site ใหม่ —</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.code} · {site.name}{site.isActive ? '' : ' · INACTIVE'}</option>)}</select></label>
        <div className="security-site-form-grid">
          <label className="field-group"><span>Site code</span><input value={form.code} maxLength={50} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} /></label>
          <label className="field-group"><span>ชื่อ Site</span><input value={form.name} maxLength={150} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <label className="field-group"><span>Latitude</span><input type="number" step="0.0000001" min={-90} max={90} value={form.latitude} onChange={(event) => setForm((current) => ({ ...current, latitude: event.target.value }))} /></label>
          <label className="field-group"><span>Longitude</span><input type="number" step="0.0000001" min={-180} max={180} value={form.longitude} onChange={(event) => setForm((current) => ({ ...current, longitude: event.target.value }))} /></label>
          <label className="field-group"><span>Geofence radius (เมตร)</span><input type="number" min={1} max={100000} value={form.geofenceRadiusMeters} onChange={(event) => setForm((current) => ({ ...current, geofenceRadiusMeters: event.target.value }))} /></label>
        </div>
        <div className="security-site-actions"><button type="button" className="btn-primary" disabled={saving} onClick={() => void saveSite()}>{saving ? 'กำลังบันทึก…' : selectedSite ? 'บันทึกการแก้ไข' : 'เพิ่ม Security Site'}</button>{selectedSite && <button type="button" className={selectedSite.isActive ? 'danger-action' : 'btn-success'} disabled={saving} onClick={() => void toggleSiteActive()}>{selectedSite.isActive ? 'Deactivate' : 'Reactivate'}</button>}</div>
      </article>

      <article className="security-site-admin__card">
        <div className="security-site-admin__card-title"><div><h3>Geofence / overlap preview</h3><small>เตือนวง Geofence ของ Site ที่ Active และซ้อนกัน</small></div></div>
        <SitePreview site={selectedSite} />
        <div className="security-site-overlap-list">{selectedOverlaps.length ? selectedOverlaps.map((warning) => <div key={`${warning.siteId}-${warning.otherSiteId}`} className="security-site-overlap-warning"><strong>⚠ {warning.siteCode} ↔ {warning.otherSiteCode}</strong><span>ศูนย์กลางห่าง {warning.distanceMeters} ม. · วงซ้อนประมาณ {warning.overlapMeters} ม.</span></div>) : <div className="security-site-no-warning">ไม่พบ Geofence overlap ในชุดที่เลือก</div>}</div>
      </article>

      <article className="security-site-admin__card security-site-admin__card--wide">
        <div className="security-site-admin__card-title"><div><h3>Department ↔ Security Site</h3><small>Department เลือก Allowed Sites ได้หลายแห่ง แต่ Default/Home Site ได้สูงสุด 1 แห่ง</small></div></div>
        <label className="field-group"><span>Department</span><select value={selectedDepartment} onChange={(event) => applyMapping(departments.find((department) => department.departmentName === event.target.value) || null)}><option value="">— เลือก Department —</option>{departments.map((department) => <option key={department.departmentName} value={department.departmentName}>{department.departmentName}</option>)}</select></label>
        {selectedMapping ? <>
          <div className="security-site-mapping-grid">{activeSites.map((site) => <label key={site.id} className={`security-site-mapping-option ${mappingSiteIds.includes(site.id) ? 'is-selected' : ''}`}><input type="checkbox" checked={mappingSiteIds.includes(site.id)} onChange={(event) => toggleMappedSite(site.id, event.target.checked)} /><span><strong>{site.code} · {site.name}</strong><small>{site.latitude}, {site.longitude} · {site.geofenceRadiusMeters} ม.</small></span></label>)}</div>
          <label className="field-group"><span>Default / Home Site</span><select value={defaultSiteId} onChange={(event) => setDefaultSiteId(event.target.value)}><option value="">— ไม่มี Default (Attendance จะ BLOCK หาก Schedule ไม่ override) —</option>{activeSites.filter((site) => mappingSiteIds.includes(site.id)).map((site) => <option key={site.id} value={site.id}>{site.code} · {site.name}</option>)}</select><small>ฐานข้อมูลบังคับ unique partial index: 1 Department มี Default ได้ไม่เกิน 1 Site</small></label>
          <button type="button" className="btn-primary" disabled={saving} onClick={() => void saveMapping()}>บันทึก Department Site authority</button>
        </> : <div className="security-site-map-empty">เลือก Department เพื่อกำหนด Allowed Site และ Default Site</div>}
      </article>

      <article className="security-site-admin__card security-site-admin__card--wide">
        <div className="security-site-admin__card-title"><div><h3>Attendance QR lifecycle</h3><small>Server เก็บ SHA-256 hash เท่านั้น · QR token จริงแสดงเฉพาะผล Rotate ครั้งนี้</small></div></div>
        {selectedSite ? <>
          <div className="security-site-qr-state"><span>Site</span><strong>{selectedSite.code} · {selectedSite.name}</strong><span>QR ปัจจุบัน</span><strong>{selectedSite.currentQrCredential ? `Version ${selectedSite.currentQrCredential.version} · ${displayDate(selectedSite.currentQrCredential.validFrom)}` : 'ยังไม่มี Active QR'}</strong></div>
          <div className="security-site-actions"><button type="button" className="btn-primary" disabled={saving || !selectedSite.isActive} onClick={() => void rotateQr()}>Generate / Rotate QR</button>{selectedSite.currentQrCredential && <button type="button" className="danger-action" disabled={saving} onClick={() => void revokeQr()}>Revoke current QR</button>}</div>
          {(rawQrToken || generatedQr) && <div className="security-site-qr-once"><strong>⚠ QR TOKEN — แสดง/สร้างได้จากผลการออกครั้งนี้เท่านั้น</strong><p>Server เก็บ SHA-256 hash เท่านั้น; QR Token จริงมีให้จากผล Rotate ครั้งนี้และไม่สามารถอ่านกลับจากฐานข้อมูลได้</p>{rawQrToken && <code>{rawQrToken}</code>}
            {generatedQr && <>
              <div className="security-site-qr-result" aria-label="QR generated">
                <div className="security-site-qr-result__screen">
                  <div className="security-site-qr-result__meta"><strong>{generatedQr.siteCode} · {generatedQr.siteName}</strong><span>QR Version {generatedQr.credential.version}</span><span>Generated: {displayDate(generatedQr.credential.createdAt)}</span><span>Valid from: {displayDate(generatedQr.credential.validFrom)}</span></div>
                  <img className="security-site-qr-image" src={generatedQr.dataUrl} width={768} height={768} alt={`Attendance QR สำหรับ ${generatedQr.siteCode}`} />
                </div>
                <div className="security-site-actions">{rawQrToken && <button type="button" className="btn-neutral" onClick={() => void copyQrToken()}>คัดลอก Token</button>}<button type="button" className="btn-neutral" onClick={printQr}>พิมพ์ QR</button><button type="button" className="btn-neutral" onClick={saveQr}>บันทึก QR เป็น PNG</button>{rawQrToken && <button type="button" className="btn-neutral" onClick={() => setRawQrToken('')}>ซ่อน Token</button>}</div>
              </div>
            </>}
            {rawQrToken && !generatedQr && <div className="security-site-actions"><button type="button" className="btn-neutral" onClick={() => void copyQrToken()}>คัดลอก Token</button><button type="button" className="btn-neutral" onClick={() => setRawQrToken('')}>ซ่อน Token</button></div>}
          </div>}
        </> : <div className="security-site-map-empty">เลือก Site ก่อนจัดการ QR lifecycle</div>}
      </article>
    </div>

    <footer className="security-site-admin__footnote">การแก้ไข Site / Mapping / QR เป็น Admin-only และมี Audit Log; AttendanceSession ที่เปิดหรือบันทึกแล้วคง expectedSiteId เดิม ไม่ rewrite ตาม Default Site ใหม่</footer>
  </section>;
}
