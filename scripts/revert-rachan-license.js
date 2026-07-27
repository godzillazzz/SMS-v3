require('dotenv').config();
const prisma = require('../src/config/prisma');

async function revertRachanLicense() {
  try {
    const employee = await prisma.employee.findFirst({
      where: {
        OR: [
          { firstName: { contains: 'ราชันต์' } },
          { lastName: { contains: 'มณีโสตร์' } }
        ]
      }
    });

    if (!employee) {
      console.log('Employee ราชันต์ มณีโสตร์ not found');
      return;
    }

    const newIssueDate = new Date('2026-07-17T00:00:00.000Z');
    const newExpiryDate = new Date('2029-07-16T23:59:59.999Z');

    await prisma.employeeLicense.updateMany({
      where: { employeeId: employee.id },
      data: {
        status: 'Active',
        issueDate: newIssueDate,
        expiryDate: newExpiryDate
      }
    });

    console.log('Reverted license for ราชันต์ มณีโสตร์ to issueDate: 2026-07-17 (July 17, 2026)');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

revertRachanLicense();
