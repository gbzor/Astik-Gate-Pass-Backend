// DATABASE SERVICE: connection checks for the health route and a clean shutdown.
// Keeps the rest of the app from touching the connection pool directly.
import { pool } from '../db/index.js';

// True if the database answers, false if it can't be reached.
// The real error goes to the server log only, never to the client.
export async function isDatabaseReachable() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    console.error('[health] database unreachable:', err.code || err.message || err);
    return false;
  }
}

// Releases every database connection (server shutdown).
export function closeDatabase() {
  return pool.end();
}
