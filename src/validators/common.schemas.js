// Inputs shared by many routes: record IDs, paging, sorting and search text.
import { z } from 'zod';
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '../config/constants.js';

// For routes like /vehicles/:id. Anything that isn't a UUID is refused before the database sees it.
export const idParams = z.object({
  id: z.uuid('Invalid record ID.'),
});

// ?page=2&limit=20. Query values arrive as text, so they are converted to numbers.
export const pagination = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
};

// ?order=asc or ?order=desc.
export const order = z.enum(['asc', 'desc']).default('desc');

// ?q=search text. Letters, numbers and a few punctuation marks only, so it stays a plain search.
export const searchText = z.string().trim().max(100)
  .regex(/^[\p{L}\p{N} .@'_-]*$/u, 'Use letters, numbers, spaces, @ . \' _ or - only.')
  .optional();
