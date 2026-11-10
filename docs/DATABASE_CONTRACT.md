# Database contract (for the database developer)

The backend reads and writes data only through `src/db/index.js`, and only the files in
`src/services/` call it (controllers go through a service). Right now that file stores
everything in memory, so it's lost on restart. To connect a real database, replace each function
body with real queries. Nothing else in the backend needs to change.

**Rules**

1. Keep every function name, its parameters and its return shape. Functions are `async`.
2. Return plain objects with the **camelCase** field names below. Map `snake_case` columns (like `toUser()` does).
3. Return `null` when a single row isn't found.
4. Parameterized queries only (`$1`, `$2`...). Never build SQL by joining strings with user input.
   Dynamic column names must come from a fixed whitelist (see `UPDATABLE` in `db/index.js`).
5. Multi-step writes go in a transaction (`BEGIN` / `COMMIT` / `ROLLBACK` with `pool.connect()`; see `users.create`).
6. Map Postgres error `23505` (duplicate) to `HttpError(409, ...)`. Never leak raw database errors to the client.
7. Keep this file plain data access: query in, plain object out. No `req`/`res` and no business rules
   (for example "only admins can approve" belongs in a service). Data rules that protect integrity
   (`UNIQUE`, `FOREIGN KEY`, `CHECK`, `NOT NULL`) belong in `schema.sql`.
8. Only files in `src/services/` import this file. `test/layers.test.js` fails if anything else does.
9. Store connection details in `.env` (`DATABASE_URL`), never in code. Tests use a separate, empty
   `TEST_DATABASE_URL`, because they erase all tables.
10. Run `npm test` before opening a pull request.

### Adding a new table's functions

1. Add the table to `src/db/schema.sql`, after the tables it references.
2. Add its functions to `src/db/index.js`, grouped under one object (like `users`).
3. Document the functions and return shapes in this file.
4. Tell the test owner, who must add the new table to the `TRUNCATE` list in `test/auth.test.js`.
5. Don't rename existing tables or columns without telling the people whose services use them.

Free hosted options with no card required: **Supabase** or **Neon** (Postgres), **Aiven** (MySQL).
Check the current free-tier limits before choosing.

## Table: users

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| role | enum `student`, `faculty`, `admin` | |
| status | enum `active`, `disabled` | Only `active` can sign in |
| firstName, lastName | varchar(60) | |
| email | varchar(254) **unique** | Stored lowercase |
| schoolId | varchar(20) **unique** | Student ID or Employee ID, stored uppercase |
| passwordHash | text | bcrypt hash. Never return it from the API |
| contactNumber | varchar(13), nullable | Philippine mobile in the format `+639XXXXXXXXX`. Agreed with the SMS developer. Not sent to the frontend yet (`publicUser` is a whitelist) |
| createdAt, updatedAt | timestamptz | |

## Functions in `src/db/index.js`

| Function | Returns |
|---|---|
| `users.findById(id)` | user or `null` |
| `users.findByEmail(email)` | user or `null` (case-insensitive) |
| `users.findBySchoolId(schoolId)` | user or `null` (case-insensitive) |
| `users.create(data)` | the new user, with `id`, `createdAt`, `updatedAt` filled in |
| `users.update(id, patch)` | the updated user, or `null` if not found |

## Other tables (created in `src/db/schema.sql`, functions still to come)

`admin_accounts` (one row per admin user; created automatically by `users.create` for role `admin`),
`vehicles`, `campus_stickers` (the sticker applications; approved/rejected by an admin account),
`parking_areas`, `parking_records`. Relationships and rules are documented inside `schema.sql`.

## Setup

1. Put your connection string in `.env` as `DATABASE_URL=...` (never commit it).
2. Run `src/db/schema.sql` once in the Supabase/Neon SQL editor.
3. `npm test` uses `TEST_DATABASE_URL`, a separate empty database, never `DATABASE_URL`. It runs
   `schema.sql` there and **erases every table** before each run, so it can be repeated.
