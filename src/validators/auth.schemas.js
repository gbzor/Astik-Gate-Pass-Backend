// Every input the API accepts is checked here on the server, even if the
// frontend already checked it.
import { z } from 'zod';
import { env } from '../config/env.js';
import { SIGNUP_ROLES } from '../config/constants.js';

const name = z.string().trim().min(1, 'Required.').max(60)
  .regex(/^[\p{L} .'-]+$/u, 'Use letters, spaces, periods, apostrophes or hyphens only.');

const email = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address.'));

const schoolEmail = email.refine((value) => {
  const domain = value.split('@')[1];
  return env.allowedEmailDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
}, `Use your school email (${env.allowedEmailDomains.map((d) => `@${d}`).join(' or ')}).`);

// At least 8 characters with letters, numbers and symbols.
// bcrypt only uses the first 72 BYTES (emoji and accented letters take 2-4 bytes each),
// so the limit is checked in bytes to stop longer passwords being silently cut short.
const newPassword = z.string().min(8, 'Use at least 8 characters.')
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Password is too long. Use 72 characters or fewer.')
  .regex(/[A-Za-z]/, 'Include at least one letter.')
  .regex(/\d/, 'Include at least one number.')
  .regex(/[^A-Za-z0-9]/, 'Include at least one symbol.');

// Student ID or Employee ID.
const schoolId = z.string().trim().toUpperCase().min(4, 'Enter your ID number.').max(20)
  .regex(/^[A-Z0-9-]+$/, 'Use letters, numbers and hyphens only.');

export const registerSchema = z.object({
  role: z.enum(SIGNUP_ROLES, { error: 'Choose Student or Faculty.' }),
  firstName: name,
  lastName: name,
  email: schoolEmail,
  schoolId,
  password: newPassword,
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match.',
  path: ['confirmPassword'],
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.').max(200),
});
