// ADMIN DASHBOARD SERVICE: summary counts and the recent activities feed.
//
// Layers: routes -> controllers -> services -> db.
// Read-only: uses the shared connection pool from src/db/index.js (owned by the database
// developer) and only runs SELECT queries. Every value is a $1, $2... parameter.
//
// The activity feed is built from the time stamps the main tables already keep
// (users.created_at, vehicles.created_at, campus_stickers.created_at / reviewed_at), so it
// works on any version of the schema and needs no extra table.
import {
  ACTIVITY_TYPE,
  DASHBOARD_EXPIRING_WITHIN_DAYS,
  DASHBOARD_NEW_WITHIN_DAYS,
  MEMBER_ROLES,
  ROLE,
  STICKER_STATUS,
  STICKER_STATUSES,
  USER_STATUS,
  VEHICLE_TYPES,
} from '../config/constants.js';
import { pool } from '../db/index.js';

// { car: 0, motorcycle: 0, ... } so the frontend always gets every key, even with no rows.
const zeroCounts = (keys) => Object.fromEntries(keys.map((key) => [key, 0]));

async function userCounts() {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE role = $1)::int AS students,
            count(*) FILTER (WHERE role = $2)::int AS faculty,
            count(*) FILTER (WHERE role = $3)::int AS admins,
            count(*) FILTER (WHERE status = $4)::int AS active,
            count(*) FILTER (WHERE status = $5)::int AS disabled,
            count(*) FILTER (WHERE created_at >= now() - $6::int * interval '1 day')::int AS new_recently
       FROM users`,
    [ROLE.STUDENT, ROLE.FACULTY, ROLE.ADMIN, USER_STATUS.ACTIVE, USER_STATUS.DISABLED, DASHBOARD_NEW_WITHIN_DAYS],
  );
  const r = rows[0];
  return {
    total: r.total,
    byRole: { [ROLE.STUDENT]: r.students, [ROLE.FACULTY]: r.faculty, [ROLE.ADMIN]: r.admins },
    byStatus: { [USER_STATUS.ACTIVE]: r.active, [USER_STATUS.DISABLED]: r.disabled },
    newRecently: r.new_recently,
  };
}

async function vehicleCounts() {
  const { rows } = await pool.query(
    `SELECT type, is_active, count(*)::int AS n,
            count(*) FILTER (WHERE created_at >= now() - $1::int * interval '1 day')::int AS new_recently
       FROM vehicles GROUP BY type, is_active`,
    [DASHBOARD_NEW_WITHIN_DAYS],
  );
  const result = { total: 0, active: 0, deactivated: 0, byType: zeroCounts(VEHICLE_TYPES), newRecently: 0 };
  for (const row of rows) {
    result.total += row.n;
    if (row.is_active) result.active += row.n;
    else result.deactivated += row.n;
    result.byType[row.type] = (result.byType[row.type] ?? 0) + row.n;
    result.newRecently += row.new_recently;
  }
  return result;
}

async function stickerCounts() {
  const [byStatus, validity] = await Promise.all([
    pool.query('SELECT status, count(*)::int AS n FROM campus_stickers GROUP BY status'),
    // An approved sticker is "valid" until expires_at; after that it counts as expired, even
    // if no job has changed its status yet.
    pool.query(
      `SELECT count(*) FILTER (WHERE expires_at > now())::int AS valid,
              count(*) FILTER (WHERE expires_at > now()
                               AND expires_at <= now() + $2::int * interval '1 day')::int AS expiring_soon,
              count(*) FILTER (WHERE expires_at <= now())::int AS expired
         FROM campus_stickers WHERE status = $1`,
      [STICKER_STATUS.APPROVED, DASHBOARD_EXPIRING_WITHIN_DAYS],
    ),
  ]);
  const counts = zeroCounts(STICKER_STATUSES);
  let total = 0;
  for (const row of byStatus.rows) {
    counts[row.status] = row.n;
    total += row.n;
  }
  const v = validity.rows[0];
  return {
    total,
    byStatus: counts,
    validStickers: v.valid,
    expiringSoon: v.expiring_soon,
    expiredStickers: v.expired,
  };
}

async function parkingCounts() {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*)::int FROM parking_areas WHERE is_active) AS active_areas,
            (SELECT coalesce(sum(capacity), 0)::int FROM parking_areas WHERE is_active) AS capacity,
            (SELECT count(*)::int FROM parking_records WHERE exited_at IS NULL) AS parked_now`,
  );
  const r = rows[0];
  return {
    activeAreas: r.active_areas,
    totalCapacity: r.capacity,
    currentlyParked: r.parked_now,
    availableSlots: Math.max(0, r.capacity - r.parked_now),
  };
}

// GET /api/admin/dashboard: every count the admin dashboard cards need, in one response.
export async function getDashboardStats() {
  const [users, vehicles, stickerApplications, parking] = await Promise.all([
    userCounts(), vehicleCounts(), stickerCounts(), parkingCounts(),
  ]);
  return {
    users,
    vehicles,
    stickerApplications,
    parking,
    settings: { newWithinDays: DASHBOARD_NEW_WITHIN_DAYS, expiringWithinDays: DASHBOARD_EXPIRING_WITHIN_DAYS },
    generatedAt: new Date().toISOString(),
  };
}

// One row per event, from four sources. Column names and SQL are fixed here; the activity
// type names and roles are parameters $1..$6. Admin sign-ups (the seeded admin) are left out.
const ACTIVITY_SQL = `
  SELECT $1::text AS type, u.created_at AS occurred_at, u.id AS record_id,
         u.id AS actor_id, u.first_name AS actor_first, u.last_name AS actor_last, u.role AS actor_role,
         NULL::uuid AS applicant_id, NULL::text AS applicant_first, NULL::text AS applicant_last,
         NULL::text AS plate_number, NULL::text AS sticker_number
    FROM users u WHERE u.role = ANY($6::text[])
  UNION ALL
  SELECT $2::text, v.created_at, v.id,
         o.id, o.first_name, o.last_name, o.role,
         NULL, NULL, NULL,
         v.plate_number, NULL
    FROM vehicles v JOIN users o ON o.id = v.owner_id
  UNION ALL
  SELECT $3::text, s.created_at, s.id,
         a.id, a.first_name, a.last_name, a.role,
         NULL, NULL, NULL,
         v.plate_number, NULL
    FROM campus_stickers s JOIN vehicles v ON v.id = s.vehicle_id JOIN users a ON a.id = s.applicant_id
  UNION ALL
  SELECT CASE WHEN s.status = $7 THEN $5::text ELSE $4::text END, s.reviewed_at, s.id,
         r.id, r.first_name, r.last_name, r.role,
         a.id, a.first_name, a.last_name,
         v.plate_number, s.sticker_number
    FROM campus_stickers s
    JOIN vehicles v ON v.id = s.vehicle_id
    JOIN users a ON a.id = s.applicant_id
    LEFT JOIN users r ON r.id = s.reviewed_by
   WHERE s.reviewed_at IS NOT NULL`;

const fullName = (first, last) => (first ? `${first} ${last}` : null);

function toActivity(row) {
  return {
    id: `${row.type}:${row.record_id}`, // stable key for lists in the frontend
    type: row.type,
    occurredAt: row.occurred_at.toISOString(),
    recordId: row.record_id, // the user, vehicle or sticker application the event is about
    actor: row.actor_id
      ? { id: row.actor_id, fullName: fullName(row.actor_first, row.actor_last), role: row.actor_role }
      : null,
    applicant: row.applicant_id ? { id: row.applicant_id, fullName: fullName(row.applicant_first, row.applicant_last) } : null,
    plateNumber: row.plate_number,
    stickerNumber: row.sticker_number,
  };
}

// GET /api/admin/activities: newest events first, with optional type and date filters.
export async function listActivities({ type, from, to, page, limit }) {
  const params = [
    ACTIVITY_TYPE.USER_REGISTERED,
    ACTIVITY_TYPE.VEHICLE_REGISTERED,
    ACTIVITY_TYPE.STICKER_SUBMITTED,
    ACTIVITY_TYPE.STICKER_APPROVED,
    ACTIVITY_TYPE.STICKER_REJECTED,
    MEMBER_ROLES,
    STICKER_STATUS.REJECTED,
  ];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = [];
  if (type) where.push(`type = ${add(type)}`);
  if (from) where.push(`occurred_at >= ${add(from)}`);
  if (to) where.push(`occurred_at <= ${add(to)}`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countResult = await pool.query(`SELECT count(*)::int AS total FROM (${ACTIVITY_SQL}) a ${whereSql}`, params);
  const { rows } = await pool.query(
    `SELECT * FROM (${ACTIVITY_SQL}) a ${whereSql}
      ORDER BY occurred_at DESC, type, record_id
      LIMIT ${add(limit)} OFFSET ${add((page - 1) * limit)}`,
    params,
  );
  return { activities: rows.map(toActivity), total: countResult.rows[0].total };
}
