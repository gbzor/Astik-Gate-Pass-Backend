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

## Table: campus_stickers (sticker applications)

The API queries this table directly (`src/services/stickers.service.js`). **Do not rename** these
columns without telling the API developer: `id, vehicle_id, applicant_id, status, sticker_number,
expires_at, reviewed_by, reviewed_at, rejection_reason, created_at, updated_at`.

| Column | Notes |
|---|---|
| status | `pending`, `approved`, `rejected` or `expired` |
| sticker_number | unique; required when `approved`; assigned automatically if left `NULL` on approval |
| expires_at | required when `approved`; must be after `created_at` |
| reviewed_by | `admin_accounts.user_id`; set for every status except `pending` |
| rejection_reason | required when `rejected` |

**Status flow:** `pending` to `approved` to `expired`, or `pending` to `rejected`. Approved, rejected and
expired applications never change again (the service only updates `pending` ones). A rejected or expired
vehicle can apply again.

**Rules the database enforces (the API relies on them):**

| Rule | Constraint | API reaction |
|---|---|---|
| One pending or approved application per vehicle | `uq_stickers_one_open_per_vehicle` | `23505` to 409 |
| Reviewer fields match the status | `stickers_review_matches_status` | |
| Approved needs a number and an expiry date | `stickers_approved_complete` | |
| Rejected needs a reason | `stickers_rejected_has_reason` | |
| Sticker number is unique | `UNIQUE (sticker_number)` | `23505` to 409 |
| Only an admin account can review | `reviewed_by` references `admin_accounts` (every admin needs a row there; `users.create` adds it) | `23503` to 403 |
| The applicant owns the vehicle | `stickers_vehicle_owner_fk` | |

Inactive vehicles (`vehicles.is_active = false`) can't apply or be approved. That check is in the service.

### Expiry

An approved sticker past `expires_at` used to stay `approved` and block the owner from reapplying (an
index can't use `now()`). Now `expired` is a real status:

- `SELECT expire_stickers();` turns every approved sticker past its date into `expired` and returns how
  many it changed. It is safe to run at any time. **Call it from a scheduled job**, for example once at
  server start and then every hour, so lists and the status filter show the right status.
- Even without that job, saving a **new** application first expires that vehicle's lapsed sticker
  (a `BEFORE INSERT` trigger), so the owner can reapply immediately.
- Status `expired` needs adding to `STICKER_STATUSES` in `src/config/constants.js` so the API accepts it as a filter.

### Approval history: `sticker_application_history`

Insert-only audit trail (updates and deletes are refused). Triggers fill it automatically, so the API
needs no changes.

| Column | Notes |
|---|---|
| id | uuid PK |
| application_id | references `campus_stickers(id)`; indexed with `changed_at` |
| from_status | `NULL` for a brand new application |
| to_status | the new status |
| changed_by | `admin_accounts.user_id`; `NULL` for the applicant's own submit and for automatic expiry |
| reason | the rejection reason when rejected |
| changed_at | timestamptz, default `now()` |

Read it with `SELECT * FROM sticker_application_history WHERE application_id = $1 ORDER BY changed_at`.

### Sticker numbers

Approve with `sticker_number = NULL` and the database assigns the next number like `2026-0001`. The count
restarts every year (campus year, Asia/Manila). `next_sticker_number()` keeps one counter row per year in
`sticker_number_counters` and locks it while it counts, so concurrent approvals can never receive the same
number. Numbers already used by hand-typed stickers are skipped. A number typed by an admin is still accepted.
To use this, the API must allow the number to be omitted and pass `NULL`.

## Other tables (created in `src/db/schema.sql`, functions still to come)

`admin_accounts` (one row per admin user; created automatically by `users.create` for role `admin`),
`parking_areas`, `parking_records`. Relationships and rules are documented inside `schema.sql`.

## Setup

1. Put your connection string in `.env` as `DATABASE_URL=...` (never commit it).
2. Build the tables with `npm run db:migrate` (or paste `src/db/schema.sql` into the Supabase/Neon SQL editor).
   It is safe to run again later: it upgrades an existing database without deleting data.
3. `npm test` uses `TEST_DATABASE_URL`, a separate empty database, never `DATABASE_URL`. It runs
   `schema.sql` there and **erases every table** before each run, so it can be repeated.
4. Optional sample data for development: `npm run db:sample`. See `docs/DATABASE_STRUCTURE.md` for the
   diagram, every table and the SQL files.
