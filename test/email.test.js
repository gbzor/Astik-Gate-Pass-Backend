// Run with: npm test
// Tests for the email service in development (console) mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Ensure test environment uses console mode (empty SMTP_HOST)
process.env.NODE_ENV = 'test';
process.env.SMTP_HOST = '';

const { maskEmail, sendEmail } = await import('../src/services/email.service.js');

test('maskEmail protects recipient privacy in logs', () => {
  assert.equal(maskEmail('juan@adnu.edu.ph'), 'j***@adnu.edu.ph');
  assert.equal(maskEmail('maria.santos@gbox.adnu.edu.ph'), 'm***@gbox.adnu.edu.ph');
  assert.equal(maskEmail(''), '***');
  assert.equal(maskEmail(null), '***');
});

test('sendEmail prints to console when SMTP_HOST is empty', async () => {
  const result = await sendEmail({
    to: 'student@gbox.adnu.edu.ph',
    subject: 'Welcome to Astik Gate Pass',
    text: 'Your account has been registered.',
  });
  assert.equal(result.success, true);
  assert.equal(result.mode, 'console');
});

test('sendEmail skips gracefully when recipient is missing', async () => {
  const result = await sendEmail({
    to: '',
    subject: 'No recipient',
    text: 'Hello',
  });
  assert.equal(result.success, false);
  assert.equal(result.error, 'Recipient email missing');
});
