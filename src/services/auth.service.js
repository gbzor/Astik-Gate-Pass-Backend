// AUTH SERVICE: sign-up, sign-in and session checks.
//
// Layers: routes -> controllers -> services -> db.
// Controllers handle HTTP (req, res, cookies) and call these functions.
// Only services talk to the database (src/db/index.js).
import bcrypt from 'bcryptjs';
import { BCRYPT_COST } from '../config/constants.js';
import { users } from '../db/index.js';
import { HttpError } from '../utils/httpError.js';

// Compared against when the email doesn't exist, so a wrong email takes as long
// as a wrong password and attackers can't tell which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

// Students and faculty only. Admins are seeded, never signed up.
export async function registerUser(data) {
  if ((await users.findByEmail(data.email)) || (await users.findBySchoolId(data.schoolId))) {
    throw new HttpError(409, 'An account with this email or ID number already exists.');
  }

  return users.create({
    role: data.role,
    status: 'active',
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email,
    schoolId: data.schoolId,
    passwordHash: await bcrypt.hash(data.password, BCRYPT_COST),
  });
}

// Checks the email and password for one login page and returns the user.
// `portal` decides which roles may use that page, so an admin can't sign in on the
// student page and a student can't use the admin page. `ip` is only for the log.
export async function signIn({ email, password, portal, ip }) {
  const user = await users.findByEmail(email);
  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  const portalOk = user && (portal === 'admin' ? user.role === 'admin' : user.role !== 'admin');

  if (!user || !passwordOk || !portalOk) {
    console.warn(`[auth] Failed ${portal} sign-in from ${ip}`);
    throw new HttpError(401, 'Incorrect email or password.');
  }
  if (user.status !== 'active') {
    throw new HttpError(403, 'This account is disabled. Please contact the Security Office.');
  }
  return user;
}

// Used on every signed-in request: the user from the session, or null if the
// account no longer exists or is disabled.
export async function getActiveUser(id) {
  const user = await users.findById(id);
  return user && user.status === 'active' ? user : null;
}
