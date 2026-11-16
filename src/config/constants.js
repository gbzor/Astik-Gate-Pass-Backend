// Every fixed rule and limit the backend uses lives here, so a value is changed in one place.
// Settings that differ per machine (secrets, URLs, ports) live in .env and src/config/env.js instead.
//
// Values marked "schema.sql" must match the database rules in src/db/schema.sql (owned by the
// database developer). If one changes, ask them to change the database too.

// ─── Roles and statuses ─────────────────────────────────────────────────────────

// Who can use the system. "admin" accounts are never created by sign-up.
export const ROLE = Object.freeze({ STUDENT: 'student', FACULTY: 'faculty', ADMIN: 'admin' });
export const ROLES = Object.freeze(Object.values(ROLE)); // schema.sql

// Students and faculty: they sign up, own vehicles and apply for stickers.
export const MEMBER_ROLES = Object.freeze([ROLE.STUDENT, ROLE.FACULTY]);
// Roles a person may choose when signing up.
export const SIGNUP_ROLES = MEMBER_ROLES;

// Account status. Only "active" accounts can sign in.
export const USER_STATUS = Object.freeze({ ACTIVE: 'active', DISABLED: 'disabled' });
export const USER_STATUSES = Object.freeze(Object.values(USER_STATUS)); // schema.sql

// The two login pages. Each accepts different roles (see services/auth.service.js).
export const LOGIN_PORTAL = Object.freeze({ MEMBER: 'user', ADMIN: 'admin' });

// Campus sticker application statuses (schema.sql).
// pending -> approved, or pending -> rejected. A reviewed application never changes again.
export const STICKER_STATUS = Object.freeze({ PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' });
export const STICKER_STATUSES = Object.freeze(Object.values(STICKER_STATUS));

// Vehicle types a user can register (schema.sql).
export const VEHICLE_TYPES = Object.freeze(['car', 'motorcycle', 'tricycle', 'van', 'other']);

// ─── Accounts and passwords ─────────────────────────────────────────────────────

// bcrypt work factor for password hashing. Higher = slower to crack (and to log in).
export const BCRYPT_COST = 12;

// New passwords: at least this long, with a letter, a number and a symbol.
export const PASSWORD_MIN_LENGTH = 8;
// bcrypt only uses the first 72 BYTES (emoji and accented letters take 2-4 bytes each),
// so longer passwords would be silently cut short. Checked in bytes, not characters.
export const PASSWORD_MAX_BYTES = 72;
// Login form only: stops huge inputs from reaching bcrypt.
export const LOGIN_PASSWORD_MAX_LENGTH = 200;

// First and last names (schema.sql: VARCHAR(60)).
export const NAME_MAX_LENGTH = 60;
export const NAME_PATTERN = /^[\p{L} .'-]+$/u;

// Longest valid email address (RFC 5321; schema.sql: VARCHAR(254)).
export const EMAIL_MAX_LENGTH = 254;

// Student ID or Employee ID (schema.sql: VARCHAR(20)). Stored in capitals.
export const SCHOOL_ID_MIN_LENGTH = 4;
export const SCHOOL_ID_MAX_LENGTH = 20;
export const SCHOOL_ID_PATTERN = /^[A-Z0-9-]+$/;

// ─── Vehicles ───────────────────────────────────────────────────────────────────

// How many vehicles one student or faculty member may register (limits spam/abuse).
export const MAX_VEHICLES_PER_USER = 5;

// Plate numbers, e.g. "ABC 1234" (schema.sql: '^[A-Z0-9 -]{3,15}$'). Stored in capitals.
export const PLATE_NUMBER_MIN_LENGTH = 3;
export const PLATE_NUMBER_MAX_LENGTH = 15;
export const PLATE_NUMBER_PATTERN = /^[A-Z0-9 -]+$/;

// Optional details such as "Toyota", "Vios" or "Pearl White" (schema.sql: VARCHAR sizes).
export const VEHICLE_MAKE_MAX_LENGTH = 40;
export const VEHICLE_MODEL_MAX_LENGTH = 40;
export const VEHICLE_COLOR_MAX_LENGTH = 30;
export const VEHICLE_DETAIL_PATTERN = /^[\p{L}\p{N} .'&/-]*$/u;

// ─── Campus stickers ────────────────────────────────────────────────────────────

// Printed on the physical sticker, e.g. "2026-0001" (schema.sql: VARCHAR(20)). Stored in capitals.
export const STICKER_NUMBER_MAX_LENGTH = 20;
export const STICKER_NUMBER_PATTERN = /^[A-Z0-9-]+$/;

// Longest validity an admin can give a sticker when approving it (about 2 school years).
export const STICKER_MAX_VALIDITY_DAYS = 730;

// Reason shown to the applicant when an application is rejected.
export const REJECTION_REASON_MIN_LENGTH = 3;
export const REJECTION_REASON_MAX_LENGTH = 500;

// The campus time zone (Philippines, UTC+8). A date-only expiry means the end of that day here.
export const CAMPUS_UTC_OFFSET = '+08:00';

export const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Lists, search and sorting ──────────────────────────────────────────────────

// Record lists: default and largest page size (stops one request from dumping every row).
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;
// Highest page number accepted (keeps OFFSET values sane).
export const PAGE_NUMBER_MAX = 100000;

// ?q= search text: letters, numbers and a few punctuation marks only.
export const SEARCH_TEXT_MAX_LENGTH = 100;
export const SEARCH_TEXT_PATTERN = /^[\p{L}\p{N} .@'_-]*$/u;

export const SORT_ORDERS = Object.freeze(['asc', 'desc']);
export const SORT_ORDER_DEFAULT = 'desc';

// Fields each admin list can be sorted by. Every name here must also be in the
// matching SORTABLE map in the service, which turns it into a database column.
export const USER_SORT_FIELDS = Object.freeze(['createdAt', 'lastName', 'firstName', 'email', 'schoolId']);
export const VEHICLE_SORT_FIELDS = Object.freeze(['createdAt', 'plateNumber', 'type', 'make']);
export const STICKER_SORT_FIELDS = Object.freeze(['createdAt', 'reviewedAt', 'status', 'plateNumber', 'stickerNumber', 'expiresAt']);
export const SORT_FIELD_DEFAULT = 'createdAt';

// ─── HTTP and security ──────────────────────────────────────────────────────────

// Largest JSON request body accepted.
export const JSON_BODY_LIMIT = '100kb';

// HTTP methods the frontend may use across origins.
export const CORS_METHODS = Object.freeze(['GET', 'POST', 'PATCH', 'DELETE']);

// Shortest JWT_SECRET the app will start with (checked in src/config/env.js).
export const JWT_SECRET_MIN_LENGTH = 32;
// The only signing algorithm accepted, so a forged token can't pick a weaker one.
export const JWT_ALGORITHM = 'HS256';

// Login session cookie. HttpOnly is always on (see middleware/auth.js).
export const SESSION_COOKIE_NAME = 'gp_session';
export const SESSION_COOKIE_PATH = '/api';
// "strict": not sent on requests from other sites (blocks CSRF).
export const SESSION_COOKIE_SAME_SITE = 'strict';

// Rate limits. The auth limit only counts FAILED sign-ins: everyone on the campus Wi-Fi shares
// one public IP, so counting successful ones would lock the whole school out.
export const API_RATE_LIMIT = Object.freeze({ windowMs: 15 * 60 * 1000, max: 300 });
export const AUTH_RATE_LIMIT = Object.freeze({ windowMs: 15 * 60 * 1000, max: 10 });

// Postgres error codes the services turn into friendly messages.
export const PG_ERROR = Object.freeze({
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  RESTRICT_VIOLATION: '23001',
});
// Deleting a row other tables still point at. Which code Postgres uses depends on the
// foreign key's ON DELETE rule: RESTRICT gives 23001, NO ACTION gives 23503.
export const PG_STILL_REFERENCED = Object.freeze([PG_ERROR.RESTRICT_VIOLATION, PG_ERROR.FOREIGN_KEY_VIOLATION]);

// ─── Notifications ──────────────────────────────────────────────────────────

// SMS providers supported by the notification service.
export const SMS_PROVIDER = Object.freeze({
  CONSOLE: 'console',
  TWILIO: 'twilio',
  ANDROID_GATEWAY: 'android-gateway',
});
export const SMS_PROVIDERS = Object.freeze(Object.values(SMS_PROVIDER));

// Standard single-segment GSM text character limit.
export const SMS_MAX_LENGTH = 160;

// Philippine mobile number format (E.164, schema.sql: VARCHAR(13)).
export const PH_MOBILE_PATTERN = /^\+639\d{9}$/;

