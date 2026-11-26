// Run with: npm test
// Tests for centralized notification management service:
// delivery, history tracking, status transitions, retries, and deduplication.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DEDUP_WINDOW_MS,
  NOTIFICATION_MAX_RETRIES,
  NOTIFICATION_STATUS,
  NOTIFICATION_STATUSES,
} from '../src/config/constants.js';

process.env.NODE_ENV = 'test';
process.env.SMTP_HOST = '';
process.env.SMS_PROVIDER = 'console';

const {
  dispatchEmail,
  dispatchSms,
  listNotifications,
  getNotificationById,
  getNotificationStats,
  clearMemoryHistory,
} = await import('../src/services/notifications.service.js');

test('constants: notification statuses and channels are well-defined', () => {
  assert.deepEqual(NOTIFICATION_STATUSES, [
    NOTIFICATION_STATUS.PENDING,
    NOTIFICATION_STATUS.SENT,
    NOTIFICATION_STATUS.FAILED,
  ]);
  assert.deepEqual(NOTIFICATION_CHANNELS, [
    NOTIFICATION_CHANNEL.EMAIL,
    NOTIFICATION_CHANNEL.SMS,
  ]);
  assert.equal(NOTIFICATION_MAX_RETRIES, 3);
  assert.equal(NOTIFICATION_DEDUP_WINDOW_MS, 300000);
});

test('dispatchEmail tracks status transitions and stores in notification history', async () => {
  clearMemoryHistory();
  const res = await dispatchEmail({
    to: 'student@adnu.edu.ph',
    subject: 'Sticker Ready',
    text: 'Your sticker is ready for pickup.',
    deduplicationKey: 'test-email-1',
  });

  assert.equal(res.success, true);
  assert.equal(res.status, NOTIFICATION_STATUS.SENT);
  assert.ok(res.id);

  const found = await getNotificationById(res.id);
  assert.equal(found.recipient, 'student@adnu.edu.ph');
  assert.equal(found.channel, NOTIFICATION_CHANNEL.EMAIL);
  assert.equal(found.status, NOTIFICATION_STATUS.SENT);
  assert.ok(found.sentAt);
});

test('dispatchSms tracks status transitions and stores in notification history', async () => {
  const res = await dispatchSms({
    to: '+639171234567',
    message: 'Astik Pass: Sticker ready.',
    deduplicationKey: 'test-sms-1',
  });

  assert.equal(res.success, true);
  assert.equal(res.status, NOTIFICATION_STATUS.SENT);

  const found = await getNotificationById(res.id);
  assert.equal(found.recipient, '+639171234567');
  assert.equal(found.channel, NOTIFICATION_CHANNEL.SMS);
  assert.equal(found.status, NOTIFICATION_STATUS.SENT);
});

test('deduplication prevents duplicate notifications within window', async () => {
  const key = 'test-dedup-unique-key';
  const first = await dispatchEmail({
    to: 'faculty@adnu.edu.ph',
    subject: 'Renewal Notice',
    text: 'Renew sticker.',
    deduplicationKey: key,
  });

  assert.equal(first.success, true);

  // Immediate second attempt with same key
  const second = await dispatchEmail({
    to: 'faculty@adnu.edu.ph',
    subject: 'Renewal Notice',
    text: 'Renew sticker.',
    deduplicationKey: key,
  });

  assert.equal(second.duplicate, true);
  assert.equal(second.suppressed, true);
  assert.equal(second.existingId, first.id);
});

test('listNotifications filters by status and channel and returns paginated history', async () => {
  const { notifications, total } = await listNotifications({ channel: NOTIFICATION_CHANNEL.EMAIL });
  assert.ok(total >= 2);
  for (const n of notifications) {
    assert.equal(n.channel, NOTIFICATION_CHANNEL.EMAIL);
  }
});

test('getNotificationStats returns aggregated metrics', async () => {
  const stats = await getNotificationStats();
  assert.ok(stats.total >= 2);
  assert.ok(stats.byStatus[NOTIFICATION_STATUS.SENT] >= 2);
  assert.ok(stats.byChannel[NOTIFICATION_CHANNEL.EMAIL] >= 2);
});

test('error handling and retries transition to FAILED on permanent failure', async () => {
  // Invalid phone number will fail validation in sms.service
  const res = await dispatchSms({
    to: 'invalid-phone-number',
    message: 'Test failure.',
    deduplicationKey: 'test-fail-1',
    retryDelayMs: 10,
  });

  assert.equal(res.success, false);
  assert.equal(res.status, NOTIFICATION_STATUS.FAILED);
  assert.ok(res.error);

  const failed = await getNotificationById(res.id);
  assert.equal(failed.status, NOTIFICATION_STATUS.FAILED);
  assert.ok(failed.failedAt);
});
