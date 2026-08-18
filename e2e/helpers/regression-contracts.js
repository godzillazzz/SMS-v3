const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../..');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function requireIncludes(content, expected, code) {
  for (const value of expected) {
    if (!content.includes(value)) {
      const error = new Error(`${code}: ${value}`);
      error.code = code;
      throw error;
    }
  }
}

function sourceRegressionContracts() {
  const dataQualityPage = readProjectFile('frontend/src/pages/data-quality/DataQualityCenterPage.tsx');
  const dataQualityStyles = readProjectFile('frontend/src/styles/data-quality.css');
  const dataQualityResponsive = readProjectFile('frontend/src/styles/data-quality-responsive.css');
  const auditTable = readProjectFile('frontend/src/components/audit/AuditTable.tsx');
  const auditComplianceStyles = readProjectFile('frontend/src/styles/audit-compliance.css');
  const auditMobileStyles = readProjectFile('frontend/src/styles/audit-mobile.css');
  const dashboardPage = readProjectFile('frontend/src/pages/dashboard/DashboardPage.tsx');
  const executiveReportPage = readProjectFile('frontend/src/pages/executive-report/ExecutiveReportCenterPage.tsx');
  const executiveReportStyles = readProjectFile('frontend/src/styles/executive-report.css');
  const lifecycleModal = readProjectFile('frontend/src/components/personnel/EmployeeLifecycleModal.tsx');
  const lifecycleStyles = readProjectFile('frontend/src/styles/employee-lifecycle.css');

  requireIncludes(dataQualityPage, [
    'data-quality-desktop-table',
    '<thead>',
    '<tbody>',
    'data-quality-mobile-cards',
    'data-quality-mobile-card',
    'data-quality-target'
  ], 'DATA_QUALITY_RENDERER_CONTRACT_FAILED');
  if (!/<table\b[^>]*>/.test(dataQualityPage)) {
    const error = new Error('DATA_QUALITY_RENDERER_CONTRACT_FAILED: <table element>');
    error.code = 'DATA_QUALITY_RENDERER_CONTRACT_FAILED';
    throw error;
  }
  requireIncludes(dataQualityStyles, [
    '.data-quality-desktop-table{display:block',
    '.data-quality-mobile-cards{display:none}',
    '@media(max-width:640px)',
    '.data-quality-desktop-table{display:none}',
    '.data-quality-mobile-cards{display:grid',
    'overflow-x:auto'
  ], 'DATA_QUALITY_RESPONSIVE_CONTRACT_FAILED');
  requireIncludes(dataQualityResponsive, [
    'min-width: 1120px;',
    'width: 170px;',
    'min-width: 170px;',
    'white-space: nowrap;',
    'min-width: 148px;'
  ], 'DATA_QUALITY_ACTION_CONTRACT_FAILED');
  if (/\.data-quality-desktop-table[^}]*\bheight\s*:/i.test(dataQualityStyles)) {
    throw new Error('DATA_QUALITY_FIXED_ROW_HEIGHT_CONTRACT_FAILED');
  }

  requireIncludes(auditTable, [
    'audit-desktop-table',
    '<thead>',
    '<tbody>',
    'audit-mobile-cards',
    'audit-mobile-card',
    'audit-preview-link',
    'ดูรายละเอียด'
  ], 'AUDIT_RENDERER_CONTRACT_FAILED');
  if (!/<table\b[^>]*className="[^"]*\baudit-table\b[^"]*"[^>]*>/.test(auditTable)) {
    const error = new Error('AUDIT_RENDERER_CONTRACT_FAILED: <table class token audit-table>');
    error.code = 'AUDIT_RENDERER_CONTRACT_FAILED';
    throw error;
  }
  if (auditTable.includes('data-label=')) {
    throw new Error('AUDIT_DATA_LABEL_RENDERING_CONTRACT_FAILED');
  }
  requireIncludes(auditMobileStyles, [
    '.audit-desktop-table .audit-table tbody tr {\n  display: table-row;',
    '.audit-desktop-table .audit-table tbody td {\n  display: table-cell !important;',
    '.audit-desktop-table .audit-table tbody td::before {\n  display: none;',
    '.audit-mobile-cards,\n.audit-mobile-empty {\n  display: none;',
    '@media (max-width: 640px)',
    '  .audit-desktop-table {\n    display: none;',
    '  .audit-mobile-cards {\n    display: grid;'
  ], 'AUDIT_RESPONSIVE_CONTRACT_FAILED');
  if (!/@media\s*\(max-width:\s*760px\)/.test(auditComplianceStyles)) {
    throw new Error('AUDIT_LEGACY_BREAKPOINT_CONTRACT_MISSING');
  }

  requireIncludes(dashboardPage, [
    '!error && partialErrors.length > 0',
    'dashboard-data-warning',
    'ข้อมูลบางส่วนยังไม่พร้อม'
  ], 'DASHBOARD_PARTIAL_WARNING_CONTRACT_FAILED');

  requireIncludes(executiveReportPage, [
    'executive-report-kpis',
    'executive-report-grid',
    'executive-report-attention',
    'ExecutiveReportPrint',
    "printDocument('.executive-report-print', filename)"
  ], 'EXECUTIVE_REPORT_RENDERER_CONTRACT_FAILED');
  requireIncludes(executiveReportStyles, [
    '.executive-report-kpis { display:grid;',
    'grid-template-columns:repeat(5,minmax(0,1fr))',
    '@media (max-width:760px)',
    '@media (max-width:430px)',
    'white-space:nowrap',
    '@media print',
    'break-before:auto'
  ], 'EXECUTIVE_REPORT_RESPONSIVE_CONTRACT_FAILED');

  requireIncludes(lifecycleModal, [
    'จัดการวงจรพนักงาน',
    'ผลกระทบและคำเตือน',
    'ประวัติวงจรพนักงาน',
    'อ่านอย่างเดียว',
    'confirmation !== employee.employeeCode'
  ], 'EMPLOYEE_LIFECYCLE_RENDERER_CONTRACT_FAILED');
  requireIncludes(lifecycleStyles, [
    'max-height:calc(100dvh - 40px)',
    '@media(max-width:850px)',
    '@media(max-width:520px)',
    'grid-template-columns:1fr',
    'white-space:nowrap'
  ], 'EMPLOYEE_LIFECYCLE_RESPONSIVE_CONTRACT_FAILED');

  return {
    dataQuality: true,
    audit: true,
    dashboardWarning: true,
    executiveReport: true,
    employeeLifecycle: true
  };
}

function dashboardWarningVisible({ error, partialErrors }) {
  return !error && Array.isArray(partialErrors) && partialErrors.length > 0;
}

function assertResponsiveLayoutMetrics({
  renderer,
  desktopVisible,
  mobileVisible,
  buttonWidth,
  buttonClientWidth,
  buttonScrollWidth,
  rowHeight,
  pageOverflow,
  minimumButtonWidth = 140
}) {
  if (desktopVisible === mobileVisible) {
    const error = new Error('RENDERER_MODE_LEAK');
    error.code = 'RENDERER_MODE_LEAK';
    throw error;
  }
  if ((renderer === 'desktop' && !desktopVisible) || (renderer === 'mobile' && !mobileVisible)) {
    const error = new Error('RENDERER_MODE_NOT_VISIBLE');
    error.code = 'RENDERER_MODE_NOT_VISIBLE';
    throw error;
  }
  if (buttonWidth < minimumButtonWidth) {
    const error = new Error('ACTION_BUTTON_COLLAPSED');
    error.code = 'ACTION_BUTTON_COLLAPSED';
    throw error;
  }
  if (buttonScrollWidth > buttonClientWidth + 1) {
    const error = new Error('ACTION_BUTTON_WRAP');
    error.code = 'ACTION_BUTTON_WRAP';
    throw error;
  }
  if (renderer === 'desktop' && rowHeight > 180) {
    const error = new Error('ROW_HEIGHT_ABNORMAL');
    error.code = 'ROW_HEIGHT_ABNORMAL';
    throw error;
  }
  if (pageOverflow) {
    const error = new Error('PAGE_HORIZONTAL_OVERFLOW');
    error.code = 'PAGE_HORIZONTAL_OVERFLOW';
    throw error;
  }
}

function buildDocument(styles, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:100%;min-height:100%;font-family:Arial,sans-serif}*{box-sizing:border-box}${styles}</style></head><body>${body}</body></html>`;
}

function dataQualityFixture() {
  const rows = [
    ['LEAVE_QUOTA_UNMATCHED', 'Leave Quota', 'Sermpong Tanos', 'SSO Manager', 'UNMATCHED', 'เปิดโควต้าวันลา'],
    ['LICENSE_EXPIRED', 'License', 'UAT Employee', 'Security Operations', 'หมดอายุ', 'เปิดใบอนุญาต']
  ];
  const desktopRows = rows.map(([rule, module, employee, department, detected, action]) => `<tr><td><span class="data-quality-severity critical">วิกฤต</span></td><td><strong>${rule}</strong><small>ตรวจพบข้อมูลที่ต้องติดตาม</small></td><td>${module}</td><td>${employee}<small>UAT-001</small></td><td>${department}</td><td>${detected}</td><td><button type="button" class="data-quality-target">${action}</button></td></tr>`).join('');
  const mobileCards = rows.map(([rule, module, employee, department, detected, action]) => `<article class="data-quality-mobile-card"><header><span class="data-quality-severity critical">วิกฤต</span><span>${module}</span></header><h2>${rule}</h2><p>ตรวจพบข้อมูลที่ต้องติดตาม</p><dl><div><dt>พนักงาน</dt><dd>${employee}<small>UAT-001</small></dd></div><div><dt>แผนก</dt><dd>${department}</dd></div><div><dt>ค่าที่ตรวจพบ</dt><dd>${detected}</dd></div></dl><footer><button type="button" class="data-quality-target">${action}</button></footer></article>`).join('');
  return `<main class="data-quality-page"><div class="data-quality-desktop-table"><div class="data-quality-table-scroll"><table><thead><tr><th>ระดับ</th><th>กฎตรวจสอบ</th><th>Module</th><th>พนักงาน</th><th>แผนก</th><th>ค่าที่ตรวจพบ</th><th>ไปยังข้อมูล</th></tr></thead><tbody>${desktopRows}</tbody></table></div></div><div class="data-quality-mobile-cards" aria-label="รายการคุณภาพข้อมูลสำหรับมือถือ">${mobileCards}</div></main>`;
}

function auditFixture() {
  return `<main class="audit-compliance-page"><div class="audit-table-card"><div class="audit-desktop-table"><div class="audit-table-scroll"><table class="audit-table"><thead><tr><th scope="col">วันและเวลา</th><th scope="col">ผู้ดำเนินการ</th><th scope="col">Module</th><th scope="col">การดำเนินการ</th><th scope="col">ข้อมูลเป้าหมาย</th><th scope="col">รายละเอียด</th></tr></thead><tbody><tr><td>11 ส.ค. 2569 09:00</td><td><strong>UAT Admin</strong><small>ADMIN</small></td><td><span class="audit-module-badge">Leave</span></td><td><span class="audit-action-badge">APPROVED</span><small>อนุมัติใบลา</small></td><td><strong>LeaveRequest</strong><small class="audit-entity-id">request-1234567890</small></td><td><span class="audit-row-summary">รายการธุรกิจสำหรับ regression guard</span><button type="button" class="audit-preview-link">ดูรายละเอียด</button></td></tr></tbody></table></div></div><div class="audit-mobile-cards" aria-label="รายการ Audit Log"><article class="audit-mobile-card"><header><time>11 ส.ค. 2569 09:00</time><span class="audit-role-badge">ADMIN</span></header><div class="audit-mobile-actor"><span class="audit-mobile-label">ผู้ดำเนินการ</span><strong>UAT Admin</strong></div><div class="audit-mobile-facts"><div><span class="audit-mobile-label">Module</span><span class="audit-module-badge">Leave</span></div><div><span class="audit-mobile-label">Action</span><span class="audit-action-badge">APPROVED</span></div></div><div class="audit-mobile-target"><span class="audit-mobile-label">ข้อมูลเป้าหมาย</span><strong>LeaveRequest</strong><small class="audit-entity-id">request-1234567890</small></div><div class="audit-mobile-summary"><span class="audit-mobile-label">รายละเอียดสั้น</span><p>รายการธุรกิจสำหรับ regression guard</p></div><footer><small>อนุมัติใบลา</small><button type="button" class="audit-preview-link">ดูรายละเอียด</button></footer></article></div></div></main>`;
}

function executiveReportFixture() {
  const cards = ['พนักงานที่ปฏิบัติงาน', 'รายการจัดเวร', 'คำขอลาในช่วงเวลา', 'ใบอนุญาตหมดอายุ', 'ประเด็นคุณภาพข้อมูล']
    .map((label, index) => `<article class="executive-report-kpi ${index === 3 ? 'critical' : 'neutral'}"><span>${label}</span><strong>${index + 1}</strong><small>รายการ</small></article>`).join('');
  const bars = ['ฝ่ายปฏิบัติการ', 'ลาป่วย', 'ใบอนุญาตหมดอายุ'].map((label, index) => `<div class="executive-report-bar"><span>${label}</span><div><i style="width:${60 + index * 10}%"></i></div><b>${index + 1}</b></div>`).join('');
  return `<main class="executive-report-page"><header class="executive-report-heading"><div><p class="eyebrow">EXECUTIVE REPORT CENTER</p><h1>รายงานผู้บริหาร</h1></div><div class="executive-report-actions"><button>รีเฟรช</button><button>ส่งออก PDF</button></div></header><div class="executive-report-filters"><label><span>เดือน</span><select><option>สิงหาคม</option></select></label><label><span>ปี</span><select><option>พ.ศ. 2569</option></select></label></div><div class="executive-report-kpis">${cards}</div><div class="executive-report-grid"><section class="executive-report-panel"><header><h2>กำลังพลและการจัดเวร</h2><button class="executive-report-link">ดูรายละเอียด</button></header><div class="executive-report-stat-grid"><div><span>พนักงานทั้งหมด</span><b>12 คน</b></div><div><span>พนักงานที่ปฏิบัติงาน</span><b>10 คน</b></div><div><span>รายการจัดเวร</span><b>80 รายการ</b></div></div><section class="executive-report-chart"><h3>พนักงานตามหน่วยงาน</h3>${bars}</section></section><section class="executive-report-panel"><header><h2>คุณภาพข้อมูล</h2><button class="executive-report-link">ดูรายละเอียด</button></header><section class="executive-report-chart"><h3>ประเด็นตามกฎตรวจสอบ</h3>${bars}</section></section></div><section class="executive-report-panel executive-report-attention"><header><h2>ประเด็นที่ผู้บริหารควรติดตาม</h2></header><div class="executive-report-attention-list"><article class="warning"><div><span>warning</span><h3>ใบอนุญาตใกล้หมดอายุ</h3><p>รายละเอียดเพื่อการติดตาม</p></div><b>2</b><button class="executive-report-link">ดูรายละเอียด</button></article></div></section></main>`;
}

function employeeLifecycleFixture() {
  return `<div class="lifecycle-backdrop"><section class="lifecycle-modal"><header class="lifecycle-header"><div><p>EMPLOYEE LIFECYCLE</p><h2>จัดการวงจรพนักงาน</h2><span>EMP001 · พนักงานทดสอบ ชื่อภาษาไทยยาวเพื่อทดสอบการแสดงผล</span></div><button type="button">×</button></header><div class="lifecycle-layout"><form class="lifecycle-form"><div class="lifecycle-current"><strong>ข้อมูลปัจจุบัน</strong><span>หน่วยงานรักษาความปลอดภัยสำนักงานใหญ่ · เจ้าหน้าที่รักษาความปลอดภัยอาวุโส · ปฏิบัติงาน</span></div><label><span>รายการ</span><select><option>ย้ายแผนก</option></select></label><div class="lifecycle-field-grid"><label><span>วันที่มีผล</span><input type="date" value="2026-09-01"></label><label><span>เหตุผล</span><textarea>ปรับโครงสร้างหน่วยงาน</textarea></label></div><section class="lifecycle-preflight"><h3>ผลกระทบและคำเตือน</h3><div class="lifecycle-issue"><b>ควรตรวจสอบ</b><span>พบรายการจัดเวรตั้งแต่วันที่มีผล</span></div><dl class="lifecycle-impact-grid"><div><dt>เวรในอนาคต</dt><dd>12</dd></div><div><dt>ลารอพิจารณา</dt><dd>2</dd></div><div><dt>โควต้าวันลา</dt><dd>1</dd></div><div><dt>ใบอนุญาตใช้งาน</dt><dd>1</dd></div></dl></section><footer><button>ยกเลิก</button><button class="btn-primary">ยืนยันย้ายแผนก</button></footer></form><aside class="lifecycle-history"><header><h3>ประวัติวงจรพนักงาน</h3><span>อ่านอย่างเดียว</span></header><ol><li><div><b>เปลี่ยนชื่อ</b><span class="lifecycle-status lifecycle-status--applied">มีผลแล้ว</span></div><time>13 ส.ค. 2569</time><strong>ชื่อเดิม → ชื่อใหม่</strong><p>เหตุผล: แก้ไขชื่อตามเอกสารทางราชการ</p><small>โดย UAT Admin (ADMIN) · บันทึก 13 ส.ค. 2569 10:00</small></li></ol></aside></div></section></div>`;
}

module.exports = {
  assertResponsiveLayoutMetrics,
  auditFixture,
  buildDocument,
  dashboardWarningVisible,
  dataQualityFixture,
  executiveReportFixture,
  employeeLifecycleFixture,
  readProjectFile,
  sourceRegressionContracts
};
