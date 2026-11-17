// Creates the first admin account at startup from SEED_ADMIN_EMAIL and
// SEED_ADMIN_PASSWORD in .env. Admins can't sign up through the API.
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import {
  BCRYPT_COST,
  ROLE,
  SEED_ADMIN_PASSWORD_MIN_LENGTH,
  SEED_ADMIN_SCHOOL_ID,
  USER_STATUS,
} from '../config/constants.js';
import { users } from './index.js';
import { HttpError } from '../utils/httpError.js';

export async function seed() {
  const { email, password } = env.seedAdmin;
  if (!email || password.length < SEED_ADMIN_PASSWORD_MIN_LENGTH) {
    console.warn(`[seed] No admin created. Set SEED_ADMIN_EMAIL and a ${SEED_ADMIN_PASSWORD_MIN_LENGTH}+ character SEED_ADMIN_PASSWORD in .env.`);
    return;
  }
  if (await users.findByEmail(email)) return;

  try {
    await users.create({
      role: ROLE.ADMIN,
      status: USER_STATUS.ACTIVE,
      firstName: 'System',
      lastName: 'Admin',
      email,
      schoolId: SEED_ADMIN_SCHOOL_ID,
      passwordHash: await bcrypt.hash(password, BCRYPT_COST),
    });
    console.log(`[seed] Admin account ready: ${email}`);
  } catch (err) {
    // The fixed admin ID (SEED_ADMIN_SCHOOL_ID) is already taken (SEED_ADMIN_EMAIL was changed after the first run).
    // Keep the server running instead of crashing at startup.
    if (err instanceof HttpError && err.status === 409) {
      console.warn(`[seed] No admin created: an account with ID ${SEED_ADMIN_SCHOOL_ID} already exists. Sign in with that admin.`);
      return;
    }
    throw err;
  }
}
