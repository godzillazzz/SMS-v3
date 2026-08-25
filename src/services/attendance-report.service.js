'use strict';

const { Prisma } = require('@prisma/client');
const { zipSync, strToU8 } = require('fflate');
const prismaDefault = require('../config/prisma');
const HttpError = require('../utils/http-error');
const { parseMonth } = require('./attendance-month-governance.service');

function http(statusCode, code, message) {
  return new HttpError(statusCode, message, { code });
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(number) {
  let result = '';
  for (let value = number; value > 0; value = Math.floor((value - 1) / 26)) {
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  }
  return result;
}

function inlineCell(reference, value, style = 0) {
  return `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function numberCell(reference, value, style = 0) {
  if (value === null || value === undefined || value === '') return inlineCell(reference, '', style);
  return `<c r="${reference}" s="${style}"><v>${Number(value)}</v></c>`;
}

function rowXml(number, cells, height = null) {
  return `<row r="${number}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells.join('')}</row>`;
}

function bangkokDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).format(date);
}

function durationText(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return '-';
  const total = Math.max(0, Number(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${hours}:${String(mins).padStart(2, '0')}`;
}

function attendanceResultText(row) {
  const flags = new Set(Array.isArray(row?.flags) ? row.flags : []);
  const actualSiteName = row?.actualSite?.name || row?.actualSite?.code || '-';
  if (flags.has('LEAVE')) return 'ลา';
  if (flags.has('ABSENT')) return 'ขาดงาน';
  if (flags.has('MISSING_CHECK_OUT')) return 'เวลาผิดปกติ / ไม่มีเวลาออก';
  if (flags.has('TIME_ABNORMAL')) return 'เวลาผิดปกติ';
  if (flags.has('OUTSIDE_ALL_SITES')) return 'อยู่นอกพื้นที่ Site ที่กำหนด';
  if (flags.has('WRONG_SHIFT')) return 'ลงเวลาผิดกะ';
  if (flags.has('ASSIST_OTHER_SITE')) return `ช่วยปฏิบัติงาน ณ ${actualSiteName}`;
  if (flags.has('EARLY_OUT') && flags.has('LATE')) return 'มาสาย / ออกก่อนเวลา';
  if (flags.has('EARLY_OUT')) return 'ออกก่อนเวลา';
  if (flags.has('LATE')) return 'มาสาย';
  if (flags.has('ON_TIME')) return 'ปกติ';
  if (row?.status === 'LEAVE') return 'ลา';
  if (row?.status === 'ABSENT') return 'ขาดงาน';
  return String(row?.status || '-');
}

function reportId(certification) {
  const month = certification?.snapshot?.month || certification?.month || 'unknown';
  const revision = Number(certification?.revision || 0);
  const shortId = String(certification?.id || 'unknown').replace(/-/g, '').slice(0, 8).toUpperCase();
  return `ATT-${month}-R${revision}-${shortId}`;
}

function normalizedCertification(row) {
  const snapshot = row?.summarySnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || !Array.isArray(snapshot.rows)) {
    throw http(409, 'ATTENDANCE_CERTIFICATION_SNAPSHOT_INVALID', 'Certified Attendance snapshot is invalid.');
  }
  return {
    id: row.id,
    month: row.month,
    revision: Number(row.revision),
    status: row.status,
    summaryDigest: row.summaryDigest,
    certifiedByUserId: row.certifiedByUserId,
    certifiedAt: row.certifiedAt,
    snapshot
  };
}

async function loadCertifiedAttendanceMonth(month, client = prismaDefault) {
  const period = parseMonth(month);
  const rows = await client.$queryRaw(Prisma.sql`
    SELECT
      id,
      month,
      revision,
      status::text AS status,
      summary_snapshot AS "summarySnapshot",
      summary_digest AS "summaryDigest",
      certified_by_user_id AS "certifiedByUserId",
      certified_at AS "certifiedAt"
    FROM attendance_month_certifications
    WHERE month = ${period.start}::date AND status = 'CERTIFIED'
    ORDER BY revision DESC
    LIMIT 1
  `);
  if (!rows.length) throw http(409, 'ATTENDANCE_MONTH_NOT_CERTIFIED', 'Attendance month must be certified before official report export.');
  return normalizedCertification(rows[0]);
}

function attendanceSheetXml(certification) {
  const snapshot = certification.snapshot;
  const columns = [
    'วันที่', 'รหัสพนักงาน', 'ชื่อ-นามสกุล', 'หน่วยงาน',
    'Expected Site', 'Actual Site', 'กะ', 'เวลาเริ่มตามกะ', 'เวลาเลิกตามกะ',
    'เวลาเข้า', 'เวลาออก', 'ชั่วโมงทำงาน', 'สาย (นาที)', 'ออกก่อน (นาที)',
    'Flags', 'ผลการลงเวลา'
  ];
  const rows = [];
  rows.push(rowXml(1, [inlineCell('A1', 'Security Management System — Official Attendance Report', 1)], 32));
  rows.push(rowXml(2, [inlineCell('A2', `Period: ${snapshot.month}  |  Revision: ${certification.revision}  |  Report ID: ${reportId(certification)}`, 2)], 24));
  rows.push(rowXml(3, [inlineCell('A3', `Certified At: ${bangkokDateTime(certification.certifiedAt)}  |  Digest: ${certification.summaryDigest}`, 3)], 22));
  rows.push(rowXml(5, columns.map((value, index) => inlineCell(`${columnName(index + 1)}5`, value, 4)), 30));

  snapshot.rows.forEach((row, index) => {
    const rowNumber = index + 6;
    const values = [
      row.workDate || '-',
      row.employeeCode || '-',
      row.employeeName || '-',
      row.department || '-',
      row.expectedSite?.name || row.expectedSite?.code || '-',
      row.actualSite?.name || row.actualSite?.code || '-',
      row.shift?.code || row.shift?.name || '-',
      bangkokDateTime(row.expectedStartAt),
      bangkokDateTime(row.expectedEndAt),
      bangkokDateTime(row.checkInAt),
      bangkokDateTime(row.checkOutAt),
      durationText(row.workedMinutes),
      row.lateMinutes,
      row.earlyOutMinutes,
      (row.flags || []).join(', '),
      attendanceResultText(row)
    ];
    const cells = values.map((value, colIndex) => {
      const reference = `${columnName(colIndex + 1)}${rowNumber}`;
      return [12, 13].includes(colIndex) ? numberCell(reference, value, 5) : inlineCell(reference, value, colIndex === 15 ? 6 : 5);
    });
    rows.push(rowXml(rowNumber, cells, 22));
  });

  const lastColumn = columnName(columns.length);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>
    <col min="1" max="1" width="12" customWidth="1"/><col min="2" max="2" width="15" customWidth="1"/>
    <col min="3" max="4" width="24" customWidth="1"/><col min="5" max="7" width="20" customWidth="1"/>
    <col min="8" max="11" width="20" customWidth="1"/><col min="12" max="14" width="14" customWidth="1"/>
    <col min="15" max="15" width="40" customWidth="1"/><col min="16" max="16" width="30" customWidth="1"/>
  </cols>
  <sheetData>${rows.join('')}</sheetData>
  <mergeCells count="3"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/><mergeCell ref="A3:${lastColumn}3"/></mergeCells>
  <autoFilter ref="A5:${lastColumn}${Math.max(5, snapshot.rows.length + 5)}"/>
  <pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/>
</worksheet>`;
}

function summarySheetXml(certification, generatedBy, generatedAt) {
  const snapshot = certification.snapshot;
  const entries = [
    ['Report ID', reportId(certification)],
    ['Period', snapshot.month],
    ['Revision', certification.revision],
    ['Certification status', certification.status],
    ['Certified at', bangkokDateTime(certification.certifiedAt)],
    ['Certified by user ID', certification.certifiedByUserId],
    ['Summary digest', certification.summaryDigest],
    ['Generated at', bangkokDateTime(generatedAt)],
    ['Generated by', generatedBy || '-'],
    ['Assignments', snapshot.summary?.assignments ?? 0],
    ['Complete', snapshot.summary?.complete ?? 0],
    ['Absent', snapshot.summary?.absent ?? 0],
    ['Leave', snapshot.summary?.leave ?? 0],
    ['Late', snapshot.summary?.late ?? 0],
    ['Early out', snapshot.summary?.earlyOut ?? 0],
    ['Assist other site', snapshot.summary?.assistOtherSite ?? 0],
    ['Wrong shift', snapshot.summary?.wrongShift ?? 0],
    ['Outside all sites', snapshot.summary?.outsideAllSites ?? 0],
    ['Corrected', snapshot.summary?.corrected ?? 0],
    ['Time abnormal', snapshot.summary?.timeAbnormal ?? 0]
  ];
  const rows = [rowXml(1, [inlineCell('A1', 'Official Attendance Report — Metadata & Summary', 1)], 32)];
  entries.forEach(([label, value], index) => {
    const rowNumber = index + 3;
    rows.push(rowXml(rowNumber, [inlineCell(`A${rowNumber}`, label, 4), inlineCell(`B${rowNumber}`, value, 5)], 22));
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>
  <cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="58" customWidth="1"/></cols>
  <sheetData>${rows.join('')}</sheetData>
  <mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>
</worksheet>`;
}

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4"><font><sz val="10"/><name val="Noto Sans Thai"/></font><font><b/><sz val="15"/><color rgb="FFFFFFFF"/><name val="Noto Sans Thai"/></font><font><b/><sz val="10"/><color rgb="FF173566"/><name val="Noto Sans Thai"/></font><font><sz val="9"/><color rgb="FF475569"/><name val="Noto Sans Thai"/></font></fonts>
  <fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173566"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F1FF"/></patternFill></fill></fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FFD7E7FA"/></left><right style="thin"><color rgb="FFD7E7FA"/></right><top style="thin"><color rgb="FFD7E7FA"/></top><bottom style="thin"><color rgb="FFD7E7FA"/></bottom></border></borders>
  <cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs>
</styleSheet>`;

function buildAttendanceWorkbook({ certification, generatedBy = '-', generatedAt = new Date() }) {
  const normalized = normalizedCertification({
    ...certification,
    summarySnapshot: certification.snapshot || certification.summarySnapshot
  });
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Attendance" sheetId="1" r:id="rId1"/><sheet name="Summary" sheetId="2" r:id="rId2"/></sheets></workbook>`;
  const files = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`),
    'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Official Attendance Report ${xmlEscape(normalized.snapshot.month)}</dc:title><dc:creator>SMS V3</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date(generatedAt).toISOString()}</dcterms:created></cp:coreProperties>`),
    'docProps/app.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>SMS V3</Application></Properties>`),
    'xl/workbook.xml': strToU8(workbookXml),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(stylesXml),
    'xl/worksheets/sheet1.xml': strToU8(attendanceSheetXml(normalized)),
    'xl/worksheets/sheet2.xml': strToU8(summarySheetXml(normalized, generatedBy, generatedAt))
  };
  return Buffer.from(zipSync(files, { level: 6 }));
}

function createAttendanceReportService({ prisma = prismaDefault, clock = () => new Date() } = {}) {
  async function official({ actor, month } = {}, client = prisma) {
    const certification = await loadCertifiedAttendanceMonth(month, client);
    const user = actor?.sub ? await client.user.findUnique({ where: { id: actor.sub }, select: { displayName: true, email: true } }) : null;
    const generatedAt = clock();
    return {
      reportId: reportId(certification),
      period: certification.snapshot.month,
      revision: certification.revision,
      certificationStatus: certification.status,
      summaryDigest: certification.summaryDigest,
      certifiedAt: certification.certifiedAt,
      certifiedByUserId: certification.certifiedByUserId,
      generatedAt,
      generatedBy: user?.displayName || user?.email || actor?.sub || '-',
      summary: certification.snapshot.summary || {},
      rows: certification.snapshot.rows
    };
  }

  async function workbook({ actor, month } = {}, client = prisma) {
    const certification = await loadCertifiedAttendanceMonth(month, client);
    const user = actor?.sub ? await client.user.findUnique({ where: { id: actor.sub }, select: { displayName: true, email: true } }) : null;
    const generatedAt = clock();
    const generatedBy = user?.displayName || user?.email || actor?.sub || '-';
    return {
      buffer: buildAttendanceWorkbook({ certification, generatedBy, generatedAt }),
      fileName: `SMS-Attendance-${certification.snapshot.month}-R${certification.revision}.xlsx`,
      reportId: reportId(certification),
      generatedAt,
      generatedBy
    };
  }

  return { official, workbook };
}

module.exports = {
  attendanceResultText,
  bangkokDateTime,
  durationText,
  reportId,
  normalizedCertification,
  loadCertifiedAttendanceMonth,
  buildAttendanceWorkbook,
  createAttendanceReportService
};
