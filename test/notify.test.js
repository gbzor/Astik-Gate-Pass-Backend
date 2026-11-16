// Run with: npm test
// Tests for campus sticker application notifications and helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SMS_MAX_LENGTH } from '../src/config/constants.js';

process.env.NODE_ENV = 'test';
process.env.SMTP_HOST = '';
process.env.SMS_PROVIDER = 'console';

const {
  escapeHtml,
  formatManilaDate,
  notifyStickerSubmitted,
  notifyStickerApproved,
  notifyStickerRejected,
} = await import('../src/services/notify.service.js');

test('escapeHtml prevents XSS injections in email templates', () => {
  const unsafe = '<script>alert("xss")</script> & "quotes" \'single\'';
  const safe = escapeHtml(unsafe);
  assert.ok(!safe.includes('<script>'));
  assert.ok(safe.includes('&lt;script&gt;'));
  assert.ok(safe.includes('&amp;'));
  assert.ok(safe.includes('&quot;'));
  assert.ok(safe.includes('&#39;'));
});

test('formatManilaDate correctly formats UTC ISO string to Asia/Manila date', () => {
  // 2027-05-31T15:59:59.999Z + 8h = 2027-05-31 23:59:59 Manila time
  const formatted = formatManilaDate('2027-05-31T15:59:59.999Z');
  assert.ok(formatted.includes('2027'));
  assert.ok(formatted.includes('May') || formatted.includes('31'));
  assert.equal(formatManilaDate(''), 'N/A');
  assert.equal(formatManilaDate(null), 'N/A');
});

test('notify functions gracefully handle missing applications without throwing', async () => {
  await assert.doesNotReject(async () => {
    await notifyStickerSubmitted(null);
    await notifyStickerApproved(null);
    await notifyStickerRejected(null);
  });
});
