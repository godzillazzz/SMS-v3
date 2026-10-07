import '../../src/styles.css';
import '../../src/styles/executive-report.css';
import '../../src/styles/attendance-report.css';
import { printDocument, printScheduleDocument, printTableReport } from '../../src/schedule-print';

const rosterTable = document.querySelector<HTMLTableElement>('#roster-table')!;
const header = rosterTable.tHead!.rows[0];
const employeeRow = rosterTable.tBodies[0].rows[1];
for (let day = 1; day <= 31; day += 1) {
  const heading = document.createElement('th');
  heading.innerHTML = `<b>${day}</b><small>พ.</small>`;
  header.append(heading);
  const cell = document.createElement('td');
  cell.textContent = day % 3 === 0 ? 'OFF' : day % 2 === 0 ? 'N' : 'D';
  employeeRow.append(cell);
}
const totalHeader = document.createElement('th');
totalHeader.textContent = 'ชม.รวมเดือน';
header.append(totalHeader);
const totalCell = document.createElement('td');
totalCell.textContent = '240';
employeeRow.append(totalCell);

const attendanceBody = document.querySelector<HTMLTableElement>('.attendance-report-table')!.tBodies[0];
for (let rowIndex = 1; rowIndex <= 60; rowIndex += 1) {
  const row = attendanceBody.insertRow();
  for (let column = 0; column < 10; column += 1) {
    row.insertCell().textContent = column === 0 ? String(rowIndex) : `แถวทดสอบ ${rowIndex}`;
  }
}

const genericBody = document.querySelector<HTMLTableElement>('#generic-table')!.tBodies[0];
for (let rowIndex = 1; rowIndex <= 72; rowIndex += 1) {
  const row = genericBody.insertRow();
  for (let column = 0; column < 8; column += 1) {
    row.insertCell().textContent = column === 0 ? String(rowIndex) : `ข้อมูลทดสอบ ${rowIndex}`;
  }
  const action = row.insertCell();
  action.className = 'data-action-column data-action-column--cell';
  action.innerHTML = '<button type="button">จัดการ</button>';
}

async function beginPrint(run: () => Promise<void>) {
  await run();
  window.dispatchEvent(new Event('t29-print-ready'));
}

document.querySelector('#trigger-leave')!.addEventListener('click', () => {
  void beginPrint(() => printDocument('#leave-document', 'ใบขออนุมัติลางาน.pdf', { orientation: 'portrait', margin: '12mm' }, () => undefined));
});
document.querySelector('#trigger-roster')!.addEventListener('click', () => {
  void beginPrint(() => printScheduleDocument(() => undefined));
});
document.querySelector('#trigger-table')!.addEventListener('click', () => {
  void beginPrint(() => printTableReport('#generic-table', {
    title: 'รายงานรายการทดสอบ',
    printedBy: 'ผู้ทดสอบ · ผู้ดูแลระบบ',
    filters: [{ label: 'สถานะ', value: 'อนุมัติแล้ว' }, { label: 'เดือน', value: 'ตุลาคม 2569' }]
  }, () => undefined));
});
document.querySelector('#trigger-reports')!.addEventListener('click', () => {
  void beginPrint(() => printDocument('#reports-document', 'รายงานประกอบ.pdf', { orientation: 'landscape', margin: '0' }, () => undefined));
});
