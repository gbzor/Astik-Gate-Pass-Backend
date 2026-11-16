import { rateLimit } from 'express-rate-limit';
import { API_RATE_LIMIT, AUTH_RATE_LIMIT } from '../config/constants.js';

const message = (text) => ({ error: { message: text } });
const minutes = (ms) => Math.round(ms / 60000);
// Automated tests send many requests quickly, so limits are off only when NODE_ENV=test.
const skip = () => process.env.NODE_ENV === 'test';

// General limit for the whole API.
export const apiLimiter = rateLimit({
  windowMs: API_RATE_LIMIT.windowMs,
  limit: API_RATE_LIMIT.max,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  message: message('Too many requests. Please try again in a few minutes.'),
});

// Stricter limit for sign-in and sign-up, to slow down password guessing.
// Only FAILED attempts count (see AUTH_RATE_LIMIT in constants.js for why).
export const authLimiter = rateLimit({
  windowMs: AUTH_RATE_LIMIT.windowMs,
  limit: AUTH_RATE_LIMIT.max,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  message: message(`Too many attempts. Please wait ${minutes(AUTH_RATE_LIMIT.windowMs)} minutes and try again.`),
});
