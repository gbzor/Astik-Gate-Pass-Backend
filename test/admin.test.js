// Run with: npm test
// Admin dashboard statistics, recent activities and the date/active filters on admin lists,
// called over HTTP against the real app.
//
// Like the other API tests, this ERASES every table first, so it only runs against the
// separate, throwaway database in TEST_DATABASE_URL, never DATABASE_URL.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const testDb = process.env.TEST_DATABASE_URL;
if (!testDb) {
  throw new Error('TEST_DATABASE_URL is not set. Add a separate, empty test database to .env (see .env.example). '
    + 'The tests erase all data, so never point it at the real database.');
}
if (testDb === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is the same as DATABASE_URL. Use a separate test database: the tests erase all data.');
}

process.env.DATABASE_URL = testDb;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.ALLOWED_EMAIL_DOMAINS = 'adnu.edu.ph';
process.env.SEED_ADMIN_EMAIL = 'admin@adnu.edu.ph';
process.env.SEED_ADMIN_PASSWORD = 'Admin-Password-123!';

const { createApp } = await import('../src/app.js');
const { seed } = await import('../src/db/seed.js');
const { pool } = await import('../src/db/index.js');

let server;
let base;
const session = {};
const ids = {};
const car = {};
const app = {};

async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(cookie && { Cookie: cookie }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, body: text ? JSON.parse(text) : null, cookie: setCookie?.split(';')[0] ?? null };
}

const PASSWORD = 'Strong-Pass-1!';
async function signUp(key, { role, firstName, lastName, email, schoolId }) {
  const reg = await call('POST', '/auth/register', {
    body: { role, firstName, lastName, email, schoolId, password: PASSWORD, confirmPassword: PASSWORD },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  ids[key] = reg.body.user.id;
  session[key] = (await call('POST', '/auth/login', { body: { email, password: PASSWORD } })).cookie;
}

async function addVehicle(key, owner, plateNumber, type = 'car') {
  const res = await call('POST', '/vehicles', { cookie: session[owner], body: { plateNumber, type } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  car[key] = res.body.vehicle.id;
}

// A date N days from today, as YYYY-MM-DD in campus time.
const dayFromToday = (n) => new Date(Date.now() + 8 * 3600000 + n * 86400000).toISOString().slice(0, 10);
const admin = (path) => call('GET', path, { cookie: session.admin });

before(async () => {
  await pool.query(await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
  await pool.query('TRUNCATE parking_records, campus_stickers, parking_areas, vehicles, admin_accounts, users CASCADE');
  await seed();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;

  await signUp('ana', { role: 'student', firstName: 'Ana', lastName: 'Reyes', email: 'ana@gbox.adnu.edu.ph', schoolId: '2023-00001' });
  await signUp('prof', { role: 'faculty', firstName: 'Carla', lastName: 'Mendoza', email: 'cmendoza@adnu.edu.ph', schoolId: 'EMP-0100' });
  const login = await call('POST', '/auth/admin/login', { body: { email: 'admin@adnu.edu.ph', password: 'Admin-Password-123!' } });
  session.admin = login.cookie;
  ids.admin = login.body.user.id;

  await addVehicle('ana', 'ana', 'ANA 001');
  await addVehicle('prof', 'prof', 'FAC 001', 'motorcycle');
  await addVehicle('old', 'prof', 'FAC 002', 'van');

  for (const [key, who] of [['ana', 'ana'], ['prof', 'prof']]) {
    const res = await call('POST', '/sticker-applications', { cookie: session[who], body: { vehicleId: car[key] } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    app[key] = res.body.application.id;
  }
  // Approved, running out in 10 days (so "expiring soon"), and one rejected.
  const ok = await call('PATCH', `/sticker-applications/${app.ana}/approve`, {
    cookie: session.admin, body: { stickerNumber: '2026-0001', expiresAt: dayFromToday(10) },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const no = await call('PATCH', `/sticker-applications/${app.prof}/reject`, {
    cookie: session.admin, body: { reason: 'Blurry OR/CR photo.' },
  });
  assert.equal(no.status, 200, JSON.stringify(no.body));
  // Deactivate the van (no sticker history, so an admin can just mark it inactive in the database).
  await pool.query('UPDATE vehicles SET is_active = FALSE WHERE id = $1', [car.old]);

  const area = await pool.query("INSERT INTO parking_areas (name, latitude, longitude, capacity) VALUES ('Gate A', 13.63, 123.19, 40) RETURNING id");
  await pool.query(
    'INSERT INTO parking_records (user_id, vehicle_id, parking_area_id, sticker_id) VALUES ($1, $2, $3, $4)',
    [ids.ana, car.ana, area.rows[0].id, app.ana],
  );
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// --- Access ----------------------------------------------------------------------

test('dashboard and activities need a signed-in admin', async () => {
  for (const path of ['/admin/dashboard', '/admin/activities']) {
    assert.equal((await call('GET', path)).status, 401, path);
    assert.equal((await call('GET', path, { cookie: session.ana })).status, 403, path);
    assert.equal((await call('GET', path, { cookie: session.prof })).status, 403, path);
  }
  assert.equal((await call('GET', '/admin/anything-else', { cookie: session.ana })).status, 403);
});

// --- Dashboard ---------------------------------------------------------------------

test('dashboard: counts users, vehicles, stickers and parking', async () => {
  const res = await admin('/admin/dashboard');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const s = res.body.stats;

  assert.deepEqual(s.users, {
    total: 3, byRole: { student: 1, faculty: 1, admin: 1 }, byStatus: { active: 3, disabled: 0 }, newRecently: 3,
  });
  assert.deepEqual(s.vehicles, {
    total: 3, active: 2, deactivated: 1, byType: { car: 1, motorcycle: 1, tricycle: 0, van: 1, other: 0 }, newRecently: 3,
  });
  assert.deepEqual(s.stickerApplications, {
    total: 2, byStatus: { pending: 0, approved: 1, rejected: 1 }, validStickers: 1, expiringSoon: 1, expiredStickers: 0,
  });
  assert.deepEqual(s.parking, { activeAreas: 1, totalCapacity: 40, currentlyParked: 1, availableSlots: 39 });
  assert.deepEqual(s.settings, { newWithinDays: 7, expiringWithinDays: 30 });
  assert.ok(!Number.isNaN(Date.parse(s.generatedAt)));
});

test('dashboard: never sends emails or password hashes', async () => {
  const text = JSON.stringify((await admin('/admin/dashboard')).body);
  assert.ok(!text.includes('@'), 'no email addresses');
  assert.ok(!/passwordHash|password_hash|\$2[aby]\$/.test(text), 'no password hashes');
});

// --- Activities --------------------------------------------------------------------

test('activities: every event, newest first, with paging info', async () => {
  const res = await admin('/admin/activities');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { activities, pagination } = res.body;
  // 2 sign-ups (the seeded admin is not a sign-up) + 3 vehicles + 2 submissions + 2 reviews.
  assert.equal(pagination.total, 9);
  assert.deepEqual(pagination, { page: 1, limit: 20, total: 9, totalPages: 1 });
  const times = activities.map((a) => Date.parse(a.occurredAt));
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first');
  assert.equal(new Set(activities.map((a) => a.id)).size, 9, 'ids are unique');
  assert.ok(!JSON.stringify(activities).includes('@'), 'no email addresses');
});

test('activities: a review names the admin who did it and the applicant', async () => {
  const approved = (await admin('/admin/activities?type=sticker_approved')).body.activities;
  assert.equal(approved.length, 1);
  assert.equal(approved[0].recordId, app.ana);
  assert.equal(approved[0].actor.id, ids.admin);
  assert.equal(approved[0].actor.role, 'admin');
  assert.deepEqual(approved[0].applicant, { id: ids.ana, fullName: 'Ana Reyes' });
  assert.equal(approved[0].plateNumber, 'ANA 001');
  assert.equal(approved[0].stickerNumber, '2026-0001');

  const rejected = (await admin('/admin/activities?type=sticker_rejected')).body.activities;
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].applicant.fullName, 'Carla Mendoza');
  assert.equal(rejected[0].stickerNumber, null);
});

test('activities: filter by type and date, and page through them', async () => {
  const signUps = (await admin('/admin/activities?type=user_registered')).body.activities;
  assert.deepEqual(signUps.map((a) => a.actor.id).sort(), [ids.ana, ids.prof].sort());
  assert.ok(signUps.every((a) => a.recordId === a.actor.id && a.applicant === null));

  assert.equal((await admin(`/admin/activities?from=${dayFromToday(1)}`)).body.pagination.total, 0);
  assert.equal((await admin(`/admin/activities?to=${dayFromToday(-1)}`)).body.pagination.total, 0);
  assert.equal((await admin(`/admin/activities?from=${dayFromToday(0)}&to=${dayFromToday(0)}`)).body.pagination.total, 9);

  const page1 = (await admin('/admin/activities?limit=4')).body;
  const page3 = (await admin('/admin/activities?limit=4&page=3')).body;
  assert.equal(page1.activities.length, 4);
  assert.equal(page3.activities.length, 1);
  assert.equal(page3.pagination.totalPages, 3);
  assert.ok(!page1.activities.some((a) => a.id === page3.activities[0].id));
});

test('activities: bad filters get 400 with the field name', async () => {
  const res = await admin('/admin/activities?type=nope&from=2026-02-30');
  assert.equal(res.status, 400);
  assert.deepEqual(res.body.error.fields.map((f) => f.field).sort(), ['from', 'type']);
  assert.equal((await admin('/admin/activities?limit=1000')).status, 400);
});

// --- Admin list filters ------------------------------------------------------------

test('vehicles list: isActive filter', async () => {
  const off = (await admin('/vehicles?isActive=false')).body;
  assert.deepEqual(off.vehicles.map((v) => v.id), [car.old]);
  assert.equal((await admin('/vehicles?isActive=true')).body.pagination.total, 2);
  assert.equal((await admin('/vehicles?isActive=maybe')).status, 400);
});

test('admin lists: from/to filters by creation date', async () => {
  for (const path of ['/users', '/vehicles', '/sticker-applications']) {
    const today = (await admin(`${path}?from=${dayFromToday(0)}&to=${dayFromToday(0)}`)).body;
    assert.ok(today.pagination.total > 0, path);
    assert.equal((await admin(`${path}?from=${dayFromToday(1)}`)).body.pagination.total, 0, path);
    assert.equal((await admin(`${path}?from=${dayFromToday(1)}&to=${dayFromToday(0)}`)).status, 400, path);
  }
});
