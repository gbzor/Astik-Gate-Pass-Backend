-- ===========================================================================
-- DEVELOPMENT ONLY. THIS DELETES EVERY TABLE AND ALL DATA IN THEM.
-- NEVER run this on the real database once it holds real data.
-- Use it only to start over on a throwaway database, then re-run schema.sql.
-- (The automated tests do not use this file; they truncate their own
-- TEST_DATABASE_URL database.)
-- ===========================================================================

-- Child tables first, so foreign keys don't block the drops (CASCADE covers the rest).
DROP TABLE IF EXISTS parking_records CASCADE;
DROP TABLE IF EXISTS campus_stickers CASCADE;
DROP TABLE IF EXISTS parking_areas   CASCADE;
DROP TABLE IF EXISTS vehicles        CASCADE;
DROP TABLE IF EXISTS admin_accounts  CASCADE;
DROP TABLE IF EXISTS users           CASCADE;

DROP FUNCTION IF EXISTS set_updated_at();
