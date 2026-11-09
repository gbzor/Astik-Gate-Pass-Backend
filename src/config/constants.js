// Fixed values shared across the backend.

// Who can use the system. "admin" accounts are never created by sign-up.
export const ROLES = Object.freeze(['student', 'faculty', 'admin']);

// Roles a person may choose when signing up.
export const SIGNUP_ROLES = Object.freeze(['student', 'faculty']);

// Account status. Only "active" accounts can sign in.
export const USER_STATUSES = Object.freeze(['active', 'disabled']);

// bcrypt work factor for password hashing. Higher = slower to crack (and to log in).
export const BCRYPT_COST = 12;
