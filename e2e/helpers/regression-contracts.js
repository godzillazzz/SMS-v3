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

  requireIncludes(dataQualityPage, [
    'data-quality-desktop-table',
    '<table>',
    '<thead>',
    '<tbody>',
    'data-quality-mobile-cards',
    'data-quality-mobile-card',
    'data-quality-target'
  ], 'DATA_QUALITY_RENDERER_CONTRACT_FAILED');
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
    '<table className="audit-table">',
    '<thead>',
    '<tbody>',
    'audit-mobile-cards',
    'audit-mobile-card',
    'audit-preview-link',
    'ดูรายละเอียด'
  ], 'AUDIT_RENDERER_CONTRACT_FAILED');
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

  return {
    dataQuality: true,
    audit: true,
    dashboardWarning: true
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

module.exports = {
  assertResponsiveLayoutMetrics,
  auditFixture,
  buildDocument,
  dashboardWarningVisible,
  dataQualityFixture,
  readProjectFile,
  sourceRegressionContracts
};
