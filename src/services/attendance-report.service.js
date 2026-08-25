'use strict';

const { Prisma } = require('@prisma/client');
const { zipSync, strToU8 } = require('fflate');
const prismaDefault = require('../config/prisma');
const HttpError = require('../utils/http-error');

function http(statusCode, code, message) {
  return new HttpError(statusCode, message, { code });
}

function parseMonth(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}$/.test(text)) throw http(400, 'ATTENDANCE_REPORT_MONTH_INVALID', 'Attendance report month must use YYYY-MM.');
  const date = new Date(`${text}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 7) !== text) throw http(400, 'ATTENDANCE_REPORT_MONTH_INVALID', 'Attendance report month is invalid.');
  return { text, date };
}

function xmlEscape(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function columnName(number) {
  let result = '';
  for (let value = number; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}

function cell(reference, value, style = 0) {
  return `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function rowXml(number, values, style = 0) {
  return `<row r="${number}">${values.map((value, index) => cell(`${columnName(index + 1)}${number}`, value, style)).join('')}</row>`;
}

function iso(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toISOString();
}

function textSite(site) {
  if (!site) return '-';
  return [site.code, site.name].filter(Boolean).join(' - ') || '-';
}

function reportRows(snapshot) {
  return (Array.isArray(snapshot?.rows) ? snapshot.rows : []).map((row) => ({
    date: row.workDate || row.date || '-',
    employeeCode: row.employeeCode || '-',
    employeeName: row.employeeName || '-',
    department: row.department || '-',
    expectedSite: textSite(row.expectedSite),
    actualSite: row.actualSite ? textSite(row.actualSite) : (row.actualSiteId || '-'),
    shift: [row.shift?.code, row.shift?.name].filter(Boolean).join(' - ') || '-',
    expectedStartAt: iso(row.expectedStartAt),
    expectedEndAt: iso(row.expectedEndAt),
    originalCheckInAt: iso(row.originalCheckInAt),
    originalCheckOutAt: iso(row.originalCheckOutAt),
    checkInAt: iso(row.checkInAt),
    checkOutAt: iso(row.checkOutAt),
    workedMinutes: row.workedMinutes == null ? '-' : String(row.workedMinutes),
    status: row.status || row.attendanceStatus || '-',
    flags: Array.isArray(row.flags) ? row.flags.join(', ') : '-',
    correctionCount: Array.isArray(row.corrections) ? String(row.corrections.length) : '0'
  }));
}

async function loadCertifiedSnapshot(client, month) {
  const period = parseMonth(month);
  const rows = await client.$queryRaw(Prisma.sql`
    SELECT id, month, revision, status,
      summary_snapshot AS "summarySnapshot",
      summary_digest AS "summaryDigest",
      certified_by_user_id AS "certifiedByUserId",
      certified_at AS "certifiedAt"
    FROM attendance_month_certifications
    WHERE month = ${period.date}::date AND status = 'CERTIFIED'
    LIMIT 1
  `);
  if (!rows.length) throw http(409, 'ATTENDANCE_REPORT_NOT_CERTIFIED', 'Attendance month must be certified before official report export.');
  const row = rows[0];
  return {
    certificationId: row.id,
    month: period.text,
    revision: Number(row.revision),
    status: String(row.status),
    summaryDigest: row.summaryDigest,
    certifiedByUserId: row.certifiedByUserId,
    certifiedAt: row.certifiedAt,
    snapshot: row.summarySnapshot
  };
}

const headers = [
  'Date', 'Employee code', 'Employee name', 'Department', 'Expected Site', 'Actual Site', 'Expected Shift',
  'Expected start', 'Expected end', 'Original in', 'Original out', 'Actual in', 'Actual out', 'Worked minutes', 'Status', 'Flags', 'Corrections'
];

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="Noto Sans Thai"/></font><font><b/><sz val="14"/><name val="Noto Sans Thai"/></font><font><b/><sz val="10"/><name val="Noto Sans Thai"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F1FF"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>`;

function buildAttendanceWorkbook(report) {
  const rows = reportRows(report.snapshot);
  const lastColumn = columnName(headers.length);
  const xmlRows = [
    rowXml(1, [`Security Management System - Official Attendance ${report.month} Rev.${report.revision}`], 1),
    rowXml(2, [`Certification ID: ${report.certificationId} | Digest: ${report.summaryDigest}`]),
    rowXml(3, [`Certified at: ${iso(report.certifiedAt)} | Status: ${report.status}`]),
    rowXml(5, headers, 2)
  ];
  rows.forEach((row, index) => xmlRows.push(rowXml(6 + index, Object.values(row), 3)));
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="${headers.length}" width="18" customWidth="1"/></cols><sheetData>${xmlRows.join('')}</sheetData><mergeCells count="3"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/><mergeCell ref="A3:${lastColumn}3"/></mergeCells><pageMargins left="0.25" right="0.25" top="0.25" bottom="0.25" header="0.1" footer="0.1"/><pageSetup orientation="landscape" fitToWidth="1" paperSize="9"/></worksheet>`;
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Attendance" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'xl/styles.xml': strToU8(stylesXml),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml)
  };
  return Buffer.from(zipSync(files, { level: 6 }));
}

function createAttendanceReportService({ prisma = prismaDefault } = {}) {
  async function official(month, client = prisma) {
    const report = await loadCertifiedSnapshot(client, month);
    return { ...report, rows: reportRows(report.snapshot), summary: report.snapshot?.summary || {} };
  }
  async function xlsx(month, client = prisma) {
    const report = await loadCertifiedSnapshot(client, month);
    return { report, buffer: buildAttendanceWorkbook(report), filename: `attendance-${report.month}-rev-${report.revision}.xlsx` };
  }
  return { official, xlsx };
}

module.exports = { parseMonth, reportRows, loadCertifiedSnapshot, buildAttendanceWorkbook, createAttendanceReportService };
