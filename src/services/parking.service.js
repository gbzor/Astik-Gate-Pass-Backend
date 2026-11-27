// PARKING SERVICE: parking areas, vehicle entry/exit, parking records and history.
//
// Layers: routes -> controllers -> services -> db.
// Uses the shared connection pool from src/db/index.js (read-only import; that file is owned by the
// database developer). Every value is a $1, $2... parameter. Column names only ever come from the
// fixed lists below, never from user input.
//
// Rules:
//   - Only PARKING_RECORDER_ROLES (admins for now) record entries and exits (checked in the routes).
//   - A vehicle may only enter with a VALID campus sticker: approved and not yet expired.
//   - One open record per vehicle (it can't be parked twice), and an area never goes over capacity.
//   - Students and faculty only ever see their OWN records. Someone else's record, vehicle or
//     history answers "not found" (404), so nobody can probe which IDs exist.
import {
  PARKING_AREA_SORT_FIELDS,
  PARKING_RECORD_SORT_FIELDS,
  PARKING_STATUS,
  PG_ERROR,
  ROLE,
  STICKER_STATUS,
  USER_STATUS,
} from '../config/constants.js';
import { pool } from '../db/index.js';
import { HttpError } from '../utils/httpError.js';
import { likePattern, sortColumns } from '../utils/sql.js';

const AREA_NOT_FOUND = 'Parking area not found.';
const DUPLICATE_AREA = 'A parking area with this name already exists.';
const RECORD_NOT_FOUND = 'Parking record not found.';
const VEHICLE_NOT_FOUND = 'Vehicle not found.';
const ALREADY_PARKED = 'This vehicle is already parked. Record its exit first.';

const isAdmin = (user) => user.role === ROLE.ADMIN;

// Runs fn(client) inside one database transaction: everything is saved, or nothing is.
async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// A small helper for building WHERE clauses: add(value) stores the value and returns "$n".
function paramList() {
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  return { params, add };
}

// ─── Parking areas ──────────────────────────────────────────────────────────────

// Each area with how many vehicles are inside it right now.
const SELECT_AREA = `
  SELECT a.id, a.name, a.latitude, a.longitude, a.capacity, a.is_active, a.created_at, a.updated_at,
         (SELECT count(*)::int FROM parking_records r
           WHERE r.parking_area_id = a.id AND r.exited_at IS NULL) AS occupied
    FROM parking_areas a`;

// API field -> database column. Only these can be changed through updateArea.
const AREA_UPDATABLE = {
  name: 'name',
  latitude: 'latitude',
  longitude: 'longitude',
  capacity: 'capacity',
};

const AREA_SORTABLE = sortColumns(PARKING_AREA_SORT_FIELDS, {
  name: 'lower(a.name)',
  capacity: 'a.capacity',
  createdAt: 'a.created_at',
});

// Database row (snake_case) -> API object (camelCase). NUMERIC columns arrive as text, so the
// coordinates are turned back into numbers for the map.
function toArea(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    capacity: row.capacity,
    occupied: row.occupied,
    available: Math.max(0, row.capacity - row.occupied),
    // false = deactivated: hidden from students and faculty, and no new entries allowed.
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const duplicateName = (err) => err.code === PG_ERROR.UNIQUE_VIOLATION;

// GET /api/parking/areas: admins see every area (or filter with isActive);
// students and faculty only ever see active ones.
export async function listAreas(actor, { isActive, q, sort, order, page, limit }) {
  const { params, add } = paramList();
  const where = [];
  const active = isAdmin(actor) ? isActive : true;
  if (active !== undefined) where.push(`a.is_active = ${add(active)}`);
  if (q) where.push(`a.name ILIKE ${add(likePattern(q))}`);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = `ORDER BY ${AREA_SORTABLE[sort]} ${order === 'asc' ? 'ASC' : 'DESC'}, a.id`;

  const countResult = await pool.query(`SELECT count(*)::int AS total FROM parking_areas a ${whereSql}`, params);
  const { rows } = await pool.query(
    `${SELECT_AREA} ${whereSql} ${orderSql} LIMIT ${add(limit)} OFFSET ${add((page - 1) * limit)}`,
    params,
  );
  return { areas: rows.map(toArea), total: countResult.rows[0].total };
}

// GET /api/parking/areas/:id: a deactivated area is "not found" for students and faculty.
export async function getArea(actor, id) {
  const { rows } = await pool.query(`${SELECT_AREA} WHERE a.id = $1`, [id]);
  const row = rows[0];
  if (!row || (!isAdmin(actor) && !row.is_active)) throw new HttpError(404, AREA_NOT_FOUND);
  return toArea(row);
}

// POST /api/parking/areas (admin)
export async function createArea({ name, latitude, longitude, capacity }) {
  let id;
  try {
    const { rows } = await pool.query(
      `INSERT INTO parking_areas (name, latitude, longitude, capacity)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, latitude, longitude, capacity],
    );
    id = rows[0].id;
  } catch (err) {
    if (duplicateName(err)) throw new HttpError(409, DUPLICATE_AREA);
    throw err;
  }
  const { rows } = await pool.query(`${SELECT_AREA} WHERE a.id = $1`, [id]);
  return toArea(rows[0]);
}

// Locks one area's row until the transaction ends, so entries, capacity changes and
// deactivation for the SAME area happen one at a time. Returns the row with its occupancy.
async function lockArea(client, id) {
  const locked = await client.query('SELECT id FROM parking_areas WHERE id = $1 FOR UPDATE', [id]);
  if (locked.rows.length === 0) throw new HttpError(404, AREA_NOT_FOUND);
  const { rows } = await client.query(`${SELECT_AREA} WHERE a.id = $1`, [id]);
  return rows[0];
}

// PATCH /api/parking/areas/:id (admin). Capacity can't go below the vehicles parked there now.
export async function updateArea(id, patch) {
  try {
    await inTransaction(async (client) => {
      const area = await lockArea(client, id);
      if (patch.capacity !== undefined && patch.capacity < area.occupied) {
        throw new HttpError(409, `${area.occupied} vehicles are parked here now, so the capacity can't be lower than that.`);
      }
      const entries = Object.entries(patch)
        .filter(([key, value]) => Object.hasOwn(AREA_UPDATABLE, key) && value !== undefined);
      if (entries.length === 0) return;
      const sets = entries.map(([key], i) => `${AREA_UPDATABLE[key]} = $${i + 2}`).join(', ');
      await client.query(`UPDATE parking_areas SET ${sets} WHERE id = $1`, [id, ...entries.map(([, v]) => v)]);
    });
  } catch (err) {
    if (duplicateName(err)) throw new HttpError(409, DUPLICATE_AREA);
    throw err;
  }
  const { rows } = await pool.query(`${SELECT_AREA} WHERE a.id = $1`, [id]);
  return toArea(rows[0]);
}

// PATCH /api/parking/areas/:id/deactivate and /activate (admin).
// An area with vehicles still inside can't be deactivated (their exits must be recorded first).
export async function setAreaActive(id, active) {
  await inTransaction(async (client) => {
    const area = await lockArea(client, id);
    if (!active && area.occupied > 0) {
      throw new HttpError(409, `${area.occupied} vehicles are still parked here. Record their exits first.`);
    }
    await client.query('UPDATE parking_areas SET is_active = $2 WHERE id = $1', [id, active]);
  });
  const { rows } = await pool.query(`${SELECT_AREA} WHERE a.id = $1`, [id]);
  return toArea(rows[0]);
}

// ─── Parking records ────────────────────────────────────────────────────────────

// A record with its vehicle, owner (public details only, never email or password),
// area and the sticker shown at entry.
const RECORD_FROM = `
    FROM parking_records r
    JOIN vehicles v ON v.id = r.vehicle_id
    JOIN users u ON u.id = r.user_id
    JOIN parking_areas a ON a.id = r.parking_area_id
    LEFT JOIN campus_stickers s ON s.id = r.sticker_id`;

const SELECT_RECORD = `
  SELECT r.id, r.entered_at, r.exited_at,
         floor(extract(epoch FROM (coalesce(r.exited_at, now()) - r.entered_at)))::bigint AS duration_seconds,
         v.id AS vehicle_id, v.plate_number, v.type AS vehicle_type, v.make, v.model, v.color,
         u.id AS user_id, u.first_name, u.last_name, u.school_id, u.role AS user_role,
         a.id AS area_id, a.name AS area_name,
         s.id AS sticker_id, s.sticker_number, s.expires_at AS sticker_expires_at
  ${RECORD_FROM}`;

const RECORD_SORTABLE = sortColumns(PARKING_RECORD_SORT_FIELDS, {
  enteredAt: 'r.entered_at',
  exitedAt: 'r.exited_at',
  plateNumber: 'v.plate_number',
  areaName: 'lower(a.name)',
});

function toRecord(row) {
  return {
    id: row.id,
    status: row.exited_at ? PARKING_STATUS.EXITED : PARKING_STATUS.PARKED,
    enteredAt: row.entered_at.toISOString(),
    exitedAt: row.exited_at ? row.exited_at.toISOString() : null,
    // How long it stayed (or has stayed so far, if still parked).
    durationMinutes: Math.floor(Number(row.duration_seconds) / 60),
    vehicle: {
      id: row.vehicle_id,
      plateNumber: row.plate_number,
      type: row.vehicle_type,
      make: row.make,
      model: row.model,
      color: row.color,
    },
    owner: {
      id: row.user_id,
      firstName: row.first_name,
      lastName: row.last_name,
      fullName: `${row.first_name} ${row.last_name}`,
      schoolId: row.school_id,
      role: row.user_role,
    },
    parkingArea: { id: row.area_id, name: row.area_name },
    sticker: row.sticker_id
      ? { id: row.sticker_id, stickerNumber: row.sticker_number, expiresAt: row.sticker_expires_at.toISOString() }
      : null,
  };
}

async function findRecord(id) {
  const { rows } = await pool.query(`${SELECT_RECORD} WHERE r.id = $1`, [id]);
  return rows[0] ? toRecord(rows[0]) : null;
}

// One shared search for every record list. `fixed` are filters the service forces
// (e.g. "only this user's records"), so they can't be widened by the query string.
async function searchRecords(filters, fixed = {}) {
  const {
    status, parkingAreaId, vehicleId, userId, q, from, to, sort, order, page, limit,
  } = { ...filters, ...fixed };
  const { params, add } = paramList();
  const where = [];

  if (status === PARKING_STATUS.PARKED) where.push('r.exited_at IS NULL');
  if (status === PARKING_STATUS.EXITED) where.push('r.exited_at IS NOT NULL');
  if (parkingAreaId) where.push(`r.parking_area_id = ${add(parkingAreaId)}`);
  if (vehicleId) where.push(`r.vehicle_id = ${add(vehicleId)}`);
  if (userId) where.push(`r.user_id = ${add(userId)}`);
  // Date range: the vehicle was on campus at some point in it (entered before the range ended,
  // and had not left before it started).
  if (from) where.push(`(r.exited_at IS NULL OR r.exited_at >= ${add(from)})`);
  if (to) where.push(`r.entered_at <= ${add(to)}`);
  if (q) {
    const p = add(likePattern(q));
    where.push(`(v.plate_number ILIKE ${p} OR u.first_name ILIKE ${p} OR u.last_name ILIKE ${p}
      OR (u.first_name || ' ' || u.last_name) ILIKE ${p} OR u.school_id ILIKE ${p} OR a.name ILIKE ${p})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // Sort column and direction come from fixed lists (validated), never raw user text.
  const orderSql = `ORDER BY ${RECORD_SORTABLE[sort]} ${order === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, r.id`;

  const countResult = await pool.query(`SELECT count(*)::int AS total ${RECORD_FROM} ${whereSql}`, params);
  const { rows } = await pool.query(
    `${SELECT_RECORD} ${whereSql} ${orderSql} LIMIT ${add(limit)} OFFSET ${add((page - 1) * limit)}`,
    params,
  );
  return { records: rows.map(toRecord), total: countResult.rows[0].total };
}

// GET /api/parking/records (admin): every record, with all filters.
export function listRecords(query) {
  return searchRecords(query);
}

// GET /api/parking/current (admin): vehicles on campus right now.
export function listCurrentlyParked(query) {
  return searchRecords(query, { status: PARKING_STATUS.PARKED });
}

// GET /api/parking/records/:id: an admin, or the user the record belongs to.
export async function getRecord(actor, id) {
  const record = await findRecord(id);
  if (!record || (!isAdmin(actor) && record.owner.id !== actor.id)) throw new HttpError(404, RECORD_NOT_FOUND);
  return record;
}

// GET /api/parking/history/me
export function myHistory(actor, query) {
  return searchRecords(query, { userId: actor.id });
}

// GET /api/parking/history/user/:id: an admin, or that same user.
export async function userHistory(actor, userId, query) {
  if (!isAdmin(actor) && userId !== actor.id) throw new HttpError(404, 'User not found.');
  const { rows } = await pool.query('SELECT 1 FROM users WHERE id = $1', [userId]);
  if (rows.length === 0) throw new HttpError(404, 'User not found.');
  return searchRecords(query, { userId });
}

// GET /api/parking/history/vehicle/:id: an admin, or the vehicle's owner.
export async function vehicleHistory(actor, vehicleId, query) {
  const { rows } = await pool.query('SELECT owner_id FROM vehicles WHERE id = $1', [vehicleId]);
  if (rows.length === 0 || (!isAdmin(actor) && rows[0].owner_id !== actor.id)) {
    throw new HttpError(404, VEHICLE_NOT_FOUND);
  }
  return searchRecords(query, { vehicleId });
}

// ─── Entry and exit ─────────────────────────────────────────────────────────────

// Finds a vehicle by ID or plate number (exactly one is given; the validator checks that).
// With lock = true the vehicle's row stays locked until the transaction ends, so two
// entries for the same car can't both pass the "already parked?" check.
async function findVehicle(client, { vehicleId, plateNumber }, { lock = false } = {}) {
  const [column, value] = vehicleId ? ['v.id', vehicleId] : ['v.plate_number', plateNumber];
  const { rows } = await client.query(
    `SELECT v.id, v.owner_id, v.is_active, u.status AS owner_status
       FROM vehicles v JOIN users u ON u.id = v.owner_id
      WHERE ${column} = $1 ${lock ? 'FOR UPDATE OF v' : ''}`,
    [value],
  );
  if (rows.length === 0) throw new HttpError(404, VEHICLE_NOT_FOUND);
  return rows[0];
}

// POST /api/parking/entry (admin): a vehicle enters a parking area.
// Every check runs inside one transaction. Locks are always taken vehicle first, then area,
// so two requests can never wait on each other forever.
export async function recordEntry(input) {
  let id;
  try {
    id = await inTransaction(async (client) => {
      const vehicle = await findVehicle(client, input, { lock: true });
      if (!vehicle.is_active) throw new HttpError(409, 'This vehicle is deactivated and can\'t enter.');
      if (vehicle.owner_status !== USER_STATUS.ACTIVE) {
        throw new HttpError(409, 'The owner\'s account is disabled, so this vehicle can\'t enter.');
      }

      const open = await client.query(
        'SELECT 1 FROM parking_records WHERE vehicle_id = $1 AND exited_at IS NULL',
        [vehicle.id],
      );
      if (open.rows.length > 0) throw new HttpError(409, ALREADY_PARKED);

      // Strict sticker rule: approved and not yet expired. The newest-expiring one is linked.
      const sticker = await client.query(
        `SELECT id FROM campus_stickers
          WHERE vehicle_id = $1 AND status = $2 AND expires_at > now()
          ORDER BY expires_at DESC LIMIT 1`,
        [vehicle.id, STICKER_STATUS.APPROVED],
      );
      if (sticker.rows.length === 0) {
        throw new HttpError(403, 'This vehicle has no valid campus sticker, so it can\'t enter.');
      }

      const area = await lockArea(client, input.parkingAreaId);
      if (!area.is_active) throw new HttpError(409, 'This parking area is closed.');
      if (area.occupied >= area.capacity) throw new HttpError(409, 'This parking area is full.');

      const { rows } = await client.query(
        `INSERT INTO parking_records (user_id, vehicle_id, parking_area_id, sticker_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [vehicle.owner_id, vehicle.id, area.id, sticker.rows[0].id],
      );
      return rows[0].id;
    });
  } catch (err) {
    // Backup for the "already parked" check: the database allows one open record per vehicle.
    if (err.code === PG_ERROR.UNIQUE_VIOLATION) throw new HttpError(409, ALREADY_PARKED);
    throw err;
  }
  return findRecord(id);
}

// POST /api/parking/exit (admin): closes the vehicle's open record.
// Works even if the vehicle, owner or area was deactivated while it was parked.
export async function recordExit(input) {
  const vehicle = await findVehicle(pool, input);
  const { rows } = await pool.query(
    `UPDATE parking_records SET exited_at = now()
      WHERE vehicle_id = $1 AND exited_at IS NULL
      RETURNING id`,
    [vehicle.id],
  );
  if (rows.length === 0) throw new HttpError(409, 'This vehicle is not parked right now.');
  return findRecord(rows[0].id);
}
