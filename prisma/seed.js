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
}

main().then(() => prisma.$disconnect()).catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
