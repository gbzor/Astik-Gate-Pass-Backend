// Validation schemas for notification management routes (/api/notifications).
import { z } from 'zod';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
} from '../config/constants.js';

// GET /api/notifications?status=sent&channel=email&recipient=juan&page=1&limit=20 (admin)
export const listNotificationsQuery = z.object({
  status: z.enum(NOTIFICATION_STATUSES).optional(),
  channel: z.enum(NOTIFICATION_CHANNELS).optional(),
  recipient: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});
