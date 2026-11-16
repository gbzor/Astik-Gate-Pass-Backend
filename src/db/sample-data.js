// SAMPLE DATA for development and demos:  npm run db:sample
//
// Adds fake students, faculty, vehicles, sticker applications and parking activity so the
// API and the admin screens have something to show. Safe to run again: anything that already
// exists is skipped, nothing is deleted. It refuses to run when NODE_ENV=production.
//
// Every sample account uses the password below. These are fake accounts: never use this on a
// database that holds real people.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { BCRYPT_COST } from '../config/constants.js';
import { pool, users, vehicles } from './index.js';

export const SAMPLE_PASSWORD = 'Sample-Pass-123!';

const PEOPLE = [
  { key: 'admin', role: 'admin', firstName: 'Sample', lastName: 'Admin', email: 'sample.admin@adnu.edu.ph', schoolId: 'ADMIN-SAMPLE', contactNumber: '+639170000000' },
  { key: 'ana', role: 'student', firstName: 'Ana', lastName: 'Reyes', email: 'ana.reyes@gbox.adnu.edu.ph', schoolId: '2023-10001', contactNumber: '+639170000001' },
  { key: 'ben', role: 'student', firstName: 'Ben', lastName: 'Cruz', email: 'ben.cruz@gbox.adnu.edu.ph', schoolId: '2023-10002', contactNumber: '+639170000002' },
  { key: 'carla', role: 'student', firstName: 'Carla', lastName: 'Santos', email: 'carla.santos@gbox.adnu.edu.ph', schoolId: '2022-20031', contactNumber: '+639170000003' },
  { key: 'delacruz', role: 'faculty', firstName: 'Miguel', lastName: 'Dela Cruz', email: 'miguel.delacruz@adnu.edu.ph', schoolId: 'F-0101', contactNumber: '+639170000004' },
  { key: 'garcia', role: 'faculty', firstName: 'Lorna', lastName: 'Garcia', email: 'lorna.garcia@adnu.edu.ph', schoolId: 'F-0102', contactNumber: '+639170000005' },
];

// plan = what happens to the vehicle's sticker application.
const VEHICLES = [
  { owner: 'ana', plateNumber: 'SAM 1001', type: 'car', make: 'Toyota', model: 'Vios', color: 'White', plan: 'approved' },
  { owner: 'ben', plateNumber: 'SAM 2002', type: 'motorcycle', make: 'Honda', model: 'Click 125', color: 'Red', plan: 'pending' },
  { owner: 'ben', plateNumber: 'SAM 2003', type: 'car', make: 'Mitsubishi', model: 'Mirage', color: 'Gray', plan: 'none', active: false },
  { owner: 'carla', plateNumber: 'SAM 3003', type: 'car', make: 'Honda', model: 'City', color: 'Black', plan: 'rejected' },
  { owner: 'delacruz', plateNumber: 'SAM 4004', type: 'van', make: 'Toyota', model: 'Hiace', color: 'Silver', plan: 'approved' },
  { owner: 'garcia', plateNumber: 'SAM 5005', type: 'car', make: 'Suzuki', model: 'Ertiga', color: 'Blue', plan: 'expired' },
];

// Approximate points around the campus; the capacities are made up.
const AREAS = [
  { name: 'Main Gate Lot', latitude: 13.6218, longitude: 123.1816, capacity: 120 },
  { name: 'Library Lot', latitude: 13.6224, longitude: 123.1822, capacity: 60 },
  { name: 'Gymnasium Lot', latitude: 13.6209, longitude: 123.1809, capacity: 40 },
];

async function addApplication(vehicle, ownerId, adminId, plan) {
  const existing = await pool.query('SELECT 1 FROM campus_stickers WHERE vehicle_id = $1', [vehicle.id]);
  if (existing.rowCount > 0 || plan === 'none') return;

  // The expired sample is "applied for" 400 days ago so its expiry date can already be in the past.
  const createdAt = plan === 'expired' ? "now() - interval '400 days'" : 'now()';
  const { rows } = await pool.query(
    `INSERT INTO campus_stickers (vehicle_id, applicant_id, created_at) VALUES ($1, $2, ${createdAt}) RETURNING id`,
    [vehicle.id, ownerId],
  );
  const id = rows[0].id;
  if (plan === 'approved' || plan === 'expired') {
    // sticker_number NULL: the database assigns the next number (like 2026-0001).
    const expires = plan === 'expired' ? "now() - interval '30 days'" : "now() + interval '1 year'";
    await pool.query(
      `UPDATE campus_stickers
          SET status = 'approved', sticker_number = NULL, expires_at = ${expires},
              reviewed_by = $2, reviewed_at = now()
        WHERE id = $1`,
      [id, adminId],
    );
  } else if (plan === 'rejected') {
    await pool.query(
      `UPDATE campus_stickers
          SET status = 'rejected', rejection_reason = 'Plate number does not match the vehicle registration (sample data).',
              reviewed_by = $2, reviewed_at = now()
        WHERE id = $1`,
      [id, adminId],
    );
  }
}

async function addParkingActivity(vehicle, ownerId, areaId, { stillParked }) {
  const existing = await pool.query('SELECT 1 FROM parking_records WHERE vehicle_id = $1', [vehicle.id]);
  if (existing.rowCount > 0) return;
  const sticker = await pool.query(
    "SELECT id FROM campus_stickers WHERE vehicle_id = $1 AND status = 'approved'",
    [vehicle.id],
  );
  const stickerId = sticker.rows[0]?.id ?? null;

  // Three finished visits on the last three days: in at 7:30, out nine hours later.
  for (const daysAgo of [3, 2, 1]) {
    await pool.query(
      `INSERT INTO parking_records (user_id, vehicle_id, parking_area_id, sticker_id, entered_at, exited_at)
       VALUES ($1, $2, $3, $4,
               date_trunc('day', now()) - make_interval(days => $5) + interval '7 hours 30 minutes',
               date_trunc('day', now()) - make_interval(days => $5) + interval '16 hours 30 minutes')`,
      [ownerId, vehicle.id, areaId, stickerId, daysAgo],
    );
  }
  if (stillParked) {
    await pool.query(
      `INSERT INTO parking_records (user_id, vehicle_id, parking_area_id, sticker_id, entered_at)
       VALUES ($1, $2, $3, $4, now() - interval '2 hours')`,
      [ownerId, vehicle.id, areaId, stickerId],
    );
  }
}

export async function loadSampleData() {
  const passwordHash = await bcrypt.hash(SAMPLE_PASSWORD, BCRYPT_COST);

  const person = {};
  for (const data of PEOPLE) {
    person[data.key] = (await users.findByEmail(data.email))
      ?? (await users.create({ ...data, passwordHash, status: 'active' }));
  }

  const car = {};
  for (const data of VEHICLES) {
    let vehicle = await vehicles.findByPlateNumber(data.plateNumber);
    if (!vehicle) {
      vehicle = await vehicles.create({ ownerId: person[data.owner].id, ...data });
      if (data.active === false) vehicle = await vehicles.update(vehicle.id, { isActive: false });
    }
    car[data.plateNumber] = vehicle;
    await addApplication(vehicle, person[data.owner].id, person.admin.id, data.plan);
  }
  await pool.query('SELECT expire_stickers()'); // turns the "expired" sample into status expired

  const area = {};
  for (const data of AREAS) {
    const found = await pool.query('SELECT id FROM parking_areas WHERE lower(name) = lower($1)', [data.name]);
    area[data.name] = found.rows[0]?.id
      ?? (await pool.query(
        'INSERT INTO parking_areas (name, latitude, longitude, capacity) VALUES ($1, $2, $3, $4) RETURNING id',
        [data.name, data.latitude, data.longitude, data.capacity],
      )).rows[0].id;
  }

  await addParkingActivity(car['SAM 1001'], person.ana.id, area['Main Gate Lot'], { stillParked: true });
  await addParkingActivity(car['SAM 4004'], person.delacruz.id, area['Library Lot'], { stillParked: false });

  const { rows } = await pool.query(`
    SELECT (SELECT count(*)::int FROM users)           AS users,
           (SELECT count(*)::int FROM vehicles)        AS vehicles,
           (SELECT count(*)::int FROM campus_stickers) AS stickers,
           (SELECT count(*)::int FROM parking_areas)   AS parking_areas,
           (SELECT count(*)::int FROM parking_records) AS parking_records`);
  return rows[0];
}

// Runs only when started directly (npm run db:sample), not when imported by a test.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Refusing to add sample data while NODE_ENV=production.');
    }
    const counts = await loadSampleData();
    console.log('[db:sample] sample data ready:', counts);
    console.log(`[db:sample] sample accounts use the password: ${SAMPLE_PASSWORD}`);
  } catch (err) {
    console.error('[db:sample] failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
