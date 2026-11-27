// Inputs for the parking routes (/api/parking): areas, entry/exit, records and history.
import { z } from 'zod';
import {
  COORDINATE_DECIMALS,
  LATITUDE_MAX,
  LATITUDE_MIN,
  LONGITUDE_MAX,
  LONGITUDE_MIN,
  PARKING_AREA_CAPACITY_MAX,
  PARKING_AREA_NAME_MAX_LENGTH,
  PARKING_AREA_NAME_PATTERN,
  PARKING_AREA_SORT_DEFAULT,
  PARKING_AREA_SORT_FIELDS,
  PARKING_RECORD_SORT_DEFAULT,
  PARKING_RECORD_SORT_FIELDS,
  PARKING_STATUSES,
  SORT_ORDERS,
} from '../config/constants.js';
import {
  checkDateRange, dateRange, order, pagination, searchText,
} from './common.schemas.js';
import { plateNumber } from './vehicles.schemas.js';

// ─── Parking areas ──────────────────────────────────────────────────────────────

// "  main   gate lot " becomes "main gate lot". Uniqueness ignores case (schema.sql).
const areaName = z.string().trim()
  .transform((v) => v.replace(/\s+/g, ' '))
  .pipe(z.string()
    .min(1, 'Enter the parking area name.')
    .max(PARKING_AREA_NAME_MAX_LENGTH, `Use ${PARKING_AREA_NAME_MAX_LENGTH} characters or fewer.`)
    .regex(PARKING_AREA_NAME_PATTERN, 'Use letters, numbers, spaces and . , \' ( ) & / # - only.'));

// A map coordinate. The database keeps 6 decimal places, so it is rounded to that here.
const scale = 10 ** COORDINATE_DECIMALS;
const coordinate = (min, max, label) => z.number({ error: `Enter the ${label} as a number.` })
  .min(min, `The ${label} must be between ${min} and ${max}.`)
  .max(max, `The ${label} must be between ${min} and ${max}.`)
  .transform((v) => Math.round(v * scale) / scale);

const latitude = coordinate(LATITUDE_MIN, LATITUDE_MAX, 'latitude');
const longitude = coordinate(LONGITUDE_MIN, LONGITUDE_MAX, 'longitude');

const capacity = z.number({ error: 'Enter the capacity as a whole number.' })
  .int('Enter the capacity as a whole number.')
  .min(1, 'The capacity must be at least 1.')
  .max(PARKING_AREA_CAPACITY_MAX, `The capacity can be at most ${PARKING_AREA_CAPACITY_MAX}.`);

// POST /api/parking/areas (admin)
export const createAreaSchema = z.object({
  name: areaName,
  latitude,
  longitude,
  capacity,
});

// PATCH /api/parking/areas/:id (admin): send only the fields that change.
// Deactivating and reactivating have their own routes.
export const updateAreaSchema = z.object({
  name: areaName.optional(),
  latitude: latitude.optional(),
  longitude: longitude.optional(),
  capacity: capacity.optional(),
}).refine((d) => Object.values(d).some((v) => v !== undefined), {
  message: 'Send at least one field to update.',
});

// Query values are text, so only the exact words "true" and "false" are accepted.
const booleanText = (name) => z.enum(['true', 'false'], { error: `${name} must be true or false.` })
  .transform((v) => v === 'true');

// GET /api/parking/areas?isActive=true&q=gate&sort=name&order=asc&page=1&limit=20
// isActive only applies to admins; students and faculty always see active areas only.
export const listAreasQuery = z.object({
  isActive: booleanText('isActive').optional(),
  q: searchText,
  sort: z.enum(PARKING_AREA_SORT_FIELDS).default(PARKING_AREA_SORT_DEFAULT),
  order: z.enum(SORT_ORDERS).default('asc'), // A to Z by name
  ...pagination,
});

// ─── Entry and exit ─────────────────────────────────────────────────────────────

// Which vehicle: its ID (from a list) or its plate number (typed at the gate). Exactly one.
const vehicleFields = {
  vehicleId: z.uuid('Invalid vehicle ID.').optional(),
  plateNumber: plateNumber.optional(),
};
const exactlyOneVehicle = (d, ctx) => {
  if ((d.vehicleId === undefined) === (d.plateNumber === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['plateNumber'], message: 'Send either vehicleId or plateNumber (not both).' });
  }
};

// POST /api/parking/entry (admin)
export const entrySchema = z.object({
  ...vehicleFields,
  parkingAreaId: z.uuid('Choose a parking area.'),
}).superRefine(exactlyOneVehicle);

// POST /api/parking/exit (admin)
export const exitSchema = z.object(vehicleFields).superRefine(exactlyOneVehicle);

// ─── Records, current vehicles and history ──────────────────────────────────────

const status = z.enum(PARKING_STATUSES, { error: `Status must be one of: ${PARKING_STATUSES.join(', ')}.` });
const recordSort = z.enum(PARKING_RECORD_SORT_FIELDS).default(PARKING_RECORD_SORT_DEFAULT);

// from/to: records where the vehicle was on campus at any time in that range.
const recordFilters = {
  status: status.optional(),
  parkingAreaId: z.uuid('Invalid parking area ID.').optional(),
  ...dateRange,
  sort: recordSort,
  order,
  ...pagination,
};

// GET /api/parking/records (admin)
export const listRecordsQuery = z.object({
  ...recordFilters,
  vehicleId: z.uuid('Invalid vehicle ID.').optional(),
  userId: z.uuid('Invalid user ID.').optional(),
  q: searchText,
}).superRefine(checkDateRange);

// GET /api/parking/history/me, /history/vehicle/:id, /history/user/:id
export const historyQuery = z.object(recordFilters).superRefine(checkDateRange);

// GET /api/parking/current (admin): vehicles still on campus.
export const currentQuery = z.object({
  parkingAreaId: z.uuid('Invalid parking area ID.').optional(),
  q: searchText,
  sort: recordSort,
  order,
  ...pagination,
});
