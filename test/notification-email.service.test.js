const test = require('node:test');
const assert = require('node:assert/strict');
const { sendNotification } = require('../src/services/notification-email.service');

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
    logger: { info() {}, error(_event, fields) { errors.push(fields); } }
  }));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].recipientCount, 1);
  assert.equal(errors[0].errorCategory, 'internal_error');
});
