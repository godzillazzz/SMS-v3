const { zipSync, strToU8 } = require('fflate');

const xmlEscape = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const columnName = (number) => { let result = ''; for (let value = number; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result; return result; };
const safeSheetName = (value, used) => {
  const base = String(value || 'Schedule').replace(/[\\/?*\[\]:]/g, '-').slice(0, 31) || 'Schedule';
  let name = base; let counter = 2;
  while (used.has(name)) { const suffix = `-${counter++}`; name = `${base.slice(0, 31 - suffix.length)}${suffix}`; }
  used.add(name); return name;
};
const thaiMonth = (month) => {
  const [year, number] = month.split('-').map(Number);
  return `${['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'][number - 1]} ${year + 543}`;
};
const styleForShift = (code) => ({ D: 9, N: 10, OFF: 11, AL: 12 })[String(code).toUpperCase()] || 8;
const inlineCell = (reference, value, style = 0) => `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
const numberCell = (reference, value, style = 0) => `<c r="${reference}" s="${style}"><v>${Number(value) || 0}</v></c>`;
const rowXml = (number, cells, height) => `<row r="${number}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells.join('')}</row>`;

function sheetXml({ department, month, dates, people, shiftTypes, approval, exportedBy, exportedAt }) {
  const totalColumns = dates.length + 4;
  const lastColumn = columnName(totalColumns);
  const rows = [];
  rows.push(rowXml(1, [inlineCell('A1', `Security Management System - ตารางกะที่อนุมัติแล้ว · ${thaiMonth(month)}`, 1)], 34));
  rows.push(rowXml(2, [inlineCell('A2', `แผนก: ${department}  |  Revision: ${approval.revision}  |  วันที่อนุมัติ: ${approval.approvedAt ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(approval.approvedAt)) : '-'}`, 2)], 25));
  rows.push(rowXml(3, [inlineCell('A3', `Export โดย: ${exportedBy}  |  วันที่ Export: ${new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(exportedAt)}`, 3)], 22));
  const headerValues = ['ลำดับ', 'ชื่อ-นามสกุล', 'ตำแหน่ง', ...dates.map((date) => { const value = new Date(`${date}T00:00:00Z`); return `${value.getUTCDate()}\n${['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'][value.getUTCDay()]}`; }), 'ชม.รวม'];
  rows.push(rowXml(4, headerValues.map((value, index) => { const day = index >= 3 && index < dates.length + 3 ? new Date(`${dates[index - 3]}T00:00:00Z`).getUTCDay() : undefined; return inlineCell(`${columnName(index + 1)}4`, value, day === 0 ? 5 : day === 6 ? 6 : 4); }), 32));
  people.forEach((person, index) => {
    const rowNumber = 5 + index;
    const values = [numberCell(`A${rowNumber}`, index + 1, 8), inlineCell(`B${rowNumber}`, person.name, 7), inlineCell(`C${rowNumber}`, person.position || '-', 7)];
    dates.forEach((date, dateIndex) => { const code = person.shifts.get(date)?.code || ''; values.push(inlineCell(`${columnName(dateIndex + 4)}${rowNumber}`, code, styleForShift(code))); });
    values.push(numberCell(`${lastColumn}${rowNumber}`, person.totalHours, 13));
    rows.push(rowXml(rowNumber, values, 24));
  });
  let nextRow = 6 + people.length;
  rows.push(rowXml(nextRow, [inlineCell(`A${nextRow}`, 'คำอธิบายรหัสกะ', 2)], 23));
  const legendStart = nextRow;
  shiftTypes.forEach((shift) => {
    nextRow += 1;
    rows.push(rowXml(nextRow, [inlineCell(`A${nextRow}`, shift.code, styleForShift(shift.code)), inlineCell(`B${nextRow}`, `${shift.name}  ${shift.startTime || ''}-${shift.endTime || ''}  (${Number(shift.hours || 0)} ชม.)`, 7)], 21));
  });
  nextRow += 2;
  rows.push(rowXml(nextRow, [inlineCell(`A${nextRow}`, 'ลงชื่อ........................................................................................................', 14)], 34));
  rows.push(rowXml(nextRow + 1, [inlineCell(`A${nextRow + 1}`, '(........................................................................................................)', 14)], 28));
  rows.push(rowXml(nextRow + 2, [inlineCell(`A${nextRow + 2}`, 'พนักงานผู้จัดพิมพ์รายงาน / หัวหน้าพนักงานรักษาความปลอดภัย', 14)], 32));
  rows.push(rowXml(nextRow + 4, [inlineCell(`A${nextRow + 4}`, 'ทราบ / ลงชื่อ........................................................................................................', 14)], 34));
  rows.push(rowXml(nextRow + 5, [inlineCell(`A${nextRow + 5}`, '(........................................................................................................)', 14)], 28));
  rows.push(rowXml(nextRow + 6, [inlineCell(`A${nextRow + 6}`, 'ผู้จัดการเขต (ผู้อนุมัติ)', 14)], 32));
  const merges = [`A1:${lastColumn}1`, `A2:${lastColumn}2`, `A3:${lastColumn}3`, `A${legendStart}:${lastColumn}${legendStart}`, `A${nextRow}:H${nextRow}`, `A${nextRow + 1}:H${nextRow + 1}`, `A${nextRow + 2}:H${nextRow + 2}`, `A${nextRow + 4}:H${nextRow + 4}`, `A${nextRow + 5}:H${nextRow + 5}`, `A${nextRow + 6}:H${nextRow + 6}`];
  const columns = [`<col min="1" max="1" width="7" customWidth="1"/>`, `<col min="2" max="2" width="28" customWidth="1"/>`, `<col min="3" max="3" width="20" customWidth="1"/>`, `<col min="4" max="${dates.length + 3}" width="5.5" customWidth="1"/>`, `<col min="${totalColumns}" max="${totalColumns}" width="11" customWidth="1"/>`].join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns}</cols><sheetData>${rows.join('')}</sheetData><mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells><pageMargins left="0.3" right="0.3" top="0.25" bottom="0.25" header="0.1" footer="0.1"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/></worksheet>`;
}

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="5"><font><sz val="10"/><name val="Sarabun"/></font><font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Sarabun"/></font><font><b/><sz val="9"/><color rgb="FFFFFFFF"/><name val="Sarabun"/></font><font><b/><sz val="9"/><color rgb="FF173566"/><name val="Sarabun"/></font><font><sz val="8"/><color rgb="FF475569"/><name val="Sarabun"/></font></fonts><fills count="9"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173566"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F1FF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFB91C1C"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1D4ED8"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFCFFCED"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFE6FF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE0E5"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD7E7FA"/></left><right style="thin"><color rgb="FFD7E7FA"/></right><top style="thin"><color rgb="FFD7E7FA"/></top><bottom style="thin"><color rgb="FFD7E7FA"/></bottom></border></borders><cellXfs count="15"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0"/><xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs></styleSheet>`;

function buildApprovedScheduleWorkbook({ month, approval, departments, shifts, employees, shiftTypes, exportedBy }) {
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const [year, monthNumber] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const dates = Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
  const usedNames = new Set();
  const exportedAt = new Date();
  const sheets = departments.map((department) => {
    const rows = shifts.filter((shift) => String(shift.departmentSnapshot || '') === department);
    const peopleMap = new Map();
    rows.forEach((shift) => {
      const employee = employeeById.get(shift.employeeId) || {};
      const person = peopleMap.get(shift.employeeId) || { name: shift.employeeNameSnapshot, position: employee.jobTitle || '', shifts: new Map(), totalHours: 0 };
      person.shifts.set(new Date(shift.workDate).toISOString().slice(0, 10), { code: shift.shiftType.code, hours: Number(shift.hours || 0) });
      person.totalHours += Number(shift.hours || 0);
      peopleMap.set(shift.employeeId, person);
    });
    const people = [...peopleMap.values()].sort((first, second) => first.name.localeCompare(second.name, 'th'));
    return { name: safeSheetName(department, usedNames), xml: sheetXml({ department, month, dates, people, shiftTypes, approval, exportedBy, exportedAt }) };
  });
  const sheetEntries = sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('');
  const relationships = sheets.map((_sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
  const contentSheets = sheets.map((_sheet, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const files = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${contentSheets}</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries}</sheets><calcPr calcId="191029"/></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(stylesXml)
  };
  sheets.forEach((sheet, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheet.xml); });
  return Buffer.from(zipSync(files, { level: 6 }));
}

module.exports = { buildApprovedScheduleWorkbook, thaiMonth };
