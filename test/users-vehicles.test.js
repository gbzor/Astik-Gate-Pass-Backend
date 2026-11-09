// Run with: npm test
// User management and vehicle APIs, called over HTTP against the real app.
//
// Like auth.test.js, this ERASES every table first, so it only runs against the
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
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// --- Vehicles ------------------------------------------------------------------

const vehicleIds = {};

test('a student registers a vehicle; the plate is normalized', async () => {
  const res = await call('POST', '/vehicles', {
    cookie: session.ana,
    body: { plateNumber: '  abc   1234 ', type: 'car', make: 'Toyota', model: 'Vios', color: 'White' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.vehicle.plateNumber, 'ABC 1234');
  assert.equal(res.body.vehicle.ownerId, ids.ana);
  assert.equal(res.body.vehicle.owner, undefined, 'owners do not get the owner block');
  vehicleIds.ana = res.body.vehicle.id;
});

test('the owner always comes from the session, not the request body', async () => {
  const res = await call('POST', '/vehicles', {
    cookie: session.ben,
    body: { plateNumber: 'BEN 001', type: 'motorcycle', ownerId: ids.ana, owner_id: ids.ana },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.vehicle.ownerId, ids.ben);
  vehicleIds.ben = res.body.vehicle.id;
});

test('duplicate plate numbers are refused, whatever the spacing or case', async () => {
  const res = await call('POST', '/vehicles', { cookie: session.prof, body: { plateNumber: 'Abc 1234', type: 'car' } });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.message, 'This plate number is already registered.');
});

test('vehicle input is validated', async () => {
  const res = await call('POST', '/vehicles', {
    cookie: session.ana,
    body: { plateNumber: '<script>', type: 'spaceship', make: 'x'.repeat(41) },
  });
  assert.equal(res.status, 400);
  const fields = res.body.error.fields.map((f) => f.field);
  assert.ok(fields.includes('plateNumber'));
  assert.ok(fields.includes('type'));
  assert.ok(fields.includes('make'));
});

test('admins cannot register vehicles, and signed-out users get 401', async () => {
  assert.equal((await call('POST', '/vehicles', { cookie: session.admin, body: { plateNumber: 'ADM 1', type: 'car' } })).status, 403);
  assert.equal((await call('POST', '/vehicles', { body: { plateNumber: 'NOBODY 1', type: 'car' } })).status, 401);
});

test('a user can register at most 5 vehicles', async () => {
  for (let i = 1; i <= 4; i += 1) {
    const ok = await call('POST', '/vehicles', { cookie: session.prof, body: { plateNumber: `FAC ${i}00`, type: 'car' } });
    assert.equal(ok.status, 201);
  }
  const fifth = await call('POST', '/vehicles', { cookie: session.prof, body: { plateNumber: 'FAC 500', type: 'van' } });
  assert.equal(fifth.status, 201);
  const sixth = await call('POST', '/vehicles', { cookie: session.prof, body: { plateNumber: 'FAC 600', type: 'van' } });
  assert.equal(sixth.status, 409);
});

test('GET /vehicles/mine lists only your own vehicles', async () => {
  const res = await call('GET', '/vehicles/mine', { cookie: session.ana });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.vehicles.map((v) => v.plateNumber), ['ABC 1234']);
});

test('owners can view their vehicle; other students get 404 (no ID probing)', async () => {
  assert.equal((await call('GET', `/vehicles/${vehicleIds.ana}`, { cookie: session.ana })).status, 200);
  const other = await call('GET', `/vehicles/${vehicleIds.ana}`, { cookie: session.ben });
  assert.equal(other.status, 404);
  assert.equal((await call('PATCH', `/vehicles/${vehicleIds.ana}`, { cookie: session.ben, body: { color: 'Red' } })).status, 404);
  assert.equal((await call('DELETE', `/vehicles/${vehicleIds.ana}`, { cookie: session.ben })).status, 404);
});

test('admins can view any vehicle with its owner details', async () => {
  const res = await call('GET', `/vehicles/${vehicleIds.ana}`, { cookie: session.admin });
  assert.equal(res.status, 200);
  assert.equal(res.body.vehicle.owner.fullName, 'Ana Reyes');
  assert.equal(res.body.vehicle.owner.passwordHash, undefined);
});

test('a malformed vehicle ID is refused before reaching the database', async () => {
  const res = await call('GET', "/vehicles/1' OR '1'='1", { cookie: session.admin });
  assert.equal(res.status, 400);
});

test('owners update their vehicle; ownerId cannot be changed', async () => {
  const res = await call('PATCH', `/vehicles/${vehicleIds.ana}`, {
    cookie: session.ana,
    body: { color: 'Pearl White', model: null, ownerId: ids.ben },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.vehicle.color, 'Pearl White');
  assert.equal(res.body.vehicle.model, null);
  assert.equal(res.body.vehicle.ownerId, ids.ana);
});

test('updating to a plate that is already taken is refused', async () => {
  const res = await call('PATCH', `/vehicles/${vehicleIds.ana}`, { cookie: session.ana, body: { plateNumber: 'ben 001' } });
  assert.equal(res.status, 409);
});

test('an empty update is refused', async () => {
  const res = await call('PATCH', `/vehicles/${vehicleIds.ana}`, { cookie: session.ana, body: {} });
  assert.equal(res.status, 400);
});

test('the plate is locked and delete is refused once a sticker application exists', async () => {
  await pool.query(
    'INSERT INTO campus_stickers (vehicle_id, applicant_id) VALUES ($1, $2)',
    [vehicleIds.ana, ids.ana],
  );
  const plate = await call('PATCH', `/vehicles/${vehicleIds.ana}`, { cookie: session.ana, body: { plateNumber: 'NEW 999' } });
  assert.equal(plate.status, 409);
  const color = await call('PATCH', `/vehicles/${vehicleIds.ana}`, { cookie: session.ana, body: { color: 'Black' } });
  assert.equal(color.status, 200, 'other details can still change');
  const del = await call('DELETE', `/vehicles/${vehicleIds.ana}`, { cookie: session.ana });
  assert.equal(del.status, 409);
});

test('owners can delete a vehicle with no history', async () => {
  assert.equal((await call('DELETE', `/vehicles/${vehicleIds.ben}`, { cookie: session.ben })).status, 204);
  assert.equal((await call('GET', `/vehicles/${vehicleIds.ben}`, { cookie: session.ben })).status, 404);
});

test('admin vehicle list: filter, search, sort and paging', async () => {
  const all = await call('GET', '/vehicles?limit=2&sort=plateNumber&order=asc', { cookie: session.admin });
  assert.equal(all.status, 200);
  assert.equal(all.body.pagination.total, 6);
  assert.equal(all.body.pagination.totalPages, 3);
  assert.deepEqual(all.body.vehicles.map((v) => v.plateNumber), ['ABC 1234', 'FAC 100']);
  assert.ok(all.body.vehicles[0].owner, 'admin list includes owner details');

  const vans = await call('GET', '/vehicles?type=van', { cookie: session.admin });
  assert.equal(vans.body.pagination.total, 1);

  const byOwner = await call('GET', '/vehicles?q=mendoza', { cookie: session.admin });
  assert.equal(byOwner.body.pagination.total, 5);

  const students = await call('GET', '/vehicles?ownerRole=student', { cookie: session.admin });
  assert.equal(students.body.pagination.total, 1);
});

test('only admins can list every vehicle', async () => {
  assert.equal((await call('GET', '/vehicles', { cookie: session.ana })).status, 403);
});

// --- Users ---------------------------------------------------------------------

test('a user updates their own name; email, role and status are ignored', async () => {
  const res = await call('PATCH', '/users/me', {
    cookie: session.ben,
    body: { firstName: 'Benjamin', role: 'admin', status: 'disabled', email: 'hacker@adnu.edu.ph' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.firstName, 'Benjamin');
  assert.equal(res.body.user.role, 'student');
  assert.equal(res.body.user.status, 'active');
  assert.equal(res.body.user.email, 'ben@gbox.adnu.edu.ph');
});

test('profile updates are validated', async () => {
  assert.equal((await call('PATCH', '/users/me', { cookie: session.ben, body: {} })).status, 400);
  assert.equal((await call('PATCH', '/users/me', { cookie: session.ben, body: { lastName: '<b>x</b>' } })).status, 400);
  assert.equal((await call('PATCH', '/users/me', { body: { firstName: 'X' } })).status, 401);
});

test('admin user list: filter by role and status, search, paging', async () => {
  const students = await call('GET', '/users?role=student', { cookie: session.admin });
  assert.equal(students.status, 200);
  assert.equal(students.body.pagination.total, 2);
  assert.equal(students.body.users[0].passwordHash, undefined);
  assert.equal(typeof students.body.users[0].vehicleCount, 'number');

  const faculty = await call('GET', '/users?role=faculty&status=active', { cookie: session.admin });
  assert.deepEqual(faculty.body.users.map((u) => u.schoolId), ['EMP-0100']);
  assert.equal(faculty.body.users[0].vehicleCount, 5);

  const search = await call('GET', '/users?q=ana%20reyes', { cookie: session.admin });
  assert.deepEqual(search.body.users.map((u) => u.email), ['ana@gbox.adnu.edu.ph']);

  const page = await call('GET', '/users?limit=1&page=2&sort=lastName&order=asc', { cookie: session.admin });
  assert.equal(page.body.users.length, 1);
  assert.equal(page.body.pagination.total, 4);
});

test('search text is plain text: wildcards and SQL do not match everything', async () => {
  const wildcard = await call('GET', '/users?q=_', { cookie: session.admin });
  assert.equal(wildcard.status, 200);
  assert.equal(wildcard.body.pagination.total, 0);

  const injection = await call('GET', `/users?q=${encodeURIComponent("' OR 1=1 --")}`, { cookie: session.admin });
  assert.equal(injection.status, 400);
});

test('list queries are validated (bad sort, huge page size)', async () => {
  assert.equal((await call('GET', '/users?sort=password_hash', { cookie: session.admin })).status, 400);
  assert.equal((await call('GET', '/users?limit=100000', { cookie: session.admin })).status, 400);
  assert.equal((await call('GET', '/vehicles?sort=id;DROP TABLE users', { cookie: session.admin })).status, 400);
});

test('admin views one user with their vehicles', async () => {
  const res = await call('GET', `/users/${ids.ana}`, { cookie: session.admin });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.fullName, 'Ana Reyes');
  assert.equal(res.body.user.passwordHash, undefined);
  assert.deepEqual(res.body.vehicles.map((v) => v.plateNumber), ['ABC 1234']);
  assert.equal((await call('GET', '/users/00000000-0000-4000-8000-000000000000', { cookie: session.admin })).status, 404);
});

test('students and faculty cannot use the admin user routes', async () => {
  assert.equal((await call('GET', '/users', { cookie: session.ana })).status, 403);
  assert.equal((await call('GET', `/users/${ids.ben}`, { cookie: session.ana })).status, 403);
  assert.equal((await call('PATCH', `/users/${ids.ben}/status`, { cookie: session.prof, body: { status: 'disabled' } })).status, 403);
});

test('admin disables an account: the user is signed out at once, then re-enabled', async () => {
  const off = await call('PATCH', `/users/${ids.ben}/status`, { cookie: session.admin, body: { status: 'disabled' } });
  assert.equal(off.status, 200);
  assert.equal(off.body.user.status, 'disabled');
  assert.equal((await call('GET', '/vehicles/mine', { cookie: session.ben })).status, 401);

  const disabled = await call('GET', '/users?status=disabled', { cookie: session.admin });
  assert.deepEqual(disabled.body.users.map((u) => u.id), [ids.ben]);

  const on = await call('PATCH', `/users/${ids.ben}/status`, { cookie: session.admin, body: { status: 'active' } });
  assert.equal(on.body.user.status, 'active');
});

test('admins cannot change their own status or another admin\'s', async () => {
  const self = await call('PATCH', `/users/${ids.admin}/status`, { cookie: session.admin, body: { status: 'disabled' } });
  assert.equal(self.status, 400);
  assert.equal((await call('PATCH', `/users/${ids.ana}/status`, { cookie: session.admin, body: { status: 'banned' } })).status, 400);
});
