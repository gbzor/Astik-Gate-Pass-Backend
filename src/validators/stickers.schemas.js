// Inputs for the campus sticker application routes (/api/sticker-applications).
import { z } from 'zod';
import { STICKER_MAX_VALIDITY_DAYS, STICKER_STATUSES } from '../config/constants.js';
import { order, pagination, searchText } from './common.schemas.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const status = z.enum(STICKER_STATUSES, { error: `Status must be one of: ${STICKER_STATUSES.join(', ')}.` });

// POST /api/sticker-applications: the signed-in student or faculty member applies for one of
// their own vehicles. The applicant always comes from the session, never from the body.
export const submitApplicationSchema = z.object({
  vehicleId: z.uuid('Choose one of your registered vehicles.'),
});

// Printed on the physical sticker, e.g. "2026-0001" or "FAC-0042". Stored in capitals.
// Max 20 characters to match campus_stickers.sticker_number in src/db/schema.sql.
const stickerNumber = z.string().trim().toUpperCase()
  .min(1, 'Enter the sticker number.')
  .max(20, 'Use 20 characters or fewer.')
  .regex(/^[A-Z0-9-]+$/, 'Use letters, numbers and hyphens only.')
  .regex(/[A-Z0-9]/, 'Enter a valid sticker number.');

// A date from an <input type="date"> ("2027-06-30") means the END of that day in Philippine time.
// A full ISO date-time with a time zone ("2027-06-30T17:00:00+08:00") is used as given.
const expiresAt = z.union([
  z.iso.date().transform((d) => new Date(`${d}T23:59:59.999+08:00`)),
  z.iso.datetime({ offset: true }).transform((d) => new Date(d)),
], { error: 'Use a date like 2027-06-30.' })
  .refine((d) => d.getTime() > Date.now(), 'The expiry date must be in the future.')
  .refine(
    (d) => d.getTime() <= Date.now() + STICKER_MAX_VALIDITY_DAYS * DAY_MS,
    `A sticker can be valid for at most ${STICKER_MAX_VALIDITY_DAYS} days.`,
  );

// PATCH /api/sticker-applications/:id/approve (admin)
export const approveApplicationSchema = z.object({
  stickerNumber,
  expiresAt,
});

// PATCH /api/sticker-applications/:id/reject (admin). The reason is shown to the applicant.
// Line breaks are allowed; other invisible control characters are not.
export const rejectApplicationSchema = z.object({
  reason: z.string().trim()
    .min(3, 'Tell the applicant why (at least 3 characters).')
    .max(500, 'Use 500 characters or fewer.')
    .refine((v) => !/\p{Cc}/u.test(v.replace(/\r?\n/g, '')), 'Remove special or invisible characters.'),
});

// GET /api/sticker-applications/mine?status=pending
export const listMyApplicationsQuery = z.object({
  status: status.optional(),
});

// GET /api/sticker-applications?status=pending&q=abc&page=1&limit=20&sort=createdAt&order=desc (admin)
export const listApplicationsQuery = z.object({
  status: status.optional(),
  applicantRole: z.enum(['student', 'faculty']).optional(),
  applicantId: z.uuid('Invalid applicant ID.').optional(),
  vehicleId: z.uuid('Invalid vehicle ID.').optional(),
  q: searchText,
  sort: z.enum(['createdAt', 'reviewedAt', 'status', 'plateNumber', 'stickerNumber', 'expiresAt']).default('createdAt'),
  order,
  ...pagination,
});
