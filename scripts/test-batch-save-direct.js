require('dotenv').config();
const prisma = require('../src/config/prisma');
const scheduleService = require('../src/services/schedule.service');

async function testDirectBatchSave() {
  try {
    const employees = await prisma.employee.findMany({ take: 5 });
    const shiftTypes = await prisma.shiftType.findMany();
    const user = await prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true, accountStatus: 'ACTIVE' } });

    if (!employees.length || !shiftTypes.length || !user) {
      console.log('Missing seeds');
      return;
    }

    const typeD = shiftTypes.find((t) => t.code.toUpperCase() === 'D') || shiftTypes[0];
    const typeN = shiftTypes.find((t) => t.code.toUpperCase() === 'N') || shiftTypes[0];
    const typeOff = shiftTypes.find((t) => t.code.toUpperCase() === 'OFF') || shiftTypes[0];

    const assignments = [];
    employees.forEach((emp) => {
      assignments.push({
        employeeId: emp.id,
        shiftTypeId: typeD.id,
        workDate: '2026-08-01',
        remark: 'Test D'
      });
      assignments.push({
        employeeId: emp.id,
        shiftTypeId: typeN.id,
        workDate: '2026-08-02',
        remark: 'Test N'
      });
      assignments.push({
        employeeId: emp.id,
        shiftTypeId: typeOff.id,
        workDate: '2026-08-03',
        remark: 'Test OFF'
      });
    });

    console.log('Testing saveBatchAssignments with', assignments.length, 'items...');
    const result = await scheduleService.saveBatchAssignments(assignments, user.id);
    console.log('SUCCESS! Result count:', result.count);
  } catch (err) {
    console.error('ERROR IN saveBatchAssignments:', err);
  } finally {
    await prisma.$disconnect();
  }
}

testDirectBatchSave();
