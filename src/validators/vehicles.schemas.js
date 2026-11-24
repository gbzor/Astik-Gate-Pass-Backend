// Inputs for the vehicle routes (/api/vehicles).
import { z } from 'zod';
import {
  MEMBER_ROLES,
  PLATE_NUMBER_MAX_LENGTH,
  PLATE_NUMBER_MIN_LENGTH,
  PLATE_NUMBER_PATTERN,
  VEHICLE_COLOR_MAX_LENGTH,
  VEHICLE_DETAIL_PATTERN,
  VEHICLE_MAKE_MAX_LENGTH,
  VEHICLE_MODEL_MAX_LENGTH,
  VEHICLE_SORT_FIELDS,
  VEHICLE_TYPES,
} from '../config/constants.js';
import {
  checkDateRange, dateRange, order, pagination, searchText, sortBy,
} from './common.schemas.js';

// Plate numbers are stored in one standard form ("abc  1234" becomes "ABC 1234"),
// so the same plate can't be registered twice with different spacing or case.
const plateNumber = z.string().trim().toUpperCase()
  .transform((v) => v.replace(/\s+/g, ' '))
  .pipe(z.string()
    .min(PLATE_NUMBER_MIN_LENGTH, 'Enter the plate number.')
    .max(PLATE_NUMBER_MAX_LENGTH, `Use ${PLATE_NUMBER_MAX_LENGTH} characters or fewer.`)
    .regex(PLATE_NUMBER_PATTERN, 'Use letters, numbers, spaces and hyphens only.')
    .regex(/[A-Z0-9].*[A-Z0-9]/, 'Enter a valid plate number.'));

const type = z.enum(VEHICLE_TYPES, { error: `Choose one of: ${VEHICLE_TYPES.join(', ')}.` });

// Optional text such as "Toyota", "Vios" or "Pearl White". null clears the value.
const detail = (max) => z.string().trim().max(max)
  .regex(VEHICLE_DETAIL_PATTERN, 'Use letters, numbers, spaces and . \' & / - only.')
  .transform((v) => v || null)
  .nullable()
  .optional();

const details = {
  make: detail(VEHICLE_MAKE_MAX_LENGTH),
  model: detail(VEHICLE_MODEL_MAX_LENGTH),
  color: detail(VEHICLE_COLOR_MAX_LENGTH),
};

// POST /api/vehicles
export const createVehicleSchema = z.object({
  plateNumber,
  type,
  ...details,
});

// PATCH /api/vehicles/:id: send only the fields that change.
export const updateVehicleSchema = z.object({
  plateNumber: plateNumber.optional(),
  type: type.optional(),
  ...details,
}).refine((d) => Object.values(d).some((v) => v !== undefined), {
  message: 'Send at least one field to update.',
});

// GET /api/vehicles?type=car&ownerRole=student&isActive=true&q=abc&from=2026-08-01&page=1&limit=20&sort=plateNumber&order=asc
// from/to filter by registration date.
export const listVehiclesQuery = z.object({
  type: type.optional(),
  ownerRole: z.enum(MEMBER_ROLES).optional(),
  ownerId: z.uuid('Invalid owner ID.').optional(),
  // Query values are text, so only the exact words "true" and "false" are accepted.
  isActive: z.enum(['true', 'false'], { error: 'isActive must be true or false.' })
    .transform((v) => v === 'true').optional(),
  q: searchText,
  ...dateRange,
  sort: sortBy(VEHICLE_SORT_FIELDS),
  order,
  ...pagination,
}).superRefine(checkDateRange);
