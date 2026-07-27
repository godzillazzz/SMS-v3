require('dotenv').config();
const jwt = require('jsonwebtoken');
const prisma = require('../src/config/prisma');
const env = require('../src/config/env');

async function testHttpBatchSave() {
  try {
    const employee = await prisma.employee.findFirst();
    const shiftType = await prisma.shiftType.findFirst();
    const user = await prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true, accountStatus: 'ACTIVE' } });

    if (!employee || !shiftType || !user) {
      console.log('Missing data seeds');
      return;
    }

    const token = jwt.sign(
      { sub: user.id, role: user.role, displayName: user.displayName, email: user.email, tokenVersion: user.tokenVersion },
      env.jwtSecret,
      { algorithm: env.jwtAlgorithm, issuer: env.jwtIssuer, audience: env.jwtAudience, expiresIn: '1h' }
    );

    const payload = {
      assignments: [
        {
          employeeId: employee.id,
          shiftTypeId: shiftType.id,
          workDate: '2026-08-01',
          remark: 'HTTP test batch save'
        }
      ]
    };

    const url = 'http://localhost:3000/api/v1/schedules/batch';
    console.log('Posting to:', url);
    console.log('Payload:', JSON.stringify(payload, null, 2));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    console.log('HTTP Status:', response.status);
    const bodyText = await response.text();
    console.log('HTTP Body:', bodyText);
  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await prisma.$disconnect();
  }
}

testHttpBatchSave();
