// Inputs for the vehicle routes (/api/vehicles).
import { z } from 'zod';
import { VEHICLE_TYPES } from '../config/constants.js';
import { order, pagination, searchText } from './common.schemas.js';

// Plate numbers are stored in one standard form ("abc  1234" becomes "ABC 1234"),
// so the same plate can't be registered twice with different spacing or case.
// The format matches the CHECK rule in src/db/schema.sql.
const plateNumber = z.string().trim().toUpperCase()
  .transform((v) => v.replace(/\s+/g, ' '))
  .pipe(z.string()
    .min(3, 'Enter the plate number.')
    .max(15, 'Use 15 characters or fewer.')
    .regex(/^[A-Z0-9 -]+$/, 'Use letters, numbers, spaces and hyphens only.')
    .regex(/[A-Z0-9].*[A-Z0-9]/, 'Enter a valid plate number.'));

const type = z.enum(VEHICLE_TYPES, { error: `Choose one of: ${VEHICLE_TYPES.join(', ')}.` });

// Optional text such as "Toyota", "Vios" or "Pearl White". null clears the value.
const detail = (max) => z.string().trim().max(max)
  .regex(/^[\p{L}\p{N} .'&/-]*$/u, 'Use letters, numbers, spaces and . \' & / - only.')
  .transform((v) => v || null)
  .nullable()
  .optional();

// POST /api/vehicles
export const createVehicleSchema = z.object({
  plateNumber,
  type,
  make: detail(40),
  model: detail(40),
  color: detail(30),
});

// PATCH /api/vehicles/:id: send only the fields that change.
export const updateVehicleSchema = z.object({
  plateNumber: plateNumber.optional(),
  type: type.optional(),
  make: detail(40),
  model: detail(40),
  color: detail(30),
}).refine((d) => Object.values(d).some((v) => v !== undefined), {
  message: 'Send at least one field to update.',
});

// GET /api/vehicles?type=car&ownerRole=student&q=abc&page=1&limit=20&sort=plateNumber&order=asc
export const listVehiclesQuery = z.object({
  type: type.optional(),
  ownerRole: z.enum(['student', 'faculty']).optional(),
  ownerId: z.uuid('Invalid owner ID.').optional(),
  q: searchText,
  sort: z.enum(['createdAt', 'plateNumber', 'type', 'make']).default('createdAt'),
  order,
  ...pagination,
});
