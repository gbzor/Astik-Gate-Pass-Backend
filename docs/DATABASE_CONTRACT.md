# Database contract (for the database developer)

The backend reads and writes data only through `src/db/index.js`, and only the files in
`src/services/` call it (controllers go through a service). Right now that file stores
everything in memory, so it's lost on restart. To connect a real database, replace each function
body with real queries. Nothing else in the backend needs to change.

**Rules**

1. Keep every function name, its parameters and its return shape. Functions are `async`.
2. Return plain objects with the **camelCase** field names below. Map `snake_case` columns if you use them.
3. Return `null` when a single row isn't found.
4. Use parameterized queries or an ORM. Never build SQL by joining strings with user input.
5. Store connection details in `.env` (for example `DATABASE_URL`), never in code.
6. Run `npm test` when you finish.

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

## Table: vehicles

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| ownerId | uuid FK to `users` | Never changes after creation |
| plateNumber | varchar(15) **unique** | Stored uppercase, 3-15 characters of A-Z, 0-9, space, dash |
| type | enum `car`, `motorcycle`, `tricycle`, `van`, `other` | |
| make, model, color | varchar, nullable | |
| isActive | boolean, default `true` | `false` = deactivated (kept for sticker and parking history) |
| createdAt, updatedAt | timestamptz | |

## Functions: vehicles

| Function | Returns |
|---|---|
| `vehicles.findById(id)` | vehicle or `null` |
| `vehicles.findByPlateNumber(plateNumber)` | vehicle or `null` (case-insensitive) |
| `vehicles.listByOwner(ownerId)` | array of vehicles (active and deactivated), newest first |
| `vehicles.create(data)` | the new vehicle; duplicate plate throws `HttpError(409)` |
| `vehicles.update(id, patch)` | the updated vehicle or `null`; patch may hold `plateNumber, type, make, model, color, isActive` |
| `vehicles.remove(id)` | `true` if deleted, `false` if not found; if stickers or parking records exist it throws `HttpError(409)` (deactivate instead) |

## Other tables (created in `src/db/schema.sql`, functions still to come)

`admin_accounts` (one row per admin user; created automatically by `users.create` for role `admin`),
`campus_stickers` (the sticker applications; approved/rejected by an admin account),
`parking_areas`, `parking_records`. Relationships and rules are documented inside `schema.sql`.

## Setup

1. Put your connection string in `.env` as `DATABASE_URL=...` (never commit it).
2. Run `src/db/schema.sql` once in the Supabase/Neon SQL editor.
3. `npm test` uses `TEST_DATABASE_URL`, a separate empty database, never `DATABASE_URL`. It runs
   `schema.sql` there and **erases every table** before each run, so it can be repeated.
