// Run with: npm test
// Starts the real app on a random port and calls it over HTTP.
//
// The tests ERASE every table before they start, so they only run against a
// separate, throwaway database set in TEST_DATABASE_URL, never DATABASE_URL.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const testDb = process.env.TEST_DATABASE_URL;
if (!testDb) {
  throw new Error('TEST_DATABASE_URL is not set. Add a separate, empty test database to .env (see .env.example). '
    + 'The tests erase all data, so never point it at the real database.');
}
if (testDb === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is the same as DATABASE_URL. Use a separate test database: the tests erase all data.');
}

// Settings for the test run only (set before the app is imported).
process.env.DATABASE_URL = testDb;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.ALLOWED_EMAIL_DOMAINS = 'adnu.edu.ph';
process.env.SEED_ADMIN_EMAIL = 'admin@adnu.edu.ph';
process.env.SEED_ADMIN_PASSWORD = 'Admin-Password-123!';

const { createApp } = await import('../src/app.js');
const { seed } = await import('../src/db/seed.js');
const { requireAuth, requireRole } = await import('../src/middleware/auth.js');
const { pool, users } = await import('../src/db/index.js');

let server;
let base;

before(async () => {
  // Fresh start every run: create the tables if needed, then empty them.
  await pool.query(await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
  await pool.query('TRUNCATE parking_records, campus_stickers, parking_areas, vehicles, admin_accounts, users CASCADE');
  await seed();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end(); // close database connections so the test run can exit
});

// Small helper: sends JSON and returns { status, body, cookie }.
async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body && { 'Content-Type': 'application/json' }),
      ...(cookie && { Cookie: cookie }),
    },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  const setCookie = res.headers.get('set-cookie');
  return {
    status: res.status,
    body: text ? JSON.parse(text) : null,
    cookie: setCookie ? setCookie.split(';')[0] : null,
    setCookie,
  };
}

const student = {
  role: 'student',
  firstName: 'Juan',
  lastName: 'Dela Cruz',
  email: 'juan@gbox.adnu.edu.ph',
  schoolId: '2023-12345',
  password: 'Student-Pass-1!',
  confirmPassword: 'Student-Pass-1!',
};

test('health check works', async () => {
  const res = await call('GET', '/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('register, sign in, see profile, sign out', async () => {
  const reg = await call('POST', '/auth/register', { body: student });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.email, student.email);
  assert.equal(reg.body.user.passwordHash, undefined, 'password hash must never be returned');

  const login = await call('POST', '/auth/login', { body: { email: student.email, password: student.password } });
  assert.equal(login.status, 200);
  assert.match(login.setCookie, /HttpOnly/i);
  assert.match(login.setCookie, /SameSite=Strict/i);

  const me = await call('GET', '/auth/me', { cookie: login.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.role, 'student');

  const out = await call('POST', '/auth/logout', { cookie: login.cookie });
  assert.equal(out.status, 204);
});

test('duplicate email or ID is refused', async () => {
  const res = await call('POST', '/auth/register', { body: { ...student, email: 'other@adnu.edu.ph' } });
  assert.equal(res.status, 409);
});

test('sign-up cannot create an admin', async () => {
  const res = await call('POST', '/auth/register', {
    body: { ...student, role: 'admin', email: 'sneaky@adnu.edu.ph', schoolId: 'X-9999' },
  });
  assert.equal(res.status, 400);
});

test('sign-up rejects non-school emails and weak passwords', async () => {
  const res = await call('POST', '/auth/register', {
    body: { ...student, email: 'juan@gmail.com', schoolId: 'X-1111', password: 'short', confirmPassword: 'short' },
  });
  assert.equal(res.status, 400);
  const fields = res.body.error.fields.map((f) => f.field);
  assert.ok(fields.includes('email'));
  assert.ok(fields.includes('password'));
});

test('passwords over 72 bytes are refused (bcrypt limit)', async () => {
  const long = `Aa1!${'é'.repeat(40)}`; // 44 characters but 84 bytes
  const res = await call('POST', '/auth/register', {
    body: { ...student, email: 'long@adnu.edu.ph', schoolId: 'X-2222', password: long, confirmPassword: long },
  });
  assert.equal(res.status, 400);
  assert.ok(res.body.error.fields.some((f) => f.field === 'password'));
});

test('wrong password gets a generic error', async () => {
  const res = await call('POST', '/auth/login', { body: { email: student.email, password: 'Wrong-Pass-1!' } });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.message, 'Incorrect email or password.');
});

test('each login page only accepts its own roles', async () => {
  // Student on the admin page: refused.
  const studentOnAdmin = await call('POST', '/auth/admin/login', { body: { email: student.email, password: student.password } });
  assert.equal(studentOnAdmin.status, 401);

  // Admin on the student page: refused.
  const admin = { email: 'admin@adnu.edu.ph', password: 'Admin-Password-123!' };
  const adminOnUser = await call('POST', '/auth/login', { body: admin });
  assert.equal(adminOnUser.status, 401);

  // Admin on the admin page: allowed.
  const adminOk = await call('POST', '/auth/admin/login', { body: admin });
  assert.equal(adminOk.status, 200);
  assert.equal(adminOk.body.user.role, 'admin');
});

test('protected routes need a valid session', async () => {
  assert.equal((await call('GET', '/auth/me')).status, 401);
  assert.equal((await call('GET', '/auth/me', { cookie: 'gp_session=forged.token.here' })).status, 401);
});

test('requireRole blocks the wrong role', async () => {
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const { errorHandler } = await import('../src/middleware/errorHandler.js');

  // Tiny app with one admin-only route, using the real middleware.
  const app = express();
  app.use(cookieParser());
  app.get('/api/admin-only', requireAuth, requireRole('admin'), (req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  const s = app.listen(0);
  await new Promise((resolve) => s.once('listening', resolve));
  const url = `http://127.0.0.1:${s.address().port}/api/admin-only`;

  try {
    const studentLogin = await call('POST', '/auth/login', { body: { email: student.email, password: student.password } });
    const adminLogin = await call('POST', '/auth/admin/login', { body: { email: 'admin@adnu.edu.ph', password: 'Admin-Password-123!' } });

    assert.equal((await fetch(url, { headers: { Cookie: studentLogin.cookie } })).status, 403);
    assert.equal((await fetch(url, { headers: { Cookie: adminLogin.cookie } })).status, 200);
  } finally {
    s.close();
  }
});

test('a disabled account is signed out and cannot sign in', async () => {
  const login = await call('POST', '/auth/login', { body: { email: student.email, password: student.password } });
  assert.equal(login.status, 200);

  const user = await users.findByEmail(student.email);
  await users.update(user.id, { status: 'disabled' });
  try {
    // The old session stops working at once, and a new sign-in is refused.
    assert.equal((await call('GET', '/auth/me', { cookie: login.cookie })).status, 401);
    const again = await call('POST', '/auth/login', { body: { email: student.email, password: student.password } });
    assert.equal(again.status, 403);
  } finally {
    await users.update(user.id, { status: 'active' });
  }
});

test('session cookie is scoped and not readable by page scripts', async () => {
  const login = await call('POST', '/auth/login', { body: { email: student.email, password: student.password } });
  assert.match(login.setCookie, /Path=\/api/i);
  assert.match(login.setCookie, /HttpOnly/i);
  assert.doesNotMatch(login.setCookie, /Max-Age|Expires/i, 'cookie should end when the browser closes');
});

test('broken or oversized JSON gets a clean 400', async () => {
  const broken = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"email": ',
  });
  assert.equal(broken.status, 400);

  const huge = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'a@adnu.edu.ph', password: 'x'.repeat(200 * 1024) }),
  });
  assert.equal(huge.status, 400);
  assert.doesNotMatch(await huge.text(), /stack|at \w+ \(/i, 'no internal details in the error');
});

test('security headers are set and CORS only trusts the frontend', async () => {
  const ok = await fetch(`${base}/health`, { headers: { Origin: 'http://localhost:5500' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5500');
  assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(ok.headers.get('x-powered-by'), null);

  const evil = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
});

test('health check reports the database connection', async () => {
  const res = await call('GET', '/health');
  assert.equal(res.body.database, 'ok');
});

test('unknown routes return 404 JSON', async () => {
  const res = await call('GET', '/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.message, 'Not found.');
});
