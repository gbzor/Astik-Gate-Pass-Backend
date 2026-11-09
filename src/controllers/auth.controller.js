// Auth request handlers. HTTP only: read the request, call the service, send the response.
// All logic and database access lives in services/auth.service.js.
import { clearSessionCookie, setSessionCookie } from '../middleware/auth.js';
import * as authService from '../services/auth.service.js';
import { publicUser } from '../utils/present.js';

// POST /api/auth/register: students and faculty only.
export async function register(req, res) {
  const user = await authService.registerUser(req.body);
  res.status(201).json({ user: publicUser(user), message: 'Account created. You can now sign in.' });
}

// Shared by both login pages; `portal` picks which roles that page accepts.
async function signIn(req, res, portal) {
  const { email, password } = req.body;
  const user = await authService.signIn({ email, password, portal, ip: req.ip });
  setSessionCookie(res, user);
  res.json({ user: publicUser(user) });
}

// POST /api/auth/login: student and faculty login page.
export const login = (req, res) => signIn(req, res, 'user');

// POST /api/auth/admin/login: admin login page.
export const adminLogin = (req, res) => signIn(req, res, 'admin');

// POST /api/auth/logout
export function logout(req, res) {
  clearSessionCookie(res);
  res.status(204).end();
}

// GET /api/auth/me: who is signed in (used by the frontend on page load).
export function me(req, res) {
  res.json({ user: publicUser(req.user) });
}
