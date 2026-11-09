// USER SERVICE: profile updates and the admin's user records (list, view, enable/disable).
//
// Layers: routes -> controllers -> services -> db.
// Single-user reads and writes go through the existing users.* functions in src/db/index.js.
// The admin list needs search and paging, so it runs its own parameterized query here
// (src/db/ is owned by the database developer and is not changed).
import { pool, users } from '../db/index.js';
import { HttpError } from '../utils/httpError.js';
import { likePattern } from '../utils/sql.js';
import { listOwnVehicles } from './vehicles.service.js';

const NOT_FOUND = 'User not found.';

// API sort name -> database column. Only these can be sorted on.
const SORTABLE = {
  createdAt: 'u.created_at',
  lastName: 'u.last_name',
  firstName: 'u.first_name',
  email: 'u.email',
  schoolId: 'u.school_id',
};

// PATCH /api/users/me: only first and last name (the validator drops everything else).
export async function updateProfile(userId, { firstName, lastName }) {
  const patch = {};
  if (firstName !== undefined) patch.firstName = firstName;
  if (lastName !== undefined) patch.lastName = lastName;
  const user = await users.update(userId, patch);
  if (!user) throw new HttpError(404, NOT_FOUND);
  return user;
}

// GET /api/users/:id (admin): one user plus their registered vehicles.
export async function getUserDetails(id) {
  const user = await users.findById(id);
  if (!user) throw new HttpError(404, NOT_FOUND);
  return { user, vehicles: await listOwnVehicles(id) };
}

// GET /api/users (admin): search, filter, sort and page through user records.
// Selects named columns only, so the password hash is never read.
export async function listUsers({ role, status, q, sort, order, page, limit }) {
  const params = [];
  const where = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (role) where.push(`u.role = ${add(role)}`);
  if (status) where.push(`u.status = ${add(status)}`);
  if (q) {
    const p = add(likePattern(q));
    where.push(`(u.first_name ILIKE ${p} OR u.last_name ILIKE ${p}
      OR (u.first_name || ' ' || u.last_name) ILIKE ${p} OR u.email ILIKE ${p} OR u.school_id ILIKE ${p})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // Sort column and direction come from fixed lists (validated), never raw user text.
  const orderSql = `ORDER BY ${SORTABLE[sort]} ${order === 'asc' ? 'ASC' : 'DESC'}, u.id`;

  const countResult = await pool.query(`SELECT count(*)::int AS total FROM users u ${whereSql}`, params);
  const { rows } = await pool.query(
    `SELECT u.id, u.role, u.status, u.first_name, u.last_name, u.email, u.school_id, u.created_at,
            (SELECT count(*)::int FROM vehicles v WHERE v.owner_id = u.id) AS vehicle_count
       FROM users u ${whereSql} ${orderSql}
      LIMIT ${add(limit)} OFFSET ${add((page - 1) * limit)}`,
    params,
  );

  return {
    users: rows.map((row) => ({
      id: row.id,
      role: row.role,
      status: row.status,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      schoolId: row.school_id,
      createdAt: row.created_at.toISOString(),
      vehicleCount: row.vehicle_count,
    })),
    total: countResult.rows[0].total,
  };
}

// PATCH /api/users/:id/status (admin): enable or disable a student or faculty account.
// A disabled user is signed out on their next request (requireAuth checks status every time).
export async function setUserStatus(actor, id, status) {
  if (id === actor.id) throw new HttpError(400, 'You can\'t change the status of your own account.');
  const target = await users.findById(id);
  if (!target) throw new HttpError(404, NOT_FOUND);
  // Admin accounts are managed separately, so one admin can't lock out another.
  if (target.role === 'admin') throw new HttpError(403, 'Admin accounts can\'t be changed here.');
  return users.update(id, { status });
}
