const test = require('node:test');
const assert = require('node:assert/strict');
const { sendNotification } = require('../src/services/notification-email.service');
const { MemoryEmailDeliveryStore } = require('../src/services/email-delivery-store');

function logger() {
  return { info() {}, error() {} };
}

test('system email gate prevents delivery when disabled', async () => {
  let transporterCreated = false;
  await sendNotification({ to: 'fixture@example.invalid', subject: 'fixture', html: '<p>fixture</p>' }, {
    configuration: { emailNotificationsEnabled: false },
    createTransporter: () => { transporterCreated = true; return { sendMail: async () => {} }; },
    logger: logger()
  });
  assert.equal(transporterCreated, false);
});

test('enabled email notifications invoke the configured provider once with deduplicated recipients', async () => {
  const messages = [];
  await sendNotification({
    to: ['fixture@example.invalid', 'FIXTURE@example.invalid'],
    subject: 'fixture subject',
    html: '<p>fixture body</p>'
  }, {
    configuration: { emailNotificationsEnabled: true, otpFromEmail: 'sender@example.invalid', smtpUsername: 'sender@example.invalid' },
    createTransporter: () => ({ sendMail: async (message) => { messages.push(message); } }),
    logger: logger()
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, 'fixture@example.invalid');
  assert.equal(messages[0].from, 'sender@example.invalid');
});

test('provider errors are logged without being thrown to the caller', async () => {
  const errors = [];
  await assert.doesNotReject(() => sendNotification({ to: 'fixture@example.invalid', subject: 'fixture', html: '<p>fixture</p>' }, {
    configuration: { emailNotificationsEnabled: true },
    createTransporter: () => ({ sendMail: async () => { throw new Error('synthetic provider failure'); } }),
    logger: { info() {}, error(_event, fields) { errors.push(fields); } }, isAnomaly: true
  }));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].recipientCount, 1);
  assert.equal(errors[0].errorCategory, 'internal_error');
});

test('staging subjects are prefixed and event keys suppress duplicate delivery', async () => {
  const messages = [];
  const deliveryStore = new MemoryEmailDeliveryStore();
  const options = {
    configuration: { emailNotificationsEnabled: true, otpFromEmail: 'sender@example.invalid', smtpUsername: 'sender@example.invalid' },
    createTransporter: () => ({ sendMail: async (message) => { messages.push(message); } }),
    logger: logger(), deliveryStore, eventKey: 'fixture:event:1'
  };
  const { sendNotification } = require('../src/services/notification-email.service');
  await sendNotification({ to: 'fixture@example.invalid', subject: 'Fixture', html: '<p>Fixture</p>' }, options);
  await sendNotification({ to: 'fixture@example.invalid', subject: 'Fixture', html: '<p>Fixture</p>' }, options);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].subject, '[STAGING] Fixture');
});

test('concurrent event reservation permits one provider send and retry after failure', async () => {
  const deliveryStore = new MemoryEmailDeliveryStore();
  let sends = 0;
  const options = {
    configuration: { emailNotificationsEnabled: true, otpFromEmail: 'sender@example.invalid', smtpUsername: 'sender@example.invalid' },
    createTransporter: () => ({ sendMail: async () => { sends += 1; } }),
    logger: logger(), deliveryStore, eventKey: 'fixture:concurrent:1'
  };
  await Promise.all(Array.from({ length: 20 }, () => sendNotification({ to: 'fixture@example.invalid', subject: 'Fixture', html: '<p>Fixture</p>' }, options)));
  assert.equal(sends, 1);
  assert.equal(deliveryStore.entries()[0].status, 'SENT');
});

test('failed delivery is marked failed and becomes retryable after policy delay', async () => {
  let now = new Date('2026-08-03T00:00:00Z');
  const deliveryStore = new MemoryEmailDeliveryStore({ now: () => now });
  const options = {
    configuration: { emailNotificationsEnabled: true },
    createTransporter: () => ({ sendMail: async () => { throw new Error('synthetic provider failure'); } }),
    logger: logger(), deliveryStore, eventKey: 'fixture:retry:1', isAnomaly: true
  };
  assert.equal((await sendNotification({ to: 'fixture@example.invalid', subject: 'Fixture', html: '<p>Fixture</p>' }, options)).status, 'failed');
  assert.equal((await sendNotification({ to: 'fixture@example.invalid', subject: 'Fixture', html: '<p>Fixture</p>' }, options)).status, 'RETRY_LATER');
  now = new Date('2026-08-03T00:01:01Z');
  assert.equal((await sendNotification({ to: 'fixture@example.invalid', subject: 'Fixture', html: '<p>Fixture</p>' }, { ...options, createTransporter: () => ({ sendMail: async () => {} }) })).status, 'sent');
});
