// Login sessions and role-based access control (RBAC).
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { getActiveUser } from '../services/auth.service.js';
import { HttpError } from '../utils/httpError.js';
import { isTokenRevoked, revokeToken } from '../utils/revokedTokens.js';

export const SESSION_COOKIE = 'gp_session';

const cookieOptions = {
  httpOnly: true, // page JavaScript (and XSS) can't read the token
  secure: env.isProd, // HTTPS only in production
  sameSite: 'strict', // not sent on requests from other sites (blocks CSRF)
  path: '/api',
};

export function setSessionCookie(res, user) {
  const token = jwt.sign({ role: user.role }, env.jwtSecret, {
    subject: user.id,
    expiresIn: env.jwtExpiresIn,
    algorithm: 'HS256',
    jwtid: randomUUID(), // unique token ID, so this one token can be signed out on logout
  });
  // No maxAge, so the cookie ends when the browser closes. The token itself also expires.
  res.cookie(SESSION_COOKIE, token, cookieOptions);
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions);
}

// Logout: stops this request's token from working anywhere (even if it was copied),
// then removes the cookie. An invalid or missing token just gets the cookie removed.
export function endSession(req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    try {
      const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
      revokeToken(payload.jti, payload.exp);
    } catch {
      // Already invalid or expired: nothing to revoke.
    }
  }
  clearSessionCookie(res);
}

// Requires a valid session. Loads the user fresh on every request, so a
// disabled account or changed role takes effect immediately.
export async function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) throw new HttpError(401, 'Please sign in.');

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    clearSessionCookie(res);
    throw new HttpError(401, 'Your session has expired. Please sign in again.');
  }

  // Signed out, or issued before tokens had IDs: refuse, so the user signs in again.
  if (!payload.jti || isTokenRevoked(payload.jti)) {
    clearSessionCookie(res);
    throw new HttpError(401, 'Please sign in.');
  }

  const user = await getActiveUser(payload.sub);
  if (!user) {
    clearSessionCookie(res);
    throw new HttpError(401, 'Please sign in.');
  }
  req.user = user;
  next();
}

// Use after requireAuth, e.g. router.get('/admin/x', requireAuth, requireRole('admin'), handler).
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new HttpError(403, 'You do not have access to this resource.');
    }
    next();
  };
}
