// Run with: npm test (no database needed for this file).
// Input rules for the admin dashboard routes and the date filters on admin lists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITY_TYPE, DATE_RANGE_MAX_DAYS, PAGE_SIZE_DEFAULT } from '../src/config/constants.js';
import { listActivitiesQuery } from '../src/validators/admin.schemas.js';
import { listVehiclesQuery } from '../src/validators/vehicles.schemas.js';
import { listUsersQuery } from '../src/validators/users.schemas.js';
import { listApplicationsQuery } from '../src/validators/stickers.schemas.js';

const fields = (result) => [...new Set(result.error.issues.map((i) => i.path.join('.')))];

test('activities: defaults to page 1 with the default page size and no filters', () => {
  assert.deepEqual(listActivitiesQuery.parse({}), { page: 1, limit: PAGE_SIZE_DEFAULT });
});

test('activities: type must be a known activity type', () => {
  assert.equal(listActivitiesQuery.parse({ type: ACTIVITY_TYPE.STICKER_APPROVED }).type, ACTIVITY_TYPE.STICKER_APPROVED);
  assert.deepEqual(fields(listActivitiesQuery.safeParse({ type: 'password_changed' })), ['type']);
  assert.deepEqual(fields(listActivitiesQuery.safeParse({ type: "x' OR 1=1 --" })), ['type']);
});

test('date range: from = start of that day, to = end of that day, in campus time (UTC+8)', () => {
  const q = listActivitiesQuery.parse({ from: '2026-08-01', to: '2026-08-01' });
  assert.equal(q.from.toISOString(), '2026-07-31T16:00:00.000Z');
  assert.equal(q.to.toISOString(), '2026-08-01T15:59:59.999Z');
});

test('date range: bad dates, reversed ranges and huge ranges are refused', () => {
  assert.deepEqual(fields(listActivitiesQuery.safeParse({ from: '2026-13-01' })), ['from']);
  assert.deepEqual(fields(listActivitiesQuery.safeParse({ to: 'yesterday' })), ['to']);
  assert.deepEqual(fields(listActivitiesQuery.safeParse({ from: '2026-08-02', to: '2026-08-01' })), ['to']);
  const tooLong = new Date(Date.UTC(2020, 0, 1) + (DATE_RANGE_MAX_DAYS + 1) * 86400000).toISOString().slice(0, 10);
  assert.deepEqual(fields(listActivitiesQuery.safeParse({ from: '2020-01-01', to: tooLong })), ['to']);
});

test('every admin list accepts from/to', () => {
  for (const schema of [listUsersQuery, listVehiclesQuery, listApplicationsQuery]) {
    const q = schema.parse({ from: '2026-01-01', to: '2026-12-31' });
    assert.ok(q.from instanceof Date && q.to instanceof Date);
    assert.equal(schema.safeParse({ from: '2026-12-31', to: '2026-01-01' }).success, false);
  }
});

test('vehicles: isActive only accepts the words true and false', () => {
  assert.equal(listVehiclesQuery.parse({ isActive: 'true' }).isActive, true);
  assert.equal(listVehiclesQuery.parse({ isActive: 'false' }).isActive, false);
  assert.equal(listVehiclesQuery.parse({}).isActive, undefined);
  for (const bad of ['yes', '1', '', 'TRUE']) {
    assert.deepEqual(fields(listVehiclesQuery.safeParse({ isActive: bad })), ['isActive'], bad);
  }
});
