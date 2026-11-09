# Astik Gate Pass: Backend

REST API for **Astik Gate Pass**, the Ateneo de Naga University Campus Sticker Car Parking System.
Students and faculty register their vehicles and apply for campus stickers; admins review applications,
manage records and monitor parking.

**Stack (all free):** Node.js 22.9+ · Express 5 · PostgreSQL (`pg`) · Zod validation · bcrypt ·
JWT in HttpOnly cookies · Helmet · express-rate-limit

The frontend lives in the main project repo: <https://github.com/gbzor/Astik-Gate-Pass>.

## What's done

| Feature | Endpoints | Status |
|---|---|---|
| Health check | `GET /api/health` | ✅ |
| Authentication | `/api/auth/register`, `/login`, `/admin/login`, `/logout`, `/me` | ✅ |
| User management | `/api/users`, `/api/users/me`, `/api/users/:id`, `/api/users/:id/status` | ✅ |
| Vehicles | `/api/vehicles`, `/api/vehicles/mine`, `/api/vehicles/:id` | ✅ |
| Campus sticker applications | | Next |
| Admin dashboard and records | | Planned |
| Parking areas and records, map | | Planned |

Every endpoint, with request and response examples, is in **[docs/API.md](docs/API.md)**.

## Who owns what

| Area | Files | Owner |
|---|---|---|
| REST APIs | `src/routes`, `controllers`, `services`, `validators`, `middleware` | API developer |
| Database | `src/db/` (`index.js`, `schema.sql`, `seed.js`), [docs/DATABASE_CONTRACT.md](docs/DATABASE_CONTRACT.md) | Database developer |
| SMS and email notifications | notification services, `SMTP_*` and `SMS_*` settings | SMS + email developer |

Ask the owner before changing files in someone else's area.

## Run it locally

1. Clone the repo and install the packages:
   ```powershell
   git clone https://github.com/gbzor/Astik-Gate-Pass-Backend.git
   cd Astik-Gate-Pass-Backend
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
5. In `.env`, set `DATABASE_URL` to the connection string from the database developer. Get it privately,
   never through GitHub or group chats. The tables must already exist (`src/db/schema.sql` is run once in
   the Supabase or Neon SQL editor).
6. Start the server:
   ```powershell
   npm run dev
   ```
   You should see `Astik Gate Pass API running at http://localhost:3000/api`.
7. Open <http://localhost:3000/api/health> in your browser. You should see
   `{"status":"ok","database":"ok",...}`. If `database` says `unreachable`, check `DATABASE_URL`.

## Automated tests

The tests **erase all data** in the database they use, so they never use `DATABASE_URL`.

1. Create a second, **empty** database just for tests: a second free Neon or Supabase project, or a local
   PostgreSQL database.
2. Put its connection string in `.env` as `TEST_DATABASE_URL=...`.
3. Run:
   ```powershell
   npm test
   ```
   It should end with `fail 0`. You can run it again anytime: it recreates the tables and clears them first.

The tests stop before touching anything if `TEST_DATABASE_URL` is missing or the same as `DATABASE_URL`.
Test files run one at a time, so two files never reset the database at once.

## Folder layout

```
src/
  server.js                 starts the server
  app.js                    security headers, CORS, JSON, routes
  config/env.js             reads and checks .env
  config/constants.js       roles, statuses, vehicle types, limits
  routes/                   URLs for each feature, mounted in routes/index.js under /api
  controllers/              request handlers (HTTP only: read request, call a service, respond)
  services/                 business rules and ownership checks; the ONLY layer that uses the database
  middleware/               login check + roles, validation, rate limits, errors
  validators/               Zod schemas for every body, URL parameter and query string
  utils/                    HttpError, safe response shapes (publicUser, publicVehicle), search helpers
  db/                       connection, queries, tables and first admin (database developer)
test/                       automated API tests (npm test)
docs/API.md                 endpoints for the frontend team
docs/DATABASE_CONTRACT.md   tables and functions for the database developer
```

## Adding a feature

Layers: **routes → controllers → services → db**. Only `services/` may import `src/db/`.
`test/layers.test.js` fails if any other file does.

1. Create a branch from the latest `main` (`main` is protected: changes go in through a pull request).
2. Add `routes/<feature>.routes.js`, `controllers/<feature>.controller.js` and `services/<feature>.service.js`.
3. Add Zod schemas in `validators/`. Use `validateBody`, `validateParams` and `validateQuery` on every route.
4. Protect routes with `requireAuth` and `requireRole(...)`.
5. Check ownership in the service, so users can only touch their own records.
6. For database access, use the functions in `src/db/index.js`. If a function you need doesn't exist yet,
   agree on it with the database developer first.
7. Mount the router in `routes/index.js`, document it in `docs/API.md`, and add tests.
8. Before opening the pull request, run `npm test`, `npm audit` and Semgrep.

## Security built in

- Passwords hashed with bcrypt (cost 12). A wrong email and a wrong password take the same time and get the same message.
- Session JWT in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` in production). Every request rechecks that
  the account still exists and is active, so disabling an account signs the user out at once.
- Separate student/faculty and admin login pages. Sign-up can never create an admin.
- Role-based access on every route. Asking for another user's vehicle returns `404`, so record IDs can't be probed.
- Zod validates every input and drops unknown fields, so users can't set fields like `role` or `ownerId`.
- Parameterized SQL only, whitelisted sort columns, and search text treated as plain text.
- Lists return at most 100 rows per page.
- Helmet security headers, CORS limited to your frontend, a 100 KB JSON limit, and rate limits
  (300 requests per 15 min overall; 10 **failed** sign-ins or sign-ups per 15 min, so a shared campus IP isn't locked out).
- Errors never expose stack traces or database details.

## Before deploying

- Set `NODE_ENV=production`, use HTTPS, and set `CORS_ORIGINS` to the real frontend URL
  (the server refuses to start in production without it).
- Set `TRUST_PROXY=true` on hosts like Render or Railway.
- Serve the frontend and the API from the **same site**. The login cookie is `SameSite=Strict`, so browsers
  won't send it if the frontend is on `*.vercel.app` and the API on `*.onrender.com`. The simplest free option
  is one Render free web service where Express also serves the frontend files. (A custom domain also works
  but costs money.) Decide this with the team before deploying.

## Maps

The ticket asks for Google Maps, but **Google Maps Platform needs a billing account with a credit card**.
Free option with no key and no card: **Leaflet + OpenStreetMap** in the frontend, with the backend
storing parking area coordinates. Confirm with the team before choosing.
