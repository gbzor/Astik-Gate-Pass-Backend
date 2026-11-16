// Inputs for the user management routes (/api/users).
import { z } from 'zod';
import { ROLES, USER_SORT_FIELDS, USER_STATUSES } from '../config/constants.js';
import { order, pagination, personName, searchText, sortBy } from './common.schemas.js';

// PATCH /api/users/me: a user edits their own profile.
// Email, ID number, role and status are NOT here, so a user can never change them.
export const updateProfileSchema = z.object({
  firstName: personName.optional(),
  lastName: personName.optional(),
}).refine((d) => Object.values(d).some((v) => v !== undefined), {
  message: 'Send at least one field to update.',
});

// PATCH /api/users/:id/status: an admin enables or disables an account.
export const updateStatusSchema = z.object({
  status: z.enum(USER_STATUSES, { error: `Status must be one of: ${USER_STATUSES.join(', ')}.` }),
});

// GET /api/users?role=student&status=active&q=juan&page=1&limit=20&sort=lastName&order=asc
export const listUsersQuery = z.object({
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  q: searchText,
  sort: sortBy(USER_SORT_FIELDS),
  order,
  ...pagination,
});
