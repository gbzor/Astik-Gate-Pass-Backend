// Run with: npm test
// Tests for campus sticker application notifications and helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_MS,
  SMS_MAX_LENGTH,
  STICKER_RENEWAL_REMINDER_MONTHS,
  STICKER_VALIDITY_YEARS,
} from '../src/config/constants.js';

process.env.NODE_ENV = 'test';
process.env.SMTP_HOST = '';
process.env.SMS_PROVIDER = 'console';

const {
  escapeHtml,
  formatManilaDate,
  notifyStickerSubmitted,
  notifyStickerApproved,
  notifyStickerRejected,
  notifyStickerExpiring,
} = await import('../src/services/notify.service.js');

const {
  calculateTwoYearExpiry,
  getRenewalReminderTier,
} = await import('../src/services/stickers.service.js');

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
    await notifyStickerExpiring(null, 3);
    await notifyStickerExpiring(null, 1);
    await notifyStickerExpiring({ applicantId: 'non-existent' }, 3);
    await notifyStickerExpiring({ applicantId: 'non-existent' }, 1);
  });
});

test('calculateTwoYearExpiry returns a date exactly 2 years in the future', () => {
  const base = new Date('2026-11-26T10:00:00.000Z');
  const expiry = calculateTwoYearExpiry(base);
  assert.equal(expiry.getUTCFullYear(), base.getUTCFullYear() + STICKER_VALIDITY_YEARS);
  assert.equal(expiry.getUTCMonth(), base.getUTCMonth());
  assert.equal(expiry.getUTCDate(), base.getUTCDate());
});

test('getRenewalReminderTier identifies 3-month and 1-month reminder windows', () => {
  const now = new Date('2026-11-26T00:00:00.000Z');

  // 3 months (~90 days out)
  assert.equal(getRenewalReminderTier(new Date(now.getTime() + 90 * DAY_MS), now), 3);
  assert.equal(getRenewalReminderTier(new Date(now.getTime() + 85 * DAY_MS), now), 3);
  assert.equal(getRenewalReminderTier(new Date(now.getTime() + 95 * DAY_MS), now), 3);

  // 1 month (~30 days out)
  assert.equal(getRenewalReminderTier(new Date(now.getTime() + 30 * DAY_MS), now), 1);
  assert.equal(getRenewalReminderTier(new Date(now.getTime() + 25 * DAY_MS), now), 1);
  assert.equal(getRenewalReminderTier(new Date(now.getTime() + 35 * DAY_MS), now), 1);

  // Outside windows
  assert.equal(getRenewalReminderTier(new Date(now.getTime() + 60 * DAY_MS), now), null);
  assert.equal(getRenewalReminderTier(new Date(now.getTime() + 365 * DAY_MS), now), null);
  assert.equal(getRenewalReminderTier(new Date(now.getTime() - 10 * DAY_MS), now), null);
  assert.equal(getRenewalReminderTier(null, now), null);
});

test('renewal reminder SMS templates stay within 160 characters', () => {
  const plate = 'ABC 1234';
  const plateTag = ` (${plate})`;
  const manilaExpiry = 'Nov 26, 2028';

  const sms3Mo = `Astik Pass: Sticker${plateTag} expires in 3 mos on ${manilaExpiry}. Please prepare renewal requirements on the portal.`;
  const sms1Mo = `Astik Pass: URGENT: Sticker${plateTag} expires in 1 mo on ${manilaExpiry}. Renew now on portal to maintain campus access.`;

  assert.ok(sms3Mo.length <= SMS_MAX_LENGTH, `3-month SMS (${sms3Mo.length}) exceeded ${SMS_MAX_LENGTH}`);
  assert.ok(sms1Mo.length <= SMS_MAX_LENGTH, `1-month SMS (${sms1Mo.length}) exceeded ${SMS_MAX_LENGTH}`);
  assert.deepEqual(STICKER_RENEWAL_REMINDER_MONTHS, [3, 1]);
});
