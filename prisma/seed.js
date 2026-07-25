require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient, UserRole } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const displayName = process.env.SEED_ADMIN_NAME || 'System Administrator';

  if (!email || !password) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: { passwordHash, displayName, role: UserRole.ADMIN, isActive: true },
    create: { email: email.toLowerCase(), passwordHash, displayName, role: UserRole.ADMIN }
  });
  await prisma.employee.upsert({
    where: { employeeCode: 'SAMPLE-001' },
    update: { firstName: 'Sample', lastName: 'Employee', department: 'Development', jobTitle: 'Sample Record', isActive: true, deletedAt: null, deletedByUserId: null },
    create: { employeeCode: 'SAMPLE-001', firstName: 'Sample', lastName: 'Employee', department: 'Development', jobTitle: 'Sample Record' }
  });

  const defaultShifts = [
    { code: 'M', name: 'Morning Shift', startTime: '07:00', endTime: '15:00', hours: 8.0, color: '#3b82f6' },
    { code: 'A', name: 'Afternoon Shift', startTime: '15:00', endTime: '23:00', hours: 8.0, color: '#f59e0b' },
    { code: 'N', name: 'Night Shift', startTime: '23:00', endTime: '07:00', hours: 8.0, color: '#8b5cf6' },
    { code: 'OFF', name: 'Off Day', startTime: '', endTime: '', hours: 0.0, color: '#64748b' },
    { code: 'LEAVE', name: 'Leave', startTime: '', endTime: '', hours: 0.0, color: '#ef4444' }
  ];

  for (const shift of defaultShifts) {
    await prisma.shiftType.upsert({
      where: { code: shift.code },
      update: { name: shift.name, startTime: shift.startTime, endTime: shift.endTime, hours: shift.hours, color: shift.color },
      create: { code: shift.code, name: shift.name, startTime: shift.startTime, endTime: shift.endTime, hours: shift.hours, color: shift.color }
    });
  }
}

main().then(() => prisma.$disconnect()).catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
