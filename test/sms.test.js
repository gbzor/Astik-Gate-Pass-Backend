// Run with: npm test
// Tests for the SMS service in development (console) mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Set test environment configuration
process.env.NODE_ENV = 'test';
process.env.SMS_PROVIDER = 'console';

const { maskPhone, sendSms } = await import('../src/services/sms.service.js');

test('maskPhone protects recipient phone privacy in logs', () => {
  assert.equal(maskPhone('+639171234567'), '+63917****567');
  assert.equal(maskPhone('+639987654321'), '+63998****321');
  assert.equal(maskPhone('12345'), '***');
  assert.equal(maskPhone(null), '***');
});

test('sendSms in console mode validates +639XXXXXXXXX format', async () => {
  // Valid PH format: +639 followed by 9 digits
  const valid = await sendSms({
    to: '+639171234567',
    message: 'Astik Pass: Test message under 160 chars',
  });
  assert.equal(valid.success, true);
  assert.equal(valid.mode, 'console');

  // Invalid format (missing +63, or 09... format)
  const invalid = await sendSms({
    to: '09171234567',
    message: 'Test',
  });
  assert.equal(invalid.success, false);
  assert.equal(invalid.error, 'Invalid phone format');
});

test('sendSms skips gracefully when recipient phone is missing', async () => {
  const result = await sendSms({
    to: '',
    message: 'Hello',
  });
  assert.equal(result.success, false);
  assert.equal(result.error, 'Recipient phone missing');
});
