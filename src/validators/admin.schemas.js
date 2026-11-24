// Inputs for the admin dashboard routes (/api/admin).
import { z } from 'zod';
import { ACTIVITY_TYPES } from '../config/constants.js';
import { checkDateRange, dateRange, pagination } from './common.schemas.js';

// GET /api/admin/activities?type=sticker_approved&from=2026-08-01&to=2026-08-31&page=1&limit=20
// Always newest first, so there is no sort option.
export const listActivitiesQuery = z.object({
  type: z.enum(ACTIVITY_TYPES, { error: `Type must be one of: ${ACTIVITY_TYPES.join(', ')}.` }).optional(),
  ...dateRange,
  ...pagination,
}).superRefine(checkDateRange);
