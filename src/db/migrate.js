// Applies src/db/schema.sql to the database in DATABASE_URL:  npm run db:migrate
//
// schema.sql is written to be re-run safely (IF NOT EXISTS, CREATE OR REPLACE, guarded ALTERs),
// so it IS the migration: running it on a new database builds everything, and running it on an
// existing database upgrades it without touching any data. It never deletes rows or tables.
import { readFile } from 'node:fs/promises';
import { pool } from './index.js';

try {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query(
    "SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema = 'public'",
  );
  console.log(`[db:migrate] schema.sql applied. The database now has ${rows[0].tables} tables.`);
} catch (err) {
  console.error('[db:migrate] failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
