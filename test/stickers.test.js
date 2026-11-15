// Run with: npm test
// Campus sticker application APIs, called over HTTP against the real app.
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
const session = {}; // cookies: session.ana, session.ben, session.prof, session.admin
const ids = {}; // user IDs
const car = {}; // vehicle IDs
const app = {}; // application IDs

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

async function addVehicle(key, owner, plateNumber) {
  const res = await call('POST', '/vehicles', { cookie: session[owner], body: { plateNumber, type: 'car' } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  car[key] = res.body.vehicle.id;
}

const nextYear = new Date().getFullYear() + 1;
const approval = (stickerNumber) => ({ stickerNumber, expiresAt: `${nextYear}-06-30` });
const submit = (who, vehicleId) => call('POST', '/sticker-applications', { cookie: session[who], body: { vehicleId } });

before(async () => {
  await pool.query(await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
  await pool.query('TRUNCATE parking_records, campus_stickers, parking_areas, vehicles, admin_accounts, users CASCADE');
  await seed();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;

  await signUp('ana', { role: 'student', firstName: 'Ana', lastName: 'Reyes', email: 'ana@gbox.adnu.edu.ph', schoolId: '2023-00001' });
  await signUp('ben', { role: 'student', firstName: 'Ben', lastName: 'Santos', email: 'ben@gbox.adnu.edu.ph', schoolId: '2023-00002' });
  await signUp('prof', { role: 'faculty', firstName: 'Carla', lastName: 'Mendoza', email: 'cmendoza@adnu.edu.ph', schoolId: 'EMP-0100' });
  const admin = await call('POST', '/auth/admin/login', { body: { email: 'admin@adnu.edu.ph', password: 'Admin-Password-123!' } });
  session.admin = admin.cookie;
  ids.admin = admin.body.user.id;

  await addVehicle('ana', 'ana', 'ANA 001');
  await addVehicle('ana2', 'ana', 'ANA 002');
  await addVehicle('ben', 'ben', 'BEN 001');
  await addVehicle('prof', 'prof', 'FAC 001');
  await addVehicle('prof2', 'prof', 'FAC 002');
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// --- Submission ----------------------------------------------------------------

test('a student applies for their own vehicle; it starts as pending', async () => {
  const res = await call('POST', '/sticker-applications', {
    cookie: session.ana,
    body: { vehicleId: car.ana, applicantId: ids.ben, status: 'approved', stickerNumber: 'FREE-1' },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const a = res.body.application;
  assert.equal(a.status, 'pending');
  assert.equal(a.applicantId, ids.ana, 'the applicant comes from the session');
  assert.equal(a.stickerNumber, null, 'stickerNumber in the body is ignored');
  assert.equal(a.vehicle.plateNumber, 'ANA 001');
  assert.equal(a.applicant, undefined, 'applicants do not get the applicant block');
  assert.equal(a.reviewedBy, undefined);
  app.ana = a.id;
});

test('one open (pending or approved) application per vehicle', async () => {
  const res = await submit('ana', car.ana);
  assert.equal(res.status, 409);
  assert.equal(res.body.error.message, 'This vehicle already has a pending or approved sticker application.');
});

test('two applications sent at the same moment: only one is saved', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => submit('prof', car.prof)));
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 409, 409, 409, 409, 409, 409, 409]);
  app.prof = results.find((r) => r.status === 201).body.application.id;
});

test('you cannot apply for someone else\'s vehicle (404, no probing)', async () => {
  const res = await submit('ben', car.ana);
  assert.equal(res.status, 404);
  assert.equal(res.body.error.message, 'Vehicle not found.');
  assert.equal((await submit('ben', '00000000-0000-4000-8000-000000000000')).status, 404);
});

test('a deactivated vehicle cannot be applied for', async () => {
  await pool.query('UPDATE vehicles SET is_active = FALSE WHERE id = $1', [car.ben]);
  const list = await call('GET', '/vehicles/mine', { cookie: session.ben });
  assert.equal(list.body.vehicles[0].isActive, false, 'the frontend can see the vehicle is deactivated');
  const res = await submit('ben', car.ben);
  assert.equal(res.status, 409);
  assert.equal(res.body.error.message, 'This vehicle is deactivated, so it can\'t get a sticker.');
  await pool.query('UPDATE vehicles SET is_active = TRUE WHERE id = $1', [car.ben]);
  const ok = await submit('ben', car.ben);
  assert.equal(ok.status, 201);
  app.ben = ok.body.application.id;
});

test('submission input is validated; admins and signed-out users cannot apply', async () => {
  const bad = await call('POST', '/sticker-applications', { cookie: session.ana, body: { vehicleId: 'abc' } });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.error.fields.map((f) => f.field), ['vehicleId']);
  assert.equal((await submit('admin', car.ana2)).status, 403);
  assert.equal((await call('POST', '/sticker-applications', { body: { vehicleId: car.ana2 } })).status, 401);
});

// --- Retrieval -----------------------------------------------------------------

test('GET /mine lists only your own applications, filterable by status', async () => {
  const mine = await call('GET', '/sticker-applications/mine', { cookie: session.ana });
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.applications.map((a) => a.id), [app.ana]);

  const approved = await call('GET', '/sticker-applications/mine?status=approved', { cookie: session.ana });
  assert.deepEqual(approved.body.applications, []);
  assert.equal((await call('GET', '/sticker-applications/mine?status=lost', { cookie: session.ana })).status, 400);
  assert.equal((await call('GET', '/sticker-applications/mine', { cookie: session.admin })).status, 403);
});

test('one application: the applicant and admins can see it; others get 404', async () => {
  assert.equal((await call('GET', `/sticker-applications/${app.ana}`, { cookie: session.ana })).status, 200);
  assert.equal((await call('GET', `/sticker-applications/${app.ana}`, { cookie: session.ben })).status, 404);

  const asAdmin = await call('GET', `/sticker-applications/${app.ana}`, { cookie: session.admin });
  assert.equal(asAdmin.status, 200);
  assert.equal(asAdmin.body.application.applicant.fullName, 'Ana Reyes');
  assert.equal(asAdmin.body.application.applicant.passwordHash, undefined);

  assert.equal((await call('GET', "/sticker-applications/1' OR '1'='1", { cookie: session.admin })).status, 400);
  assert.equal((await call('GET', '/sticker-applications/00000000-0000-4000-8000-000000000000', { cookie: session.admin })).status, 404);
});

test('only admins can list every application', async () => {
  assert.equal((await call('GET', '/sticker-applications', { cookie: session.ana })).status, 403);
  assert.equal((await call('GET', '/sticker-applications')).status, 401);
});

// --- Approve and reject ----------------------------------------------------------

test('students and faculty cannot approve or reject', async () => {
  assert.equal((await call('PATCH', `/sticker-applications/${app.ana}/approve`, { cookie: session.ana, body: approval('X-1') })).status, 403);
  assert.equal((await call('PATCH', `/sticker-applications/${app.ben}/reject`, { cookie: session.prof, body: { reason: 'No.' } })).status, 403);
});

test('approval needs a sticker number and a future expiry date', async () => {
  const res = await call('PATCH', `/sticker-applications/${app.ana}/approve`, { cookie: session.admin, body: {} });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body.error.fields.map((f) => f.field).sort(), ['expiresAt', 'stickerNumber']);
  const past = await call('PATCH', `/sticker-applications/${app.ana}/approve`, {
    cookie: session.admin, body: { stickerNumber: 'S-1', expiresAt: '2020-01-01' },
  });
  assert.equal(past.status, 400);
});

test('an admin approves: sticker number, expiry and reviewer are saved', async () => {
  const res = await call('PATCH', `/sticker-applications/${app.ana}/approve`, { cookie: session.admin, body: approval('2026-0001') });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const a = res.body.application;
  assert.equal(a.status, 'approved');
  assert.equal(a.stickerNumber, '2026-0001');
  assert.equal(a.expiresAt, `${nextYear}-06-30T15:59:59.999Z`);
  assert.ok(a.reviewedAt);
  assert.equal(a.reviewedBy.id, ids.admin);
  assert.equal(a.reviewedBy.fullName, 'System Admin');

  const own = await call('GET', `/sticker-applications/${app.ana}`, { cookie: session.ana });
  assert.equal(own.body.application.status, 'approved');
  assert.equal(own.body.application.reviewedBy, undefined, 'applicants do not see who reviewed it');
});

test('a reviewed application cannot be reviewed again', async () => {
  const again = await call('PATCH', `/sticker-applications/${app.ana}/approve`, { cookie: session.admin, body: approval('2026-0099') });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.message, 'This application was already approved.');
  const reject = await call('PATCH', `/sticker-applications/${app.ana}/reject`, { cookie: session.admin, body: { reason: 'Changed mind' } });
  assert.equal(reject.status, 409);
});

test('a sticker number can only be given out once', async () => {
  const res = await call('PATCH', `/sticker-applications/${app.prof}/approve`, { cookie: session.admin, body: approval('2026-0001') });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.message, 'That sticker number is already assigned to another vehicle.');
});

test('two admins approving at the same moment: exactly one succeeds', async () => {
  const results = await Promise.all(['2026-0101', '2026-0102', '2026-0103'].map((n) => call(
    'PATCH', `/sticker-applications/${app.prof}/approve`, { cookie: session.admin, body: approval(n) },
  )));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409]);
});

test('a pending application for a deactivated vehicle cannot be approved', async () => {
  const pending = await submit('prof', car.prof2);
  assert.equal(pending.status, 201);
  app.prof2 = pending.body.application.id;
  await pool.query('UPDATE vehicles SET is_active = FALSE WHERE id = $1', [car.prof2]);
  const res = await call('PATCH', `/sticker-applications/${app.prof2}/approve`, { cookie: session.admin, body: approval('2026-0200') });
  assert.equal(res.status, 409);
  await pool.query('UPDATE vehicles SET is_active = TRUE WHERE id = $1', [car.prof2]);
});

test('an admin rejects with a reason the applicant can read', async () => {
  const noReason = await call('PATCH', `/sticker-applications/${app.ben}/reject`, { cookie: session.admin, body: {} });
  assert.equal(noReason.status, 400);

  const res = await call('PATCH', `/sticker-applications/${app.ben}/reject`, {
    cookie: session.admin, body: { reason: 'The OR/CR photo is unreadable. Please apply again.' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.application.status, 'rejected');
  assert.equal(res.body.application.stickerNumber, null);

  const own = await call('GET', `/sticker-applications/${app.ben}`, { cookie: session.ben });
  assert.equal(own.body.application.rejectionReason, 'The OR/CR photo is unreadable. Please apply again.');
});

test('after a rejection the vehicle can be applied for again', async () => {
  const res = await submit('ben', car.ben);
  assert.equal(res.status, 201);
  const mine = await call('GET', '/sticker-applications/mine', { cookie: session.ben });
  assert.deepEqual(mine.body.applications.map((a) => a.status), ['pending', 'rejected'], 'newest first');
});

test('reviewing an unknown application gives 404', async () => {
  const res = await call('PATCH', '/sticker-applications/00000000-0000-4000-8000-000000000000/reject', {
    cookie: session.admin, body: { reason: 'Not real' },
  });
  assert.equal(res.status, 404);
});

// --- Admin list ------------------------------------------------------------------

test('admin list: filter by status and role, search, sort and paging', async () => {
  const all = await call('GET', '/sticker-applications?sort=plateNumber&order=asc&limit=2', { cookie: session.admin });
  assert.equal(all.status, 200);
  assert.equal(all.body.pagination.total, 5);
  assert.equal(all.body.pagination.totalPages, 3);
  assert.deepEqual(all.body.applications.map((a) => a.vehicle.plateNumber), ['ANA 001', 'BEN 001']);
  assert.ok(all.body.applications[0].applicant, 'admin list includes applicant details');

  const pending = await call('GET', '/sticker-applications?status=pending', { cookie: session.admin });
  assert.deepEqual(pending.body.applications.map((a) => a.vehicle.plateNumber).sort(), ['BEN 001', 'FAC 002']);

  const approved = await call('GET', '/sticker-applications?status=approved', { cookie: session.admin });
  assert.equal(approved.body.pagination.total, 2);

  const faculty = await call('GET', '/sticker-applications?applicantRole=faculty', { cookie: session.admin });
  assert.equal(faculty.body.pagination.total, 2);

  const bySticker = await call('GET', '/sticker-applications?q=2026-0001', { cookie: session.admin });
  assert.deepEqual(bySticker.body.applications.map((a) => a.id), [app.ana]);

  const byName = await call('GET', '/sticker-applications?q=ben%20santos', { cookie: session.admin });
  assert.equal(byName.body.pagination.total, 2);

  const wildcard = await call('GET', '/sticker-applications?q=_', { cookie: session.admin });
  assert.equal(wildcard.body.pagination.total, 0, 'search text is plain text');

  assert.equal((await call('GET', '/sticker-applications?sort=password_hash', { cookie: session.admin })).status, 400);
});
