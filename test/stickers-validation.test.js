// Run with: npm test (no database needed for this file).
// Input rules for the campus sticker application routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  approveApplicationSchema,
  listApplicationsQuery,
  rejectApplicationSchema,
  submitApplicationSchema,
} from '../src/validators/stickers.schemas.js';

const nextYear = new Date().getFullYear() + 1;
// The field names with an error (each once, even if it broke several rules).
const fields = (result) => [...new Set(result.error.issues.map((i) => i.path.join('.')))];

test('submit: only a vehicle ID is accepted; applicant and status cannot be sent', () => {
  const ok = submitApplicationSchema.parse({
    vehicleId: '9b06a7f3-1b2c-4d5e-8f90-123456789abc',
    applicantId: '00000000-0000-4000-8000-000000000000',
    status: 'approved',
    stickerNumber: 'FREE-1',
  });
  assert.deepEqual(ok, { vehicleId: '9b06a7f3-1b2c-4d5e-8f90-123456789abc' });
  assert.equal(submitApplicationSchema.safeParse({ vehicleId: "1' OR '1'='1" }).success, false);
});

test('approve: sticker number is normalized; a date means the end of that day in PH time', () => {
  const ok = approveApplicationSchema.parse({ stickerNumber: ' 2026-0001 ', expiresAt: `${nextYear}-06-30` });
  assert.equal(ok.stickerNumber, '2026-0001');
  assert.equal(ok.expiresAt.toISOString(), `${nextYear}-06-30T15:59:59.999Z`);
});

test('approve: expiry must be in the future, within the limit, and include a time zone', () => {
  const bad = (expiresAt) => fields(approveApplicationSchema.safeParse({ stickerNumber: 'A1', expiresAt }));
  assert.deepEqual(bad('2020-01-01'), ['expiresAt']);
  assert.deepEqual(bad(`${nextYear + 4}-01-01`), ['expiresAt']);
  assert.deepEqual(bad(`${nextYear}-01-01T10:00:00`), ['expiresAt']);
  assert.deepEqual(bad('tomorrow'), ['expiresAt']);
});

test('approve: sticker numbers are letters, numbers and hyphens only', () => {
  for (const stickerNumber of ['<b>x</b>', '---', '', 'A'.repeat(21)]) {
    const result = approveApplicationSchema.safeParse({ stickerNumber, expiresAt: `${nextYear}-01-01` });
    assert.deepEqual(fields(result), ['stickerNumber'], stickerNumber);
  }
});

test('reject: a reason of 3-500 characters is required; control characters are refused', () => {
  assert.equal(rejectApplicationSchema.parse({ reason: ' Blurry OR/CR.\nPlease resubmit. ' }).reason,
    'Blurry OR/CR.\nPlease resubmit.');
  assert.equal(rejectApplicationSchema.safeParse({}).success, false);
  assert.equal(rejectApplicationSchema.safeParse({ reason: ' a ' }).success, false);
  assert.equal(rejectApplicationSchema.safeParse({ reason: 'x'.repeat(501) }).success, false);
  assert.equal(rejectApplicationSchema.safeParse({ reason: 'bad\u0000text' }).success, false);
});

test('admin list: only known statuses and sort columns', () => {
  assert.equal(listApplicationsQuery.safeParse({ status: 'expired' }).success, false);
  assert.equal(listApplicationsQuery.safeParse({ sort: 'id;DROP TABLE users' }).success, false);
  assert.equal(listApplicationsQuery.safeParse({ limit: '1000' }).success, false);
  assert.deepEqual(listApplicationsQuery.parse({}), { sort: 'createdAt', order: 'desc', page: 1, limit: 20 });
});
