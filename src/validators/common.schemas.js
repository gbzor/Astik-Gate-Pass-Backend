// Inputs shared by many routes: record IDs, names, paging, sorting and search text.
import { z } from 'zod';
import {
  CAMPUS_UTC_OFFSET,
  DATE_RANGE_MAX_DAYS,
  DAY_MS,
  NAME_MAX_LENGTH,
  NAME_PATTERN,
  PAGE_NUMBER_MAX,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  SEARCH_TEXT_MAX_LENGTH,
  SEARCH_TEXT_PATTERN,
  SORT_FIELD_DEFAULT,
  SORT_ORDER_DEFAULT,
  SORT_ORDERS,
} from '../config/constants.js';

// For routes like /vehicles/:id. Anything that isn't a UUID is refused before the database sees it.
export const idParams = z.object({
  id: z.uuid('Invalid record ID.'),
});

// A first or last name. Used by sign-up and profile editing.
export const personName = z.string().trim().min(1, 'Required.').max(NAME_MAX_LENGTH)
  .regex(NAME_PATTERN, 'Use letters, spaces, periods, apostrophes or hyphens only.');

// ?page=2&limit=20. Query values arrive as text, so they are converted to numbers.
export const pagination = {
  page: z.coerce.number().int().min(1).max(PAGE_NUMBER_MAX).default(1),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
};

// ?order=asc or ?order=desc.
export const order = z.enum(SORT_ORDERS).default(SORT_ORDER_DEFAULT);

// ?sort=<field>, limited to the fields listed in constants.js for that list.
export const sortBy = (fields) => z.enum(fields).default(SORT_FIELD_DEFAULT);

// ?from=2026-08-01&to=2026-08-31: a date range in campus time. "from" starts at the beginning
// of that day and "to" ends at the end of it, so from=to means "that one day".
const dayStart = (d) => new Date(`${d}T00:00:00.000${CAMPUS_UTC_OFFSET}`);
const dayEnd = (d) => new Date(`${d}T23:59:59.999${CAMPUS_UTC_OFFSET}`);
const isoDay = (message) => z.iso.date(message);

export const dateRange = {
  from: isoDay('Use a date like 2026-08-01.').transform(dayStart).optional(),
  to: isoDay('Use a date like 2026-08-31.').transform(dayEnd).optional(),
};

// Add to a list's query schema with .superRefine(checkDateRange).
export function checkDateRange({ from, to }, ctx) {
  if (from && to && from > to) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'The end date must be on or after the start date.' });
  } else if (from && to && to - from > DATE_RANGE_MAX_DAYS * DAY_MS) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: `Choose a range of at most ${DATE_RANGE_MAX_DAYS} days.` });
  }
}

// ?q=search text. Letters, numbers and a few punctuation marks only, so it stays a plain search.
export const searchText = z.string().trim().max(SEARCH_TEXT_MAX_LENGTH)
  .regex(SEARCH_TEXT_PATTERN, 'Use letters, numbers, spaces, @ . \' _ or - only.')
  .optional();
