// VEHICLE SERVICE: register, view, update and delete vehicles, with ownership rules.
//
// Layers: routes -> controllers -> services -> db.
// Uses the shared connection pool from src/db/index.js (read-only import; that file is
// owned by the database developer). Every value is a $1, $2... parameter. Column names
// only ever come from the fixed lists below, never from user input.
//
// Ownership rule: students and faculty can only see and change their OWN vehicles.
// Someone else's vehicle answers "not found" (404), not "forbidden", so nobody can
// probe which vehicle IDs exist. Admins can see and manage every vehicle.
import { MAX_VEHICLES_PER_USER } from '../config/constants.js';
import { pool } from '../db/index.js';
import { HttpError } from '../utils/httpError.js';
import { likePattern, PG_STILL_REFERENCED, PG_UNIQUE_VIOLATION } from '../utils/sql.js';

const DUPLICATE_PLATE = 'This plate number is already registered.';
const NOT_FOUND = 'Vehicle not found.';

// Columns returned for a vehicle, plus its owner's public details (never the password hash).
const SELECT_VEHICLE = `
  SELECT v.id, v.owner_id, v.plate_number, v.type, v.make, v.model, v.color,
         v.created_at, v.updated_at,
         u.first_name AS owner_first_name, u.last_name AS owner_last_name,
         u.school_id AS owner_school_id, u.email AS owner_email, u.role AS owner_role
    FROM vehicles v
    JOIN users u ON u.id = v.owner_id`;

// API field -> database column. Only these can be changed through updateVehicle.
const UPDATABLE = {
  plateNumber: 'plate_number',
  type: 'type',
  make: 'make',
  model: 'model',
  color: 'color',
};

// API sort name -> database column. Only these can be sorted on.
const SORTABLE = {
  createdAt: 'v.created_at',
  plateNumber: 'v.plate_number',
  type: 'v.type',
  make: 'v.make',
};

// Database row (snake_case) -> app object (camelCase). Dates become ISO strings.
function toVehicle(row, { withOwner = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    plateNumber: row.plate_number,
    type: row.type,
    make: row.make,
    model: row.model,
    color: row.color,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ...(withOwner && {
      owner: {
        id: row.owner_id,
        firstName: row.owner_first_name,
        lastName: row.owner_last_name,
        fullName: `${row.owner_first_name} ${row.owner_last_name}`,
        schoolId: row.owner_school_id,
        email: row.owner_email,
        role: row.owner_role,
      },
    }),
  };
}

const isAdmin = (user) => user.role === 'admin';

// Loads one vehicle if this user may see it; otherwise "not found".
async function findAccessible(actor, id) {
  const { rows } = await pool.query(`${SELECT_VEHICLE} WHERE v.id = $1`, [id]);
  const row = rows[0];
  if (!row || (!isAdmin(actor) && row.owner_id !== actor.id)) {
    throw new HttpError(404, NOT_FOUND);
  }
  return row;
}

// POST /api/vehicles: the signed-in student or faculty member registers their own vehicle.
// The owner always comes from the session, never from the request body.
export async function registerVehicle(owner, data) {
  const client = await pool.connect();
  let id;
  try {
    await client.query('BEGIN');
    // Lock this owner's users row until COMMIT. Without it, several requests sent at the
    // same moment could each count "4 vehicles" and all insert, going over the limit.
    // Only requests for the SAME owner wait; other users aren't slowed down.
    const locked = await client.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [owner.id]);
    if (locked.rows.length === 0) throw new HttpError(401, 'Please sign in.');

    const { rows: [{ total }] } = await client.query(
      'SELECT count(*)::int AS total FROM vehicles WHERE owner_id = $1',
      [owner.id],
    );
    if (total >= MAX_VEHICLES_PER_USER) {
      throw new HttpError(409, `You can register up to ${MAX_VEHICLES_PER_USER} vehicles.`);
    }

    const { rows } = await client.query(
      `INSERT INTO vehicles (owner_id, plate_number, type, make, model, color)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [owner.id, data.plateNumber, data.type, data.make ?? null, data.model ?? null, data.color ?? null],
    );
    await client.query('COMMIT');
    id = rows[0].id;
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === PG_UNIQUE_VIOLATION) throw new HttpError(409, DUPLICATE_PLATE);
    throw err;
  } finally {
    client.release();
  }
  return toVehicle(await findAccessible(owner, id));
}

// GET /api/vehicles/mine
export async function listOwnVehicles(ownerId) {
  const { rows } = await pool.query(
    `${SELECT_VEHICLE} WHERE v.owner_id = $1 ORDER BY v.created_at DESC, v.id`,
    [ownerId],
  );
  return rows.map((row) => toVehicle(row));
}

// GET /api/vehicles (admin): search, filter, sort and page through every vehicle.
export async function listVehicles({ type, ownerRole, ownerId, q, sort, order, page, limit }) {
  const params = [];
  const where = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (type) where.push(`v.type = ${add(type)}`);
  if (ownerRole) where.push(`u.role = ${add(ownerRole)}`);
  if (ownerId) where.push(`v.owner_id = ${add(ownerId)}`);
  if (q) {
    const p = add(likePattern(q));
    where.push(`(v.plate_number ILIKE ${p} OR v.make ILIKE ${p} OR v.model ILIKE ${p} OR v.color ILIKE ${p}
      OR u.first_name ILIKE ${p} OR u.last_name ILIKE ${p}
      OR (u.first_name || ' ' || u.last_name) ILIKE ${p} OR u.school_id ILIKE ${p})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // Sort column and direction come from fixed lists (validated), never raw user text.
  const orderSql = `ORDER BY ${SORTABLE[sort]} ${order === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, v.id`;

  const countResult = await pool.query(
    `SELECT count(*)::int AS total FROM vehicles v JOIN users u ON u.id = v.owner_id ${whereSql}`,
    params,
  );
  const { rows } = await pool.query(
    `${SELECT_VEHICLE} ${whereSql} ${orderSql} LIMIT ${add(limit)} OFFSET ${add((page - 1) * limit)}`,
    params,
  );
  return { vehicles: rows.map((row) => toVehicle(row, { withOwner: true })), total: countResult.rows[0].total };
}

// GET /api/vehicles/:id: the owner, or an admin (admins also see the owner's details).
export async function getVehicle(actor, id) {
  return toVehicle(await findAccessible(actor, id), { withOwner: isAdmin(actor) });
}

// PATCH /api/vehicles/:id: the owner, or an admin.
export async function updateVehicle(actor, id, patch) {
  const current = await findAccessible(actor, id);

  // A plate on an issued (or pending) sticker must not change, or the sticker would
  // point at a different plate. Admins can reject the sticker first if it's a typo.
  if (patch.plateNumber && patch.plateNumber !== current.plate_number) {
    const { rows } = await pool.query(
      'SELECT 1 FROM campus_stickers WHERE vehicle_id = $1 LIMIT 1',
      [id],
    );
    if (rows.length > 0) {
      throw new HttpError(409, 'This vehicle already has a sticker application, so its plate number can\'t be changed.');
    }
  }

  const entries = Object.entries(patch).filter(([key, value]) => key in UPDATABLE && value !== undefined);
  if (entries.length === 0) return toVehicle(current, { withOwner: isAdmin(actor) });

  const sets = entries.map(([key], i) => `${UPDATABLE[key]} = $${i + 2}`).join(', ');
  try {
    await pool.query(`UPDATE vehicles SET ${sets} WHERE id = $1`, [id, ...entries.map(([, value]) => value)]);
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) throw new HttpError(409, DUPLICATE_PLATE);
    throw err;
  }
  return getVehicle(actor, id);
}

// DELETE /api/vehicles/:id: the owner, or an admin. A vehicle with sticker or parking
// history is kept for the records (the database refuses to delete it).
export async function deleteVehicle(actor, id) {
  await findAccessible(actor, id);
  try {
    await pool.query('DELETE FROM vehicles WHERE id = $1', [id]);
  } catch (err) {
    if (PG_STILL_REFERENCED.includes(err.code)) {
      throw new HttpError(409, 'This vehicle has sticker or parking records, so it can\'t be deleted.');
    }
    throw err;
  }
}
