// ---------------------------------------------------------------------------
// DATA ACCESS LAYER: POSTGRES VERSION
//
// The rest of the backend only talks to the data through the functions in
// this file, so names, inputs and return shapes must stay the same.
// Every query is parameterized ($1, $2...). Never build SQL by joining strings.
// The tables live in src/db/schema.sql.
// ---------------------------------------------------------------------------
import pg from 'pg';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

// Hosted databases (Supabase/Neon) require SSL; a local one on this machine does not.
const isLocal = ['localhost', '127.0.0.1'].includes(new URL(env.databaseUrl).hostname);

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  ssl: isLocal ? false : { rejectUnauthorized: true },
  max: 10,
});
// An idle connection dropping must not crash the whole server.
pool.on('error', (err) => console.error('[db] idle client error:', err.message));

// Postgres columns are snake_case; the app expects camelCase. Dates become ISO strings.
function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    role: row.role,
    status: row.status,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    schoolId: row.school_id,
    passwordHash: row.password_hash,
    contactNumber: row.contact_number, // +639XXXXXXXXX or null
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// Only these app fields may be changed through users.update (also keeps column names out of user input).
const UPDATABLE = {
  role: 'role',
  status: 'status',
  firstName: 'first_name',
  lastName: 'last_name',
  email: 'email',
  schoolId: 'school_id',
  passwordHash: 'password_hash',
  contactNumber: 'contact_number',
};

// Postgres error 23505 = unique violation (duplicate email or school ID).
const isDuplicate = (err) => err.code === '23505';
const DUPLICATE_MESSAGE = 'An account with this email or ID number already exists.';

// --- users ------------------------------------------------------------------
export const users = {
  async findById(id) {
    // A malformed id can't match a uuid column; return null instead of a database error.
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return toUser(rows[0]);
  },
  async findByEmail(email) {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    return toUser(rows[0]);
  },
  async findBySchoolId(schoolId) {
    const { rows } = await pool.query('SELECT * FROM users WHERE school_id = $1', [schoolId.toUpperCase()]);
    return toUser(rows[0]);
  },
  async create(data) {
    const client = await pool.connect();
    try {
      // One transaction: an admin user and its admin_accounts row are saved together or not at all.
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO users (role, status, first_name, last_name, email, school_id, password_hash, contact_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          data.role,
          data.status ?? 'active',
          data.firstName,
          data.lastName,
          data.email.toLowerCase(),
          data.schoolId.toUpperCase(),
          data.passwordHash,
          data.contactNumber ?? null,
        ],
      );
      // Sticker approvals point at admin_accounts, so every admin needs a row there.
      if (rows[0].role === 'admin') {
        await client.query('INSERT INTO admin_accounts (user_id) VALUES ($1)', [rows[0].id]);
      }
      await client.query('COMMIT');
      return toUser(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      if (isDuplicate(err)) throw new HttpError(409, DUPLICATE_MESSAGE);
      throw err;
    } finally {
      client.release();
    }
  },
  async update(id, patch) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
    const entries = Object.entries(patch).filter(([key]) => key in UPDATABLE);
    if (entries.length === 0) return users.findById(id);
    const values = entries.map(([key, value]) => {
      if (key === 'email') return value.toLowerCase();
      if (key === 'schoolId') return value.toUpperCase();
      return value;
    });
    // Column names come from the fixed UPDATABLE list above, never from user input; values are parameters.
    const sets = entries.map(([key], i) => `${UPDATABLE[key]} = $${i + 2}`).join(', ');
    try {
      const { rows } = await pool.query(`UPDATE users SET ${sets} WHERE id = $1 RETURNING *`, [id, ...values]);
      return toUser(rows[0]);
    } catch (err) {
      if (isDuplicate(err)) throw new HttpError(409, DUPLICATE_MESSAGE);
      throw err;
    }
  },
};
