export function RecentActivityCard() {
  return <section className="dashboard-panel dashboard-recent-activity">
    <header className="dashboard-panel__header"><div><p>RECENT ACTIVITY</p><h2>กิจกรรมล่าสุด</h2></div><span className="dashboard-panel__unavailable">Unavailable</span></header>
    <div className="dashboard-unavailable"><span aria-hidden="true">◌</span><div><b>ยังไม่มีข้อมูลกิจกรรมล่าสุด</b><small>Dashboard API ปัจจุบันยังไม่ส่งข้อมูล activity feed</small></div></div>
  </section>;
}
