// Run with: npm test
// Parking APIs (areas, entry/exit, records, current vehicles, history), called over HTTP.
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
const car = {}; // plate -> vehicle id
const area = {}; // label -> area id

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
async function signUp(key, { role, firstName, email, schoolId }) {
  const reg = await call('POST', '/auth/register', {
    body: { role, firstName, lastName: 'Test', email, schoolId, password: PASSWORD, confirmPassword: PASSWORD },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  ids[key] = reg.body.user.id;
  session[key] = (await call('POST', '/auth/login', { body: { email, password: PASSWORD } })).cookie;
}

async function addCar(owner, plateNumber) {
  const res = await call('POST', '/vehicles', { cookie: session[owner], body: { plateNumber, type: 'car' } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  car[plateNumber] = res.body.vehicle.id;
}

// Gives a vehicle an approved sticker directly in the database (the sticker APIs are tested elsewhere).
let stickerCount = 0;
async function giveSticker(plate, { expired = false } = {}) {
  stickerCount += 1;
  const { rows: [v] } = await pool.query('SELECT owner_id FROM vehicles WHERE id = $1', [car[plate]]);
  const created = expired ? "now() - interval '400 days'" : 'now()';
  const expires = expired ? "now() - interval '1 day'" : "now() + interval '1 year'";
  await pool.query(
    `INSERT INTO campus_stickers (vehicle_id, applicant_id, status, sticker_number, expires_at,
                                  reviewed_by, reviewed_at, created_at)
     VALUES ($1, $2, 'approved', $3, ${expires}, $4, now(), ${created})`,
    [car[plate], v.owner_id, `TEST-${stickerCount}`, ids.admin],
  );
}

async function addArea(label, name, capacity) {
  const res = await call('POST', '/parking/areas', {
    cookie: session.admin, body: { name, latitude: 13.6295, longitude: 123.1945, capacity },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  area[label] = res.body.area.id;
  return res.body.area;
}

const enter = (plateOrId, areaLabel, cookie = session.admin) => call('POST', '/parking/entry', {
  cookie,
  body: {
    ...(plateOrId.includes('-') && plateOrId.length === 36 ? { vehicleId: plateOrId } : { plateNumber: plateOrId }),
    parkingAreaId: area[areaLabel],
  },
});
const leave = (plateNumber) => call('POST', '/parking/exit', { cookie: session.admin, body: { plateNumber } });

before(async () => {
  await pool.query(await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
  await pool.query('TRUNCATE parking_records, campus_stickers, parking_areas, vehicles, admin_accounts, users CASCADE');
  await seed();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;

  await signUp('ana', { role: 'student', firstName: 'Ana', email: 'ana@gbox.adnu.edu.ph', schoolId: '2023-10001' });
  await signUp('ben', { role: 'faculty', firstName: 'Ben', email: 'ben@adnu.edu.ph', schoolId: 'EMP-1001' });
  const admin = await call('POST', '/auth/admin/login', { body: { email: 'admin@adnu.edu.ph', password: 'Admin-Password-123!' } });
  session.admin = admin.cookie;
  ids.admin = admin.body.user.id;

  for (const plate of ['ANA 001', 'ANA 002', 'ANA 003', 'ANA 004', 'ANA 005']) await addCar('ana', plate);
  for (const plate of ['BEN 001', 'BEN 002', 'BEN 003']) await addCar('ben', plate);
  for (const plate of ['ANA 001', 'ANA 003', 'ANA 004', 'ANA 005', 'BEN 001', 'BEN 002']) await giveSticker(plate);
  await giveSticker('BEN 003', { expired: true });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// ─── Access control ─────────────────────────────────────────────────────────────

const ROUTES = [
  ['GET', '/parking/areas'], ['GET', '/parking/areas/00000000-0000-4000-8000-000000000000'],
  ['POST', '/parking/areas'], ['PATCH', '/parking/areas/00000000-0000-4000-8000-000000000000'],
  ['PATCH', '/parking/areas/00000000-0000-4000-8000-000000000000/deactivate'],
  ['PATCH', '/parking/areas/00000000-0000-4000-8000-000000000000/activate'],
  ['POST', '/parking/entry'], ['POST', '/parking/exit'],
  ['GET', '/parking/records'], ['GET', '/parking/records/00000000-0000-4000-8000-000000000000'],
  ['GET', '/parking/current'], ['GET', '/parking/history/me'],
  ['GET', '/parking/history/user/00000000-0000-4000-8000-000000000000'],
  ['GET', '/parking/history/vehicle/00000000-0000-4000-8000-000000000000'],
];

test('every parking route needs a signed-in user', async () => {
  for (const [method, path] of ROUTES) {
    const res = await call(method, path, { body: method === 'GET' ? undefined : {} });
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

test('students and faculty cannot use the admin-only parking routes', async () => {
  const adminOnly = ROUTES.filter(([m, p]) => m !== 'GET' || ['/parking/records', '/parking/current'].includes(p));
  for (const who of ['ana', 'ben']) {
    for (const [method, path] of adminOnly) {
      const res = await call(method, path, { cookie: session[who], body: method === 'GET' ? undefined : {} });
      assert.equal(res.status, 403, `${who} ${method} ${path}`);
    }
  }
});

// ─── Areas ──────────────────────────────────────────────────────────────────────

test('admin creates parking areas; names are unique ignoring case; input is validated', async () => {
  const main = await addArea('main', '  Main   Gate Lot ', 2);
  assert.equal(main.name, 'Main Gate Lot');
  assert.equal(main.latitude, 13.6295);
  assert.equal(main.occupied, 0);
  assert.equal(main.available, 2);
  assert.equal(main.isActive, true);
  await addArea('small', 'Library Lot', 1);
  await addArea('race', 'Race Lot', 2);

  const dup = await call('POST', '/parking/areas', {
    cookie: session.admin, body: { name: 'main gate lot', latitude: 1, longitude: 1, capacity: 5 },
  });
  assert.equal(dup.status, 409);

  for (const body of [
    { name: 'X', latitude: 91, longitude: 1, capacity: 5 },
    { name: 'X', latitude: 1, longitude: -181, capacity: 5 },
    { name: 'X', latitude: 1, longitude: 1, capacity: 0 },
    { name: 'X', latitude: 1, longitude: 1, capacity: 2.5 },
    { name: 'X', latitude: '1', longitude: 1, capacity: 5 },
    { name: '<script>', latitude: 1, longitude: 1, capacity: 5 },
    { name: '', latitude: 1, longitude: 1, capacity: 5 },
  ]) {
    const res = await call('POST', '/parking/areas', { cookie: session.admin, body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('students see active areas only; admins can list inactive ones', async () => {
  const closed = await addArea('closed', 'Old Lot', 10);
  const off = await call('PATCH', `/parking/areas/${closed.id}/deactivate`, { cookie: session.admin });
  assert.equal(off.status, 200);
  assert.equal(off.body.area.isActive, false);

  const mine = await call('GET', '/parking/areas?isActive=false', { cookie: session.ana });
  assert.equal(mine.status, 200);
  assert.ok(mine.body.areas.every((a) => a.isActive));
  assert.ok(!mine.body.areas.some((a) => a.id === closed.id));
  assert.equal((await call('GET', `/parking/areas/${closed.id}`, { cookie: session.ana })).status, 404);

  const all = await call('GET', '/parking/areas?isActive=false', { cookie: session.admin });
  assert.deepEqual(all.body.areas.map((a) => a.id), [closed.id]);
  assert.equal((await call('GET', `/parking/areas/${closed.id}`, { cookie: session.admin })).status, 200);
});

// ─── Entry and exit ─────────────────────────────────────────────────────────────

test('entry needs exactly one of vehicleId or plateNumber, and a parking area', async () => {
  for (const body of [
    { parkingAreaId: area.main },
    { plateNumber: 'ANA 001', vehicleId: car['ANA 001'], parkingAreaId: area.main },
    { plateNumber: 'ANA 001' },
    { plateNumber: 'ANA 001', parkingAreaId: 'not-a-uuid' },
  ]) {
    const res = await call('POST', '/parking/entry', { cookie: session.admin, body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('a vehicle without a valid sticker is refused (strict rule)', async () => {
  assert.equal((await enter('ANA 002', 'main')).status, 403); // never had one
  assert.equal((await enter('BEN 003', 'main')).status, 403); // expired
  assert.equal((await enter('ZZZ 999', 'main')).status, 404); // not registered
});

test('a vehicle with a valid sticker enters, by plate (any spacing/case) or by ID', async () => {
  const res = await enter('ana  001', 'main');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const r = res.body.record;
  assert.equal(r.status, 'parked');
  assert.equal(r.exitedAt, null);
  assert.equal(r.vehicle.plateNumber, 'ANA 001');
  assert.equal(r.owner.id, ids.ana);
  assert.equal(r.parkingArea.id, area.main);
  assert.match(r.sticker.stickerNumber, /^TEST-/);
  assert.equal(r.owner.email, undefined, 'owner email must not be exposed');
  ids.anaRecord = r.id;

  assert.equal((await enter(car['BEN 001'], 'main')).status, 201);
});

test('a parked vehicle cannot enter again; a full or closed area refuses entry', async () => {
  assert.equal((await enter('ANA 001', 'small')).status, 409); // already parked
  assert.equal((await enter('ANA 003', 'main')).status, 409); // main (capacity 2) is full
  assert.equal((await enter('ANA 003', 'closed')).status, 409); // deactivated area

  const area404 = await call('POST', '/parking/entry', {
    cookie: session.admin, body: { plateNumber: 'ANA 003', parkingAreaId: '00000000-0000-4000-8000-000000000000' },
  });
  assert.equal(area404.status, 404);
});

test('capacity is never exceeded, even when many cars enter at the same moment', async () => {
  const results = await Promise.all(['ANA 003', 'ANA 004', 'ANA 005', 'BEN 002'].map((p) => enter(p, 'race')));
  const codes = results.map((r) => r.status).sort();
  assert.deepEqual(codes, [201, 201, 409, 409]);
  const lot = await call('GET', `/parking/areas/${area.race}`, { cookie: session.admin });
  assert.equal(lot.body.area.occupied, 2);
  assert.equal(lot.body.area.available, 0);
});

test('an area with parked vehicles cannot shrink below occupancy or be deactivated', async () => {
  const shrink = await call('PATCH', `/parking/areas/${area.main}`, { cookie: session.admin, body: { capacity: 1 } });
  assert.equal(shrink.status, 409);
  const off = await call('PATCH', `/parking/areas/${area.main}/deactivate`, { cookie: session.admin });
  assert.equal(off.status, 409);

  const grow = await call('PATCH', `/parking/areas/${area.main}`, { cookie: session.admin, body: { capacity: 3, name: 'Main Gate' } });
  assert.equal(grow.status, 200);
  assert.equal(grow.body.area.capacity, 3);
  assert.equal(grow.body.area.name, 'Main Gate');
  assert.equal((await call('PATCH', `/parking/areas/${area.main}`, { cookie: session.admin, body: {} })).status, 400);
  const taken = await call('PATCH', `/parking/areas/${area.main}`, { cookie: session.admin, body: { name: 'LIBRARY LOT' } });
  assert.equal(taken.status, 409);
});

test('current parked vehicles lists only vehicles still inside', async () => {
  const res = await call('GET', '/parking/current', { cookie: session.admin });
  assert.equal(res.status, 200);
  assert.equal(res.body.pagination.total, 4);
  assert.ok(res.body.records.every((r) => r.status === 'parked'));

  const inMain = await call('GET', `/parking/current?parkingAreaId=${area.main}&q=ana`, { cookie: session.admin });
  assert.deepEqual(inMain.body.records.map((r) => r.vehicle.plateNumber), ['ANA 001']);
});

test('exit closes the open record; a second exit is refused', async () => {
  const res = await leave('ANA 001');
  assert.equal(res.status, 200);
  assert.equal(res.body.record.id, ids.anaRecord);
  assert.equal(res.body.record.status, 'exited');
  assert.ok(res.body.record.exitedAt);
  assert.equal((await leave('ANA 001')).status, 409);
  assert.equal((await leave('ANA 002')).status, 409); // never entered

  // It can park again after leaving.
  assert.equal((await enter('ANA 001', 'small')).status, 201);
  assert.equal((await leave('ANA 001')).status, 200);
});

test('an emptied area can be deactivated and reactivated', async () => {
  for (const plate of ['BEN 001']) assert.equal((await leave(plate)).status, 200);
  assert.equal((await call('PATCH', `/parking/areas/${area.main}/deactivate`, { cookie: session.admin })).status, 200);
  const on = await call('PATCH', `/parking/areas/${area.main}/activate`, { cookie: session.admin });
  assert.equal(on.status, 200);
  assert.equal(on.body.area.isActive, true);
});

// ─── Records and history ────────────────────────────────────────────────────────

test('admin record list filters by status, vehicle, user, area, date and search', async () => {
  const all = await call('GET', '/parking/records?limit=100', { cookie: session.admin });
  assert.equal(all.status, 200);
  assert.equal(all.body.pagination.total, 5);

  const exited = await call('GET', '/parking/records?status=exited', { cookie: session.admin });
  assert.ok(exited.body.records.length > 0 && exited.body.records.every((r) => r.status === 'exited'));

  const byCar = await call('GET', `/parking/records?vehicleId=${car['ANA 001']}`, { cookie: session.admin });
  assert.equal(byCar.body.pagination.total, 2);

  const byUser = await call('GET', `/parking/records?userId=${ids.ben}`, { cookie: session.admin });
  assert.ok(byUser.body.records.every((r) => r.owner.id === ids.ben));

  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // campus date
  const dated = await call('GET', `/parking/records?from=${today}&to=${today}`, { cookie: session.admin });
  assert.equal(dated.body.pagination.total, 5);
  const past = await call('GET', '/parking/records?from=2020-01-01&to=2020-01-31', { cookie: session.admin });
  assert.equal(past.body.pagination.total, 0);

  const sorted = await call('GET', '/parking/records?sort=plateNumber&order=asc', { cookie: session.admin });
  const plates = sorted.body.records.map((r) => r.vehicle.plateNumber);
  assert.deepEqual(plates, [...plates].sort());

  for (const bad of ['sort=password_hash', 'status=gone', 'from=2026-13-01', 'limit=1000', "q=';DROP TABLE users;--"]) {
    assert.equal((await call('GET', `/parking/records?${bad}`, { cookie: session.admin })).status, 400, bad);
  }
});

test('students only see their own records and history', async () => {
  const own = await call('GET', `/parking/records/${ids.anaRecord}`, { cookie: session.ana });
  assert.equal(own.status, 200);
  assert.equal((await call('GET', `/parking/records/${ids.anaRecord}`, { cookie: session.ben })).status, 404);

  const me = await call('GET', '/parking/history/me', { cookie: session.ana });
  assert.equal(me.status, 200);
  assert.ok(me.body.records.length > 0 && me.body.records.every((r) => r.owner.id === ids.ana));

  assert.equal((await call('GET', `/parking/history/vehicle/${car['ANA 001']}`, { cookie: session.ana })).status, 200);
  assert.equal((await call('GET', `/parking/history/vehicle/${car['ANA 001']}`, { cookie: session.ben })).status, 404);
  assert.equal((await call('GET', `/parking/history/user/${ids.ana}`, { cookie: session.ana })).status, 200);
  assert.equal((await call('GET', `/parking/history/user/${ids.ana}`, { cookie: session.ben })).status, 404);

  const adminView = await call('GET', `/parking/history/user/${ids.ana}?status=exited`, { cookie: session.admin });
  assert.equal(adminView.status, 200);
  assert.ok(adminView.body.records.every((r) => r.owner.id === ids.ana && r.status === 'exited'));
  assert.equal((await call('GET', '/parking/history/user/00000000-0000-4000-8000-000000000000', { cookie: session.admin })).status, 404);
});

test('the admin dashboard parking counts match the parking APIs', async () => {
  const dash = await call('GET', '/admin/dashboard', { cookie: session.admin });
  const current = await call('GET', '/parking/current', { cookie: session.admin });
  assert.equal(dash.body.stats.parking.currentlyParked, current.body.pagination.total);
});
