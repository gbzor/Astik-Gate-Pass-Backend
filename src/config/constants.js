// Fixed values shared across the backend.

// Who can use the system. "admin" accounts are never created by sign-up.
export const ROLES = Object.freeze(['student', 'faculty', 'admin']);

// Roles a person may choose when signing up.
export const SIGNUP_ROLES = Object.freeze(['student', 'faculty']);

// Account status. Only "active" accounts can sign in.
export const USER_STATUSES = Object.freeze(['active', 'disabled']);

// bcrypt work factor for password hashing. Higher = slower to crack (and to log in).
export const BCRYPT_COST = 12;

// Vehicle types a user can register (must match the CHECK in src/db/schema.sql).
export const VEHICLE_TYPES = Object.freeze(['car', 'motorcycle', 'tricycle', 'van', 'other']);

// How many vehicles one student or faculty member may register (limits spam/abuse).
export const MAX_VEHICLES_PER_USER = 5;

// Record lists: default and largest page size (stops one request from dumping every row).
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;
