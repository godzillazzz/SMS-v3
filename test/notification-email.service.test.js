process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/smsv3_test';
process.env.JWT_SECRET = 'local-notification-test-secret-at-least-thirty-two-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTransporter, sendNotification } = require('../src/services/notification-email.service');
const { createLogger } = require('../src/utils/logger');

const configuration = {
  otpDeliveryProvider: 'gmail_smtp',
  smtpHost: 'smtp.example.test',
  smtpPort: 465,
  smtpSecure: true,
  smtpUsername: 'smtp-user-test',
  smtpPassword: 'smtp-password-test',
  otpFromEmail: 'no-reply@example.test'
};

function enableNotificationDelivery(t) {
  const previous = process.env.DISABLE_EMAIL_NOTIFICATIONS;
  process.env.DISABLE_EMAIL_NOTIFICATIONS = 'false';
  t.after(() => {
    if (previous === undefined) delete process.env.DISABLE_EMAIL_NOTIFICATIONS;
    else process.env.DISABLE_EMAIL_NOTIFICATIONS = previous;
  });
}

test('notification transporter preserves SMTP host, TLS and authentication configuration', () => {
  let transportOptions;
  const transporter = createTransporter(configuration, (options) => {
    transportOptions = options;
    return { sendMail: async () => undefined };
  });

  assert.equal(typeof transporter.sendMail, 'function');
  assert.deepEqual(transportOptions, {
    host: 'smtp.example.test',
    port: 465,
    secure: true,
    auth: { user: 'smtp-user-test', pass: 'smtp-password-test' }
  });
});

test('notification send uses the injected transport and preserves HTML/text without external email', async (t) => {
  enableNotificationDelivery(t);
  const transportOptions = [];
  const messages = [];
  const events = [];
  const loggerInstance = {
    info: (event, fields) => events.push({ level: 'info', event, fields }),
    error: (event, fields) => events.push({ level: 'error', event, fields })
  };

  await sendNotification({
    to: ['Admin@Example.test', 'admin@example.test', 'manager@example.test'],
    subject: 'Schedule update test',
    html: '<p>Schedule <strong>approved</strong></p>'
  }, {
    configuration,
    transportFactory: (options) => {
      transportOptions.push(options);
      return { sendMail: async (message) => { messages.push(message); } };
    },
    loggerInstance
  });

  assert.equal(transportOptions.length, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].from, 'no-reply@example.test');
  assert.equal(messages[0].to, 'admin@example.test, manager@example.test');
  assert.equal(messages[0].subject, 'Schedule update test');
  assert.equal(messages[0].html, '<p>Schedule <strong>approved</strong></p>');
  assert.equal(messages[0].text, 'Schedule approved');
  assert.deepEqual(events.map(({ event }) => event), ['Notification email sent successfully']);
});

test('notification delivery errors do not write SMTP credentials to logs', async (t) => {
  enableNotificationDelivery(t);
  const logLines = [];
  const loggerInstance = createLogger({ writer: (_level, line) => logLines.push(line), environment: 'test' });

  await sendNotification({ to: 'admin@example.test', subject: 'Failure test', html: '<p>Message</p>' }, {
    configuration,
    transportFactory: () => ({ sendMail: async () => { throw new Error(configuration.smtpPassword); } }),
    loggerInstance
  });

  assert.equal(logLines.length, 1);
  assert.doesNotMatch(logLines[0], /smtp-password-test/);
  assert.match(logLines[0], /Failed to send notification email/);
});
