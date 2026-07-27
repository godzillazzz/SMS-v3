require('dotenv').config();
const prisma = require('../src/config/prisma');

async function checkAndUpdateRachan() {
  try {
    const employee = await prisma.employee.findFirst({
      where: {
        OR: [
          { firstName: { contains: 'ราชันต์' } },
          { lastName: { contains: 'มณีโสตร์' } },
          { displayName: { contains: 'ราชันต์' } }
        ]
      }
    });

    if (!employee) {
      console.log('Employee ราชันต์ มณีโสตร์ not found');
      return;
    }

    console.log('Found employee:', employee.id, employee.employeeCode, employee.firstName, employee.lastName);

    const licenses = await prisma.employeeLicense.findMany({
      where: { employeeId: employee.id }
    });

    console.log('Current licenses:', licenses);

    // Thai Year 2572 -> Gregorian Year 2029 (2572 - 543 = 2029)
    const newIssueDate = new Date('2024-01-01T00:00:00.000Z');
    const newExpiryDate = new Date('2029-07-31T23:59:59.999Z');

    if (licenses.length > 0) {
      for (const lic of licenses) {
        await prisma.employeeLicense.update({
          where: { id: lic.id },
          data: {
            status: 'ACTIVE',
            issueDate: newIssueDate,
            expiryDate: newExpiryDate
          }
        });
      }
      console.log('Updated existing license(s) to expire on July 2572 (2029-07-31)!');
    } else {
      await prisma.employeeLicense.create({
        data: {
          employeeId: employee.id,
          licenseNo: `LIC-${employee.employeeCode}`,
          licenseType: 'SECURITY_GUARD',
          status: 'ACTIVE',
          issueDate: newIssueDate,
          expiryDate: newExpiryDate
        }
      });
      console.log('Created new license expiring on July 2572 (2029-07-31)!');
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

checkAndUpdateRachan();
