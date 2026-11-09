// Inputs for the user management routes (/api/users).
import { z } from 'zod';
import { ROLES, USER_STATUSES } from '../config/constants.js';
import { order, pagination, searchText } from './common.schemas.js';

const name = z.string().trim().min(1, 'Required.').max(60)
  .regex(/^[\p{L} .'-]+$/u, 'Use letters, spaces, periods, apostrophes or hyphens only.');

// PATCH /api/users/me: a user edits their own profile.
// Email, ID number, role and status are NOT here, so a user can never change them.
export const updateProfileSchema = z.object({
  firstName: name.optional(),
  lastName: name.optional(),
}).refine((d) => Object.values(d).some((v) => v !== undefined), {
  message: 'Send at least one field to update.',
});

// PATCH /api/users/:id/status: an admin enables or disables an account.
export const updateStatusSchema = z.object({
  status: z.enum(USER_STATUSES, { error: 'Status must be active or disabled.' }),
});

// GET /api/users?role=student&status=active&q=juan&page=1&limit=20&sort=lastName&order=asc
export const listUsersQuery = z.object({
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  q: searchText,
  sort: z.enum(['createdAt', 'lastName', 'firstName', 'email', 'schoolId']).default('createdAt'),
  order,
  ...pagination,
});
