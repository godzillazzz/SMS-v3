export function DataSyncStatusCard() {
  return <section className="dashboard-panel dashboard-sync-status">
    <header className="dashboard-panel__header"><div><p>SYSTEM & DATA STATUS</p><h2>สถานะข้อมูลระบบ</h2></div><span className="dashboard-panel__unavailable">Unavailable</span></header>
    <div className="dashboard-sync-status__body"><span className="dashboard-sync-status__icon" aria-hidden="true">⌁</span><div><b>ไม่พบข้อมูลสถานะการซิงโครไนซ์</b><small>ระบบยังไม่มี endpoint สำหรับรายงานการซิงโครไนซ์และเวลาปรับปรุงล่าสุด</small></div></div>
  </section>;
}
