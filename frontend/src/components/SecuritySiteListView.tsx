import type { SecuritySite } from '../api';
import '../styles/security-site-list.css';
import { EditIconButton } from './EditIconButton';

type OverlapRef = { siteId: string; otherSiteId: string };

const coordinate = (value: string | null) => {
  const parsed = Number(value);
  return value !== null && value !== '' && Number.isFinite(parsed) ? parsed.toFixed(6) : null;
};

// Owner request 2026-10-28: the site page opens on an HR-PRO style list; editing, map and QR live in the detail view.
export function SecuritySiteListView({ sites, overlaps, loading, onOpen }: {
  sites: SecuritySite[];
  overlaps: OverlapRef[];
  loading: boolean;
  onOpen(site: SecuritySite | null): void;
}) {
  const overlapIds = new Set(overlaps.flatMap((warning) => [warning.siteId, warning.otherSiteId]));
  return <section className="security-site-list" aria-label="รายการจุดรักษาความปลอดภัย">
    <div className="data-table-scroll">
      <table className="data-surface-table security-site-list__table">
        <thead><tr><th scope="col">ชื่อบริเวณ</th><th scope="col">รหัส</th><th scope="col">พิกัด</th><th scope="col">รัศมี</th><th scope="col">QR</th><th scope="col">สถานะ</th><th scope="col"><span className="sr-only">จัดการ</span></th></tr></thead>
        <tbody>
          {loading && !sites.length ? <tr><td colSpan={7} className="security-site-list__empty">กำลังโหลดรายการ…</td></tr>
            : sites.length ? sites.map((site) => {
              const lat = coordinate(site.latitude);
              const lng = coordinate(site.longitude);
              const departments = Array.from(new Set(site.departmentLinks.map((link) => link.departmentName).filter(Boolean)));
              return <tr key={site.id}>
                <td>
                  <button type="button" className="security-site-list__name" onClick={() => onOpen(site)}>{site.name}</button>
                  <small className="security-site-list__sub">{departments.length ? `แผนก: ${departments.join(', ')}` : 'ยังไม่ผูกแผนก'}{overlapIds.has(site.id) && <span className="security-site-list__warn">พื้นที่ซ้อนทับ</span>}</small>
                </td>
                <td className="security-site-list__code">{site.code}</td>
                <td>{lat && lng
                  ? <a className="security-site-list__coord" href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`} target="_blank" rel="noopener noreferrer">{lat}, {lng}</a>
                  : <span className="security-site-list__muted">ยังไม่กำหนด</span>}</td>
                <td className="tabular"><strong>{site.geofenceRadiusMeters} ม.</strong></td>
                <td>{site.currentQrCredential
                  ? <span className="security-site-list__qr">ฉบับ {site.currentQrCredential.version}</span>
                  : <span className="security-site-list__muted">ยังไม่ออก QR</span>}</td>
                <td><span className={`security-site-list__status ${site.isActive ? 'is-active' : 'is-inactive'}`}>{site.isActive ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span></td>
                <td><div className="security-site-list__actions">
                  <EditIconButton label={`แก้ไข ${site.code}`} onClick={() => onOpen(site)} />
                </div></td>
              </tr>;
            }) : <tr><td colSpan={7} className="security-site-list__empty">ยังไม่มีบริเวณลงเวลา กด “เพิ่มบริเวณ” เพื่อสร้างรายการแรก</td></tr>}
        </tbody>
      </table>
    </div>
    {sites.length > 0 && <p className="security-site-list__count">{sites.length} รายการ</p>}
  </section>;
}
