// Run with: npm test
// Database-level tests for the sticker lifecycle in src/db/schema.sql:
//   1. expiry (an approved sticker past expires_at stops blocking a new application)
//   2. approval history (insert-only audit trail)
//   3. automatic sticker numbers (unique, even when many approvals happen at once)
//
// They ERASE every table first, so they only run against the separate TEST_DATABASE_URL.
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

const { pool } = await import('../db/index.js');

const ids = {};
let counter = 0;

async function addUser(role, label) {
  counter += 1;
  const { rows } = await pool.query(
    `INSERT INTO users (role, first_name, last_name, email, school_id, password_hash)
     VALUES ($1, $2, 'Test', $3, $4, 'not-a-real-hash') RETURNING id`,
    [role, label, `${label.toLowerCase()}${counter}@adnu.edu.ph`, `T-${counter}`],
  );
  if (role === 'admin') await pool.query('INSERT INTO admin_accounts (user_id) VALUES ($1)', [rows[0].id]);
  return rows[0].id;
}

async function addVehicle(ownerId, plate) {
  const { rows } = await pool.query(
    "INSERT INTO vehicles (owner_id, plate_number, type) VALUES ($1, $2, 'car') RETURNING id",
    [ownerId, plate],
  );
  return rows[0].id;
}

const apply = (vehicleId, ownerId) => pool.query(
  'INSERT INTO campus_stickers (vehicle_id, applicant_id) VALUES ($1, $2) RETURNING id',
  [vehicleId, ownerId],
).then((r) => r.rows[0].id);

// Approves with an explicit number (or NULL for automatic) and the given expiry SQL.
const approve = (id, { number = null, expires = "now() + interval '1 year'" } = {}) => pool.query(
  `UPDATE campus_stickers
      SET status = 'approved', sticker_number = $2, expires_at = ${expires},
          reviewed_by = $3, reviewed_at = now()
    WHERE id = $1 RETURNING sticker_number`,
  [id, number, ids.admin],
).then((r) => r.rows[0].sticker_number);

const history = (id) => pool.query(
  'SELECT from_status, to_status, changed_by, reason FROM sticker_application_history WHERE application_id = $1 ORDER BY changed_at, id',
  [id],
).then((r) => r.rows);

before(async () => {
  await pool.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  await pool.query('TRUNCATE sticker_application_history, sticker_number_counters, parking_records, campus_stickers, parking_areas, vehicles, admin_accounts, users CASCADE');
  ids.admin = await addUser('admin', 'Admin');
  ids.ana = await addUser('student', 'Ana');
});

after(async () => {
  await pool.end();
});

// ---------------------------------------------------------------- expiry
test('an approved sticker that has expired stops blocking a new application', async () => {
  const vehicle = await addVehicle(ids.ana, 'EXP 111');
  const first = await apply(vehicle, ids.ana);
  // Created long ago, approved with an expiry date that has already passed.
  await pool.query("UPDATE campus_stickers SET created_at = now() - interval '400 days' WHERE id = $1", [first]);
  await approve(first, { number: 'OLD-0001', expires: "now() - interval '1 day'" });

  // Still "approved" in the table, but the owner can reapply anyway.
  const second = await apply(vehicle, ids.ana);
  const { rows } = await pool.query('SELECT id, status FROM campus_stickers WHERE vehicle_id = $1', [vehicle]);
  assert.equal(rows.find((r) => r.id === first).status, 'expired');
  assert.equal(rows.find((r) => r.id === second).status, 'pending');
});

test('an approved sticker that is still valid keeps blocking a new application', async () => {
  const vehicle = await addVehicle(ids.ana, 'EXP 222');
  await approve(await apply(vehicle, ids.ana), { number: 'LIVE-0001' });
  await assert.rejects(apply(vehicle, ids.ana), (e) => e.code === '23505' && e.constraint === 'uq_stickers_one_open_per_vehicle');
});

test('expire_stickers() expires only approved stickers past their date, and is safe to repeat', async () => {
  const lapsed = await addVehicle(ids.ana, 'EXP 333');
  const valid = await addVehicle(ids.ana, 'EXP 444');
  const lapsedApp = await apply(lapsed, ids.ana);
  await pool.query("UPDATE campus_stickers SET created_at = now() - interval '400 days' WHERE id = $1", [lapsedApp]);
  await approve(lapsedApp, { number: 'OLD-0002', expires: "now() - interval '1 hour'" });
  const validApp = await apply(valid, ids.ana);
  await approve(validApp, { number: 'LIVE-0002' });

  const first = (await pool.query('SELECT expire_stickers() AS n')).rows[0].n;
  const again = (await pool.query('SELECT expire_stickers() AS n')).rows[0].n;
  assert.ok(first >= 1);
  assert.equal(again, 0);
  const status = async (id) => (await pool.query('SELECT status FROM campus_stickers WHERE id = $1', [id])).rows[0].status;
  assert.equal(await status(lapsedApp), 'expired');
  assert.equal(await status(validApp), 'approved');
});

// --------------------------------------------------------------- history
test('history records the submit, the approval and the expiry, in order', async () => {
  const vehicle = await addVehicle(ids.ana, 'HIS 111');
  const id = await apply(vehicle, ids.ana);
  await pool.query("UPDATE campus_stickers SET created_at = now() - interval '400 days' WHERE id = $1", [id]);
  await approve(id, { number: 'HIS-0001', expires: "now() - interval '1 day'" });
  await pool.query('SELECT expire_stickers()');

  const rows = await history(id);
  assert.deepEqual(rows.map((r) => [r.from_status, r.to_status]), [
    [null, 'pending'],
    ['pending', 'approved'],
    ['approved', 'expired'],
  ]);
  assert.equal(rows[0].changed_by, null); // the applicant, not an admin
  assert.equal(rows[1].changed_by, ids.admin); // who approved it
  assert.equal(rows[2].changed_by, null); // automatic
});

test('history keeps the rejection reason', async () => {
  const vehicle = await addVehicle(ids.ana, 'HIS 222');
  const id = await apply(vehicle, ids.ana);
  await pool.query(
    `UPDATE campus_stickers SET status = 'rejected', rejection_reason = 'Plate does not match',
            reviewed_by = $2, reviewed_at = now() WHERE id = $1`,
    [id, ids.admin],
  );
  const rows = await history(id);
  assert.equal(rows.at(-1).to_status, 'rejected');
  assert.equal(rows.at(-1).reason, 'Plate does not match');
  assert.equal(rows.at(-1).changed_by, ids.admin);
});

test('history is insert-only: updates and deletes are refused', async () => {
  const vehicle = await addVehicle(ids.ana, 'HIS 333');
  const id = await apply(vehicle, ids.ana);
  await assert.rejects(
    pool.query("UPDATE sticker_application_history SET reason = 'edited' WHERE application_id = $1", [id]),
    /insert-only/,
  );
  await assert.rejects(
    pool.query('DELETE FROM sticker_application_history WHERE application_id = $1', [id]),
    /insert-only/,
  );
});

test('history can\'t point at a missing application or a non-admin reviewer', async () => {
  await assert.rejects(
    pool.query("INSERT INTO sticker_application_history (application_id, to_status) VALUES (gen_random_uuid(), 'pending')"),
    (e) => e.code === '23503',
  );
  const vehicle = await addVehicle(ids.ana, 'HIS 444');
  const id = await apply(vehicle, ids.ana);
  await assert.rejects(
    pool.query("INSERT INTO sticker_application_history (application_id, to_status, changed_by) VALUES ($1, 'approved', $2)", [id, ids.ana]),
    (e) => e.code === '23503',
  );
});

// ------------------------------------------------------ automatic numbering
test('approving without a number assigns YYYY-0001, YYYY-0002... in order', async () => {
  await pool.query('TRUNCATE sticker_number_counters');
  const year = (await pool.query("SELECT extract(year FROM (now() AT TIME ZONE 'Asia/Manila'))::int AS y")).rows[0].y;
  const numbers = [];
  for (const plate of ['NUM 111', 'NUM 222', 'NUM 333']) {
    numbers.push(await approve(await apply(await addVehicle(ids.ana, plate), ids.ana)));
  }
  assert.deepEqual(numbers, [`${year}-0001`, `${year}-0002`, `${year}-0003`]);
});

test('a number typed by hand is kept, and the generator skips numbers already used', async () => {
  await pool.query('TRUNCATE sticker_number_counters');
  const year = (await pool.query("SELECT extract(year FROM (now() AT TIME ZONE 'Asia/Manila'))::int AS y")).rows[0].y;
  const byHand = `${year}-7001`;
  assert.equal(await approve(await apply(await addVehicle(ids.ana, 'HND 111'), ids.ana), { number: byHand }), byHand);

  // Make the counter land exactly on a number that is already taken: it must move on to the next.
  await pool.query('INSERT INTO sticker_number_counters (year, last_number) VALUES ($1, 7000) ON CONFLICT (year) DO UPDATE SET last_number = 7000', [year]);
  const generated = await approve(await apply(await addVehicle(ids.ana, 'HND 222'), ids.ana));
  assert.equal(generated, `${year}-7002`);
});

test('20 approvals at the same moment all get different numbers', async () => {
  await pool.query('TRUNCATE sticker_number_counters');
  const applications = [];
  for (let i = 0; i < 20; i += 1) {
    applications.push(await apply(await addVehicle(ids.ana, `PAR ${String(i).padStart(3, '0')}`), ids.ana));
  }
  const numbers = await Promise.all(applications.map((id) => approve(id)));
  assert.equal(new Set(numbers).size, 20);
  assert.ok(numbers.every((n) => /^\d{4}-\d{4}$/.test(n)));
});

test('next_sticker_number() starts a new count each year and never shortens big numbers', async () => {
  const a = (await pool.query('SELECT next_sticker_number(2031) AS n')).rows[0].n;
  const b = (await pool.query('SELECT next_sticker_number(2031) AS n')).rows[0].n;
  const c = (await pool.query('SELECT next_sticker_number(2032) AS n')).rows[0].n;
  assert.deepEqual([a, b, c], ['2031-0001', '2031-0002', '2032-0001']);
  await pool.query('UPDATE sticker_number_counters SET last_number = 9999 WHERE year = 2031');
  assert.equal((await pool.query('SELECT next_sticker_number(2031) AS n')).rows[0].n, '2031-10000');
});
