export function DataSyncStatusCard({ generatedAt }: { generatedAt?: string }) {
  return <section className="dashboard-panel dashboard-sync-status">
    <header className="dashboard-panel__header"><div><p>SYSTEM & DATA STATUS</p><h2>สถานะข้อมูลระบบ</h2></div><span className="dashboard-panel__unavailable">อ่านอย่างเดียว</span></header>
    <div className="dashboard-sync-status__body"><span className="dashboard-sync-status__icon" aria-hidden="true">✓</span><div><b>ข้อมูลพร้อมใช้งาน</b><small>{generatedAt ? `อัปเดตล่าสุด ${new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(generatedAt))}` : 'เวลาปรับปรุงจะแสดงเมื่อโหลดข้อมูลสำเร็จ'}</small></div></div>
  </section>;
}
