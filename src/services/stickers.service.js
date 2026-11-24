// STICKER APPLICATION SERVICE: submit, view, approve and reject campus sticker applications.
//
// Layers: routes -> controllers -> services -> db.
// Uses the shared connection pool from src/db/index.js (read-only import; that file is
// owned by the database developer) and the campus_stickers table from src/db/schema.sql.
// Every value is a $1, $2... parameter. Column names only come from the fixed lists below.
//
// Status rules (STICKER_STATUSES):
//   pending  -> approved   (admin gives a sticker number and an expiry date)
//   pending  -> rejected   (admin gives a reason, shown to the applicant)
//   approved / rejected never change again. A rejected vehicle can be applied for again.
//
// Ownership rule: students and faculty only see their OWN applications. Someone else's
// application answers "not found" (404), so nobody can probe which IDs exist.
import {
  PAGE_SIZE_MAX, PG_ERROR, ROLE, STICKER_SORT_FIELDS, STICKER_STATUS,
} from '../config/constants.js';
import { pool } from '../db/index.js';
import { HttpError } from '../utils/httpError.js';
import { likePattern, sortColumns } from '../utils/sql.js';
import {
  notifyStickerApproved,
  notifyStickerRejected,
  notifyStickerSubmitted,
} from './notify.service.js';

const NOT_FOUND = 'Sticker application not found.';
const VEHICLE_NOT_FOUND = 'Vehicle not found.';
const VEHICLE_INACTIVE = 'This vehicle is deactivated, so it can\'t get a sticker.';
const ALREADY_OPEN = 'This vehicle already has a pending or approved sticker application.';
const STICKER_TAKEN = 'That sticker number is already assigned to another vehicle.';

// One application, with its vehicle, the applicant's public details and the reviewer's name.
// Named columns only, so the password hash is never read.
const SELECT_APPLICATION = `
  SELECT s.id, s.vehicle_id, s.applicant_id, s.status, s.sticker_number, s.expires_at,
         s.reviewed_by, s.reviewed_at, s.rejection_reason, s.created_at, s.updated_at,
         v.plate_number, v.type AS vehicle_type, v.make AS vehicle_make, v.model AS vehicle_model,
         v.color AS vehicle_color, v.is_active AS vehicle_is_active,
         a.first_name AS applicant_first_name, a.last_name AS applicant_last_name,
         a.school_id AS applicant_school_id, a.email AS applicant_email, a.role AS applicant_role,
         r.first_name AS reviewer_first_name, r.last_name AS reviewer_last_name
    FROM campus_stickers s
    JOIN vehicles v ON v.id = s.vehicle_id
    JOIN users a ON a.id = s.applicant_id
    LEFT JOIN users r ON r.id = s.reviewed_by`;

// Joins needed by the admin list's filters and search (no reviewer join: it isn't searched).
const LIST_FROM = `
    FROM campus_stickers s
    JOIN vehicles v ON v.id = s.vehicle_id
    JOIN users a ON a.id = s.applicant_id`;

// API sort name (STICKER_SORT_FIELDS in constants.js) -> database column. Only these can be sorted on.
const SORTABLE = sortColumns(STICKER_SORT_FIELDS, {
  createdAt: 's.created_at',
  reviewedAt: 's.reviewed_at',
  status: 's.status',
  plateNumber: 'v.plate_number',
  stickerNumber: 's.sticker_number',
  expiresAt: 's.expires_at',
});

const isAdmin = (user) => user.role === ROLE.ADMIN;
const iso = (date) => (date ? date.toISOString() : null);

// Database row (snake_case) -> app object (camelCase). Applicant and reviewer details are
// only added for admins: applicants already know who they are, and reviewers stay private.
function toApplication(row, { forAdmin = false } = {}) {
  return {
    id: row.id,
    status: row.status,
    vehicleId: row.vehicle_id,
    applicantId: row.applicant_id,
    stickerNumber: row.sticker_number,
    expiresAt: iso(row.expires_at),
    rejectionReason: row.rejection_reason,
    reviewedAt: iso(row.reviewed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    vehicle: {
      id: row.vehicle_id,
      plateNumber: row.plate_number,
      type: row.vehicle_type,
      make: row.vehicle_make,
      model: row.vehicle_model,
      color: row.vehicle_color,
      isActive: row.vehicle_is_active,
    },
    ...(forAdmin && {
      applicant: {
        id: row.applicant_id,
        firstName: row.applicant_first_name,
        lastName: row.applicant_last_name,
        fullName: `${row.applicant_first_name} ${row.applicant_last_name}`,
        schoolId: row.applicant_school_id,
        email: row.applicant_email,
        role: row.applicant_role,
      },
      reviewedBy: row.reviewed_by
        ? {
          id: row.reviewed_by,
          fullName: row.reviewer_first_name ? `${row.reviewer_first_name} ${row.reviewer_last_name}` : null,
        }
        : null,
    }),
  };
}

// Loads one application if this user may see it; otherwise "not found".
async function findAccessible(actor, id) {
  const { rows } = await pool.query(`${SELECT_APPLICATION} WHERE s.id = $1`, [id]);
  const row = rows[0];
  if (!row || (!isAdmin(actor) && row.applicant_id !== actor.id)) {
    throw new HttpError(404, NOT_FOUND);
  }
  return row;
}

// POST /api/sticker-applications: apply for a sticker for one of your own, active vehicles.
// One INSERT ... SELECT checks ownership and "active" and saves in a single step, so a vehicle
// can't change owner or be deactivated between the check and the save.
// The database allows only ONE pending or approved application per vehicle (a unique index),
// which also stops two requests sent at the same moment from both getting through.
export async function submitApplication(applicant, { vehicleId }) {
  let id;
  try {
    const { rows } = await pool.query(
      `INSERT INTO campus_stickers (vehicle_id, applicant_id)
       SELECT v.id, v.owner_id FROM vehicles v
        WHERE v.id = $1 AND v.owner_id = $2 AND v.is_active
       RETURNING id`,
      [vehicleId, applicant.id],
    );
    id = rows[0]?.id;
  } catch (err) {
    if (err.code === PG_ERROR.UNIQUE_VIOLATION) throw new HttpError(409, ALREADY_OPEN);
    if (err.code === PG_ERROR.FOREIGN_KEY_VIOLATION) throw new HttpError(404, VEHICLE_NOT_FOUND); // deleted meanwhile
    throw err;
  }

  if (!id) {
    // Nothing saved: say why, without revealing other people's vehicles.
    const { rows } = await pool.query('SELECT owner_id, is_active FROM vehicles WHERE id = $1', [vehicleId]);
    if (!rows[0] || rows[0].owner_id !== applicant.id) throw new HttpError(404, VEHICLE_NOT_FOUND);
    throw new HttpError(409, VEHICLE_INACTIVE);
  }
  const application = toApplication(await findAccessible(applicant, id));
  notifyStickerSubmitted(application).catch(() => {});
  return application;
}

// GET /api/sticker-applications/mine: your own applications, newest first.
// At most PAGE_SIZE_MAX rows (a user has at most MAX_VEHICLES_PER_USER vehicles, so this is plenty).
export async function listOwnApplications(applicantId, { status }) {
  const params = [applicantId];
  const statusSql = status ? `AND s.status = $${params.push(status)}` : '';
  const { rows } = await pool.query(
    `${SELECT_APPLICATION} WHERE s.applicant_id = $1 ${statusSql}
      ORDER BY s.created_at DESC, s.id LIMIT ${PAGE_SIZE_MAX}`,
    params,
  );
  return rows.map((row) => toApplication(row));
}

// GET /api/sticker-applications (admin): search, filter, sort and page through every application.
export async function listApplications({
  status, applicantRole, applicantId, vehicleId, q, from, to, sort, order, page, limit,
}) {
  const params = [];
  const where = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (status) where.push(`s.status = ${add(status)}`);
  if (applicantRole) where.push(`a.role = ${add(applicantRole)}`);
  if (applicantId) where.push(`s.applicant_id = ${add(applicantId)}`);
  if (vehicleId) where.push(`s.vehicle_id = ${add(vehicleId)}`);
  if (from) where.push(`s.created_at >= ${add(from)}`);
  if (to) where.push(`s.created_at <= ${add(to)}`);
  if (q) {
    const p = add(likePattern(q));
    where.push(`(v.plate_number ILIKE ${p} OR s.sticker_number ILIKE ${p}
      OR a.first_name ILIKE ${p} OR a.last_name ILIKE ${p}
      OR (a.first_name || ' ' || a.last_name) ILIKE ${p} OR a.school_id ILIKE ${p})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // Sort column and direction come from fixed lists (validated), never raw user text.
  const orderSql = `ORDER BY ${SORTABLE[sort]} ${order === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, s.id`;

  const countResult = await pool.query(`SELECT count(*)::int AS total ${LIST_FROM} ${whereSql}`, params);
  const { rows } = await pool.query(
    `${SELECT_APPLICATION} ${whereSql} ${orderSql} LIMIT ${add(limit)} OFFSET ${add((page - 1) * limit)}`,
    params,
  );
  return {
    applications: rows.map((row) => toApplication(row, { forAdmin: true })),
    total: countResult.rows[0].total,
  };
}

// GET /api/sticker-applications/:id: the applicant, or an admin.
export async function getApplication(actor, id) {
  return toApplication(await findAccessible(actor, id), { forAdmin: isAdmin(actor) });
}

// Shared by approve and reject. The UPDATE only matches a PENDING application, so if two
// admins review at the same moment, exactly one wins and the other gets 409.
// Parameters: $1 id, $2 admin id, $3 'pending', then the caller's own from $4.
async function review(admin, id, { setSql, params, requireActiveVehicle }) {
  const vehicleSql = requireActiveVehicle
    ? 'AND EXISTS (SELECT 1 FROM vehicles v WHERE v.id = s.vehicle_id AND v.is_active)'
    : '';
  let updated;
  try {
    const { rowCount } = await pool.query(
      `UPDATE campus_stickers s
          SET ${setSql}, reviewed_by = $2, reviewed_at = now()
        WHERE s.id = $1 AND s.status = $3 ${vehicleSql}`,
      [id, admin.id, STICKER_STATUS.PENDING, ...params],
    );
    updated = rowCount > 0;
  } catch (err) {
    if (err.code === PG_ERROR.UNIQUE_VIOLATION) throw new HttpError(409, STICKER_TAKEN);
    if (err.code === PG_ERROR.FOREIGN_KEY_VIOLATION) {
      // reviewed_by must point at admin_accounts; an admin without that row can't review.
      console.error(`[stickers] admin ${admin.id} has no admin_accounts row; review refused.`);
      throw new HttpError(403, 'Your admin account isn\'t set up to review applications yet.');
    }
    throw err;
  }

  if (!updated) {
    // Nothing changed: explain why.
    const { rows } = await pool.query(
      `SELECT s.status, v.is_active FROM campus_stickers s JOIN vehicles v ON v.id = s.vehicle_id
        WHERE s.id = $1`,
      [id],
    );
    if (!rows[0]) throw new HttpError(404, NOT_FOUND);
    if (rows[0].status !== STICKER_STATUS.PENDING) throw new HttpError(409, `This application was already ${rows[0].status}.`);
    throw new HttpError(409, VEHICLE_INACTIVE);
  }
  return getApplication(admin, id);
}

// PATCH /api/sticker-applications/:id/approve (admin): issues the sticker.
// The database requires a sticker number and an expiry date on every approved sticker.
export async function approveApplication(admin, id, { stickerNumber, expiresAt }) {
  const application = await review(admin, id, {
    setSql: 'status = $4, sticker_number = $5, expires_at = $6, rejection_reason = NULL',
    params: [STICKER_STATUS.APPROVED, stickerNumber, expiresAt],
    requireActiveVehicle: true,
  });
  notifyStickerApproved(application).catch(() => {});
  return application;
}

// PATCH /api/sticker-applications/:id/reject (admin): the reason is shown to the applicant.
export async function rejectApplication(admin, id, { reason }) {
  const application = await review(admin, id, {
    setSql: 'status = $4, rejection_reason = $5, sticker_number = NULL, expires_at = NULL',
    params: [STICKER_STATUS.REJECTED, reason],
    requireActiveVehicle: false,
  });
  notifyStickerRejected(application).catch(() => {});
  return application;
}
