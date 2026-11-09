# Astik Gate Pass: Backend

REST API for the Ateneo de Naga University Campus Sticker Car Parking System.

This is the **starter**: the server foundation plus authentication (sign-up, user login, admin login,
logout, current user) and role-based access control. Vehicles, sticker applications, admin records
and parking are built on top of it next.

**Stack (all free):** Node.js 22.9+ · Express 5 · PostgreSQL (`pg`) · Zod validation · bcrypt ·
JWT in HttpOnly cookies · Helmet · express-rate-limit

> **Database:** PostgreSQL on a free hosted plan (Supabase or Neon, no card needed). The tables are in
> `src/db/schema.sql` and all queries are in `src/db/index.js`. Both belong to the database developer;
> see [docs/DATABASE_CONTRACT.md](docs/DATABASE_CONTRACT.md).

## Run it locally

1. Open a terminal in this `backend` folder and install the packages:
   ```powershell
   npm install
   ```
   It should finish with `found 0 vulnerabilities`.
2. Create your settings file from the template:
   ```powershell
   Copy-Item .env.example .env
   ```
3. Generate a secret, then paste the result after `JWT_SECRET=` in `.env`:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
4. In `.env`, set `SEED_ADMIN_PASSWORD` to a password of 12+ characters for the first admin account.
5. In `.env`, set `DATABASE_URL` to the connection string the database developer gives you (privately,
   never through GitHub or chat groups). The tables must already exist: `src/db/schema.sql` is run once
   in the Supabase/Neon SQL editor.
6. Start the server:
   ```powershell
   npm run dev
   ```
   You should see `Astik Gate Pass API running at http://localhost:3000/api`.
7. Open <http://localhost:3000/api/health> in your browser. You should see
   `{"status":"ok","database":"ok",...}`. If `database` says `unreachable`, check `DATABASE_URL`.

## Automated tests

The tests **erase all data** in the database they use, so they never touch `DATABASE_URL`.

1. Create a second, empty free database (for example a second Neon project) just for tests.
2. Put its connection string in `.env` as `TEST_DATABASE_URL=...`.
3. Run:
   ```powershell
   npm test
   ```
   The tests create the tables, clear them, and should end with `fail 0`. They can be run again anytime.

If `TEST_DATABASE_URL` is missing, or is the same as `DATABASE_URL`, the tests stop before touching anything.

## Folder layout

```
src/
  server.js                 starts the server
  app.js                    security headers, CORS, JSON, routes
  config/env.js             reads and checks .env
  config/constants.js       roles, statuses, bcrypt cost
  routes/index.js           mounts every feature's routes under /api
  routes/auth.routes.js     /api/auth/* URLs
  controllers/              request handlers (HTTP only: read request, call a service, respond)
  services/                 business logic; the ONLY layer that talks to the database
  middleware/               auth + roles, validation, rate limits, errors
  validators/               Zod schemas for every input
  utils/                    HttpError, publicUser (safe response shapes)
  db/index.js               Postgres queries (database developer)
  db/schema.sql             tables, relationships and rules (database developer)
  db/seed.js                creates the first admin at startup
test/                       automated API tests (npm test)
docs/API.md                 endpoints for the frontend team
docs/DATABASE_CONTRACT.md   tables and functions for the database developer
```

## Adding a feature

Layers: **routes → controllers → services → db**. Controllers never import `db/`; they call a service.
`test/layers.test.js` fails if a file outside `services/` imports the database.

1. Add `routes/<feature>.routes.js`, `controllers/<feature>.controller.js` and `services/<feature>.service.js`.
2. Add a Zod schema in `validators/` and use `validateBody(schema)` on every POST/PATCH.
3. Protect routes with `requireAuth` and `requireRole('admin')` (or `'student'`, `'faculty'`).
4. Check ownership in the service, so users can only touch their own records.
5. Add the data functions to `db/index.js`, call them only from the service, and document them in `docs/DATABASE_CONTRACT.md`.
6. Mount the router in `routes/index.js`, document it in `docs/API.md`, and add tests.

## Security built in

- Passwords hashed with bcrypt (cost 12). Wrong email and wrong password take the same time and get the same message.
- Session JWT in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` in production). Every request rechecks that the account still exists and is active.
- Separate student/faculty and admin login pages. Sign-up can never create an admin.
- Zod validates every input and drops unknown fields.
- Helmet security headers, CORS limited to your frontend, a 100 KB JSON limit, and rate limits
  (300 requests per 15 min overall; 10 **failed** sign-ins or sign-ups per 15 min, so a shared campus IP isn't locked out).
- Errors never expose stack traces or database details.
- `GET /api/health` reports whether the database is reachable.

## Before deploying

- Set `NODE_ENV=production`, use HTTPS, and set `CORS_ORIGINS` to the real frontend URL
  (the server refuses to start in production without it).
- Set `TRUST_PROXY=true` on hosts like Render or Railway.
- Serve the frontend and the API from the **same site**. The login cookie is `SameSite=Strict`, so browsers
  won't send it if the frontend is on `*.vercel.app` and the API on `*.onrender.com`. The simplest free option
  is one Render free web service where Express also serves the `frontend/` files. (A custom domain would also
  work but costs money.) Decide this with the team before deploying.

## Maps (not in this starter)

The ticket asks for Google Maps, but **Google Maps Platform needs a billing account with a credit card**.
Free option with no key and no card: **Leaflet + OpenStreetMap** in the frontend, with the backend
storing parking area coordinates. Confirm with the team before choosing.
