// Run with: npm test
// Checks that the database itself refuses bad data: every foreign key (relationship), UNIQUE
// and CHECK rule in src/db/schema.sql. Each test tries to break one rule and expects the exact
// Postgres error code (23503 foreign key, 23505 unique, 23514 check, 23502 not null).
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

const { pool } = await import('../src/db/index.js');

const FK = '23503';
const UNIQUE = '23505';
const CHECK = '23514';
const NOT_NULL = '23502';

// Runs a query that must fail, and checks the error code (and the rule's name when given).
const refuses = (code, sql, params = [], constraint) => assert.rejects(
  pool.query(sql, params),
  (err) => err.code === code && (constraint === undefined || err.constraint === constraint),
);

const ids = {};
let n = 0;

async function newUser(role = 'student', overrides = {}) {
  n += 1;
  const { rows } = await pool.query(
    `INSERT INTO users (role, first_name, last_name, email, school_id, password_hash, contact_number)
     VALUES ($1, 'Test', 'User', $2, $3, 'not-a-real-hash', $4) RETURNING id`,
    [role, overrides.email ?? `user${n}@adnu.edu.ph`, overrides.schoolId ?? `U-${n}`, overrides.contactNumber ?? null],
  );
  if (role === 'admin') await pool.query('INSERT INTO admin_accounts (user_id) VALUES ($1)', [rows[0].id]);
  return rows[0].id;
}

async function newVehicle(ownerId, plate) {
  const { rows } = await pool.query(
    "INSERT INTO vehicles (owner_id, plate_number, type) VALUES ($1, $2, 'car') RETURNING id",
    [ownerId, plate],
  );
  return rows[0].id;
}

const newArea = (name, capacity = 10) => pool.query(
  'INSERT INTO parking_areas (name, latitude, longitude, capacity) VALUES ($1, 13.62, 123.18, $2) RETURNING id',
  [name, capacity],
).then((r) => r.rows[0].id);

const newApplication = (vehicleId, applicantId) => pool.query(
  'INSERT INTO campus_stickers (vehicle_id, applicant_id) VALUES ($1, $2) RETURNING id',
  [vehicleId, applicantId],
).then((r) => r.rows[0].id);

before(async () => {
  await pool.query(await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
  await pool.query('TRUNCATE sticker_application_history, sticker_number_counters, parking_records, campus_stickers, parking_areas, vehicles, admin_accounts, users CASCADE');
  ids.admin = await newUser('admin');
  ids.ana = await newUser('student');
  ids.ben = await newUser('student');
  ids.prof = await newUser('faculty');
  ids.anaCar = await newVehicle(ids.ana, 'REL 111');
  ids.benCar = await newVehicle(ids.ben, 'REL 222');
  ids.lot = await newArea('Test Lot');
});

after(async () => {
  await pool.end();
});

// ------------------------------------------------------------------ users
test('users: email must be unique, lowercase and look like an email', async () => {
  await newUser('student', { email: 'taken@adnu.edu.ph' });
  await refuses(UNIQUE, "INSERT INTO users (role, first_name, last_name, email, school_id, password_hash) VALUES ('student','A','B','taken@adnu.edu.ph','U-X1','h')");
  await refuses(CHECK, "INSERT INTO users (role, first_name, last_name, email, school_id, password_hash) VALUES ('student','A','B','Upper@adnu.edu.ph','U-X2','h')", [], 'users_email_lowercase');
  await refuses(CHECK, "INSERT INTO users (role, first_name, last_name, email, school_id, password_hash) VALUES ('student','A','B','not-an-email','U-X3','h')", [], 'users_email_format');
});

test('users: school ID must be unique and uppercase', async () => {
  await newUser('student', { schoolId: '2024-0001' });
  await refuses(UNIQUE, "INSERT INTO users (role, first_name, last_name, email, school_id, password_hash) VALUES ('student','A','B','a1@adnu.edu.ph','2024-0001','h')");
  await refuses(CHECK, "INSERT INTO users (role, first_name, last_name, email, school_id, password_hash) VALUES ('student','A','B','a2@adnu.edu.ph','f-0001','h')", [], 'users_school_id_uppercase');
});

test('users: role and status only accept the allowed values; names can\'t be blank', async () => {
  await refuses(CHECK, "INSERT INTO users (role, first_name, last_name, email, school_id, password_hash) VALUES ('guard','A','B','r1@adnu.edu.ph','U-R1','h')");
  await refuses(CHECK, "INSERT INTO users (role, status, first_name, last_name, email, school_id, password_hash) VALUES ('student','banned','A','B','r2@adnu.edu.ph','U-R2','h')");
  await refuses(CHECK, "INSERT INTO users (role, first_name, last_name, email, school_id, password_hash) VALUES ('student','  ','B','r3@adnu.edu.ph','U-R3','h')");
  await refuses(NOT_NULL, "INSERT INTO users (role, first_name, last_name, email, school_id) VALUES ('student','A','B','r4@adnu.edu.ph','U-R4')");
});

test('users: contactNumber must be +639XXXXXXXXX, or empty', async () => {
  await newUser('student', { contactNumber: '+639171234567' });
  const bad = ['09171234567', '+63917123456', '+639abcdefghi', '+638171234567'];
  for (const [i, number] of bad.entries()) {
    await refuses(CHECK,
      "INSERT INTO users (role, first_name, last_name, email, school_id, password_hash, contact_number) VALUES ('student','A','B',$1,$2,'h',$3)",
      [`bad.number${i}@adnu.edu.ph`, `U-BAD${i}`, number], 'users_contact_number_check');
  }
  // Too long for the column (13 characters): refused with a "value too long" error (22001).
  await refuses('22001',
    "INSERT INTO users (role, first_name, last_name, email, school_id, password_hash, contact_number) VALUES ('student','A','B','long.number@adnu.edu.ph','U-LONG','h','+6391712345678')");
});

// --------------------------------------------------------- admin_accounts
test('admin_accounts: only a user whose role is admin can have a row', async () => {
  await refuses(FK, 'INSERT INTO admin_accounts (user_id) VALUES ($1)', [ids.ana]);
  await refuses(FK, 'INSERT INTO admin_accounts (user_id) VALUES (gen_random_uuid())');
});

test('admin_accounts: an admin\'s role can\'t be changed while the admin row exists', async () => {
  await refuses(FK, "UPDATE users SET role = 'student' WHERE id = $1", [ids.admin]);
});

// --------------------------------------------------------------- vehicles
test('vehicles (users to vehicles): an owner must exist', async () => {
  await refuses(FK, "INSERT INTO vehicles (owner_id, plate_number, type) VALUES (gen_random_uuid(), 'OWN 111', 'car')");
  await refuses(NOT_NULL, "INSERT INTO vehicles (plate_number, type) VALUES ('OWN 222', 'car')");
});

test('vehicles: plate is unique, uppercase and well-formed; type is from the list', async () => {
  await refuses(UNIQUE, "INSERT INTO vehicles (owner_id, plate_number, type) VALUES ($1, 'REL 111', 'car')", [ids.ben]);
  await refuses(CHECK, "INSERT INTO vehicles (owner_id, plate_number, type) VALUES ($1, 'abc 123', 'car')", [ids.ben]); // lowercase
  await refuses(CHECK, "INSERT INTO vehicles (owner_id, plate_number, type) VALUES ($1, 'AB', 'car')", [ids.ben], 'vehicles_plate_format');
  await refuses(CHECK, "INSERT INTO vehicles (owner_id, plate_number, type) VALUES ($1, 'ZZZ 999', 'helicopter')", [ids.ben]);
});

test('vehicles: a user who owns vehicles can\'t be deleted', async () => {
  await refuses(FK, 'DELETE FROM users WHERE id = $1', [ids.ana]);
});

// -------------------------------------------------------- campus_stickers
test('stickers (vehicles to stickers): the applicant must own the vehicle', async () => {
  await refuses(FK, 'INSERT INTO campus_stickers (vehicle_id, applicant_id) VALUES ($1, $2)', [ids.anaCar, ids.ben], 'stickers_vehicle_owner_fk');
  await refuses(FK, 'INSERT INTO campus_stickers (vehicle_id, applicant_id) VALUES (gen_random_uuid(), $1)', [ids.ben]);
});

test('stickers: only one pending or approved application per vehicle; a rejected one frees it', async () => {
  const car = await newVehicle(ids.ana, 'STK 111');
  const first = await newApplication(car, ids.ana);
  await refuses(UNIQUE, 'INSERT INTO campus_stickers (vehicle_id, applicant_id) VALUES ($1, $2)', [car, ids.ana], 'uq_stickers_one_open_per_vehicle');
  await pool.query("UPDATE campus_stickers SET status = 'rejected', rejection_reason = 'No', reviewed_by = $2, reviewed_at = now() WHERE id = $1", [first, ids.admin]);
  assert.ok(await newApplication(car, ids.ana)); // allowed again
});

test('stickers (approvals to admin accounts): reviewer must be an admin account', async () => {
  const car = await newVehicle(ids.ana, 'STK 222');
  const id = await newApplication(car, ids.ana);
  const approveAs = (reviewer) => pool.query(
    `UPDATE campus_stickers SET status = 'approved', sticker_number = 'REV-0001', expires_at = now() + interval '1 year',
            reviewed_by = $2, reviewed_at = now() WHERE id = $1`,
    [id, reviewer],
  );
  await assert.rejects(approveAs(ids.ben), (e) => e.code === FK); // a student
  await assert.rejects(approveAs(ids.prof), (e) => e.code === FK); // faculty
  await approveAs(ids.admin); // an admin works
});

test('stickers: reviewer fields must match the status', async () => {
  const car = await newVehicle(ids.ana, 'STK 333');
  const id = await newApplication(car, ids.ana);
  // pending with a reviewer
  await refuses(CHECK, 'UPDATE campus_stickers SET reviewed_by = $2, reviewed_at = now() WHERE id = $1', [id, ids.admin], 'stickers_review_matches_status');
  // approved without a reviewer
  await refuses(CHECK, "UPDATE campus_stickers SET status = 'approved', sticker_number = 'REV-0002', expires_at = now() + interval '1 day' WHERE id = $1", [id], 'stickers_review_matches_status');
});

test('stickers: approved needs a number and an expiry; rejected needs a reason', async () => {
  const car = await newVehicle(ids.ana, 'STK 444');
  const id = await newApplication(car, ids.ana);
  const review = "reviewed_by = '" + ids.admin + "', reviewed_at = now()";
  // The automatic numbering fills a missing number, so approve with an expiry missing instead.
  await refuses(CHECK, `UPDATE campus_stickers SET status = 'approved', sticker_number = 'REV-0003', ${review} WHERE id = $1`, [id], 'stickers_approved_complete');
  await refuses(CHECK, `UPDATE campus_stickers SET status = 'rejected', ${review} WHERE id = $1`, [id], 'stickers_rejected_has_reason');
  await refuses(CHECK, `UPDATE campus_stickers SET status = 'rejected', rejection_reason = '   ', ${review} WHERE id = $1`, [id], 'stickers_rejected_has_reason');
});

test('stickers: status must be one of the four values; the expiry must be after creation', async () => {
  const car = await newVehicle(ids.ana, 'STK 555');
  const id = await newApplication(car, ids.ana);
  await refuses(CHECK, "UPDATE campus_stickers SET status = 'lost' WHERE id = $1", [id]);
  await refuses(CHECK, "UPDATE campus_stickers SET expires_at = created_at - interval '1 day' WHERE id = $1", [id], 'stickers_expiry_after_creation');
});

test('stickers: a sticker number can\'t be used twice or be blank', async () => {
  const one = await newApplication(await newVehicle(ids.ana, 'STK 666'), ids.ana);
  const two = await newApplication(await newVehicle(ids.ben, 'STK 777'), ids.ben);
  const approve = (id, number) => pool.query(
    `UPDATE campus_stickers SET status = 'approved', sticker_number = $2, expires_at = now() + interval '1 year',
            reviewed_by = $3, reviewed_at = now() WHERE id = $1`,
    [id, number, ids.admin],
  );
  await approve(one, 'DUP-0001');
  await assert.rejects(approve(two, 'DUP-0001'), (e) => e.code === UNIQUE);
  await assert.rejects(approve(two, '   '), (e) => e.code === CHECK);
});

test('stickers: a vehicle with sticker applications can\'t be deleted', async () => {
  const car = await newVehicle(ids.ana, 'STK 888');
  await newApplication(car, ids.ana);
  await refuses(FK, 'DELETE FROM vehicles WHERE id = $1', [car]);
});

// ---------------------------------------------------------- parking_areas
test('parking_areas: name is unique ignoring case; capacity and coordinates are validated', async () => {
  await newArea('Unique Lot');
  await refuses(UNIQUE, "INSERT INTO parking_areas (name, latitude, longitude, capacity) VALUES ('unique lot', 1, 1, 5)");
  await refuses(CHECK, "INSERT INTO parking_areas (name, latitude, longitude, capacity) VALUES ('Zero Lot', 1, 1, 0)");
  await refuses(CHECK, "INSERT INTO parking_areas (name, latitude, longitude, capacity) VALUES ('Far Lot', 91, 1, 5)");
  await refuses(CHECK, "INSERT INTO parking_areas (name, latitude, longitude, capacity) VALUES ('Wide Lot', 1, 181, 5)");
  await refuses(CHECK, "INSERT INTO parking_areas (name, latitude, longitude, capacity) VALUES ('   ', 1, 1, 5)");
});

// -------------------------------------------------------- parking_records
test('parking_records (to users, vehicles, areas): all three must exist and match', async () => {
  const insert = (userId, vehicleId, areaId) => pool.query(
    'INSERT INTO parking_records (user_id, vehicle_id, parking_area_id) VALUES ($1, $2, $3)',
    [userId, vehicleId, areaId],
  );
  await assert.rejects(insert(ids.ben, ids.anaCar, ids.lot), (e) => e.code === FK); // user doesn't own the vehicle
  await assert.rejects(insert(ids.ana, ids.anaCar, '00000000-0000-0000-0000-000000000000'), (e) => e.code === FK); // no such area
  await assert.rejects(insert(ids.ana, '00000000-0000-0000-0000-000000000000', ids.lot), (e) => e.code === FK); // no such vehicle
  await insert(ids.ana, ids.anaCar, ids.lot); // the correct combination works
  await pool.query('UPDATE parking_records SET exited_at = now() WHERE vehicle_id = $1', [ids.anaCar]);
});

test('parking_records: a vehicle can only be parked in one place at a time', async () => {
  const car = await newVehicle(ids.ana, 'PRK 111');
  await pool.query('INSERT INTO parking_records (user_id, vehicle_id, parking_area_id) VALUES ($1, $2, $3)', [ids.ana, car, ids.lot]);
  await refuses(UNIQUE, 'INSERT INTO parking_records (user_id, vehicle_id, parking_area_id) VALUES ($1, $2, $3)', [ids.ana, car, ids.lot], 'uq_records_one_open_per_vehicle');
  await pool.query('UPDATE parking_records SET exited_at = now() WHERE vehicle_id = $1', [car]);
  await pool.query('INSERT INTO parking_records (user_id, vehicle_id, parking_area_id) VALUES ($1, $2, $3)', [ids.ana, car, ids.lot]); // after leaving, fine
});

test('parking_records: the exit can\'t be before the entry', async () => {
  const car = await newVehicle(ids.ana, 'PRK 222');
  await refuses(CHECK,
    "INSERT INTO parking_records (user_id, vehicle_id, parking_area_id, entered_at, exited_at) VALUES ($1, $2, $3, now(), now() - interval '1 hour')",
    [ids.ana, car, ids.lot], 'records_exit_after_entry');
});

test('parking_records: a sticker on the record must belong to that same vehicle', async () => {
  const car = await newVehicle(ids.ana, 'PRK 333');
  const other = await newVehicle(ids.ana, 'PRK 444');
  const sticker = await newApplication(other, ids.ana); // belongs to "other", not "car"
  await refuses(FK, 'INSERT INTO parking_records (user_id, vehicle_id, parking_area_id, sticker_id) VALUES ($1, $2, $3, $4)',
    [ids.ana, car, ids.lot, sticker], 'records_sticker_vehicle_fk');
  await pool.query('INSERT INTO parking_records (user_id, vehicle_id, parking_area_id, sticker_id) VALUES ($1, $2, $3, $4)',
    [ids.ana, other, ids.lot, sticker]); // the right vehicle works
  await pool.query('UPDATE parking_records SET exited_at = now() WHERE vehicle_id = $1', [other]);
});

test('parking_records: areas and vehicles with parking history can\'t be deleted', async () => {
  const area = await newArea('History Lot');
  const car = await newVehicle(ids.ana, 'PRK 555');
  await pool.query('INSERT INTO parking_records (user_id, vehicle_id, parking_area_id) VALUES ($1, $2, $3)', [ids.ana, car, area]);
  await refuses(FK, 'DELETE FROM parking_areas WHERE id = $1', [area]);
  await refuses(FK, 'DELETE FROM vehicles WHERE id = $1', [car]);
});

// --------------------------------------------------------------- bookkeeping
test('updated_at changes automatically when a row is updated', async () => {
  const before = (await pool.query('SELECT updated_at FROM vehicles WHERE id = $1', [ids.benCar])).rows[0].updated_at;
  await pool.query("UPDATE vehicles SET color = 'Green' WHERE id = $1", [ids.benCar]);
  const after = (await pool.query('SELECT updated_at FROM vehicles WHERE id = $1', [ids.benCar])).rows[0].updated_at;
  assert.ok(after > before);
});
