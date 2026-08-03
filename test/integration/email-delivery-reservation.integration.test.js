process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('email delivery reservation integration requires RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  const target = new URL(process.env.DATABASE_URL || '');
  const isConfiguredTestTarget = target.pathname.replace(/^\//, '') === 'sms_v3_test' && ((target.hostname === 'host.docker.internal' && target.port === '5433') || (target.hostname === '127.0.0.1' && target.port === '5433') || (target.hostname === '127.0.0.1' && target.port === '5432' && process.env.TEST_DATABASE_RUNNER === 'docker-container-network'));
  if (!isConfiguredTestTarget) throw new Error('Email delivery integration requires the isolated sms_v3_test target.');
  const prisma = require('../../src/config/prisma');
  const { PostgresEmailDeliveryStore } = require('../../src/services/email-delivery-store');
  const eventKey = `integration:email-reservation:${Date.now()}`;
  const store = new PostgresEmailDeliveryStore(prisma);

  test('unique reservation allows one concurrent sender and SENT suppresses retries', async () => {
    try {
      const reservations = await Promise.all(Array.from({ length: 20 }, () => store.reserve(eventKey)));
      assert.equal(reservations.filter((item) => item.status === 'RESERVED').length, 1);
      assert.equal(reservations.filter((item) => item.status === 'ALREADY_RESERVED').length, 19);
      assert.equal(await store.markSent(eventKey), true);
      assert.equal((await store.reserve(eventKey)).status, 'ALREADY_SENT');
    } finally {
      await prisma.emailDeliveryReservation.deleteMany({ where: { eventKey } });
    }
  });
}
