// Run with: npm test
// Loads the sample data (src/db/sample-data.js) into the empty test database and checks it:
// every row passed the database rules, the sample covers each sticker status, and loading it
// twice adds nothing. Erases every table first, so it only runs against TEST_DATABASE_URL.
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

const { pool } = await import('../src/db/index.js');
const { loadSampleData } = await import('../src/db/sample-data.js');

const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0];

before(async () => {
  await pool.query(await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
  await pool.query('TRUNCATE sticker_application_history, sticker_number_counters, parking_records, campus_stickers, parking_areas, vehicles, admin_accounts, users CASCADE');
});

after(async () => {
  await pool.end();
});

test('sample data loads and creates the expected records', async () => {
  const counts = await loadSampleData();
  assert.deepEqual(counts, { users: 6, vehicles: 6, stickers: 5, parking_areas: 3, parking_records: 7 });
});

test('the sample has students, faculty and an admin with an admin account', async () => {
  const roles = await pool.query('SELECT role, count(*)::int AS n FROM users GROUP BY role ORDER BY role');
  assert.deepEqual(roles.rows, [{ role: 'admin', n: 1 }, { role: 'faculty', n: 2 }, { role: 'student', n: 3 }]);
  assert.equal((await one('SELECT count(*)::int AS n FROM admin_accounts')).n, 1);
  assert.equal((await one("SELECT count(*)::int AS n FROM users WHERE contact_number ~ '^\\+639[0-9]{9}$'")).n, 6);
});

test('the sample covers every sticker status, and approved stickers got automatic numbers', async () => {
  const rows = (await pool.query('SELECT status, sticker_number FROM campus_stickers ORDER BY status')).rows;
  assert.deepEqual(rows.map((r) => r.status), ['approved', 'approved', 'expired', 'pending', 'rejected']);
  const numbered = rows.filter((r) => r.status !== 'pending' && r.status !== 'rejected');
  assert.ok(numbered.every((r) => /^\d{4}-\d{4}$/.test(r.sticker_number)));
});

test('the sample includes an inactive vehicle', async () => {
  assert.equal((await one('SELECT count(*)::int AS n FROM vehicles WHERE NOT is_active')).n, 1);
});

test('sample parking activity has finished visits and exactly one vehicle still parked', async () => {
  assert.equal((await one('SELECT count(*)::int AS n FROM parking_records WHERE exited_at IS NULL')).n, 1);
  assert.equal((await one('SELECT count(*)::int AS n FROM parking_records WHERE exited_at IS NOT NULL')).n, 6);
});

test('every sticker application has history rows', async () => {
  const missing = await one(`SELECT count(*)::int AS n FROM campus_stickers s
                              WHERE NOT EXISTS (SELECT 1 FROM sticker_application_history h WHERE h.application_id = s.id)`);
  assert.equal(missing.n, 0);
});

test('loading the sample data again adds nothing', async () => {
  const again = await loadSampleData();
  assert.deepEqual(again, { users: 6, vehicles: 6, stickers: 5, parking_areas: 3, parking_records: 7 });
});
