// Every input the API accepts is checked here on the server, even if the
// frontend already checked it.
import { z } from 'zod';
import { env } from '../config/env.js';
import {
  EMAIL_MAX_LENGTH,
  LOGIN_PASSWORD_MAX_LENGTH,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  SCHOOL_ID_MAX_LENGTH,
  SCHOOL_ID_MIN_LENGTH,
  SCHOOL_ID_PATTERN,
  SIGNUP_ROLES,
} from '../config/constants.js';
import { personName } from './common.schemas.js';

const email = z.string().trim().toLowerCase().max(EMAIL_MAX_LENGTH).pipe(z.email('Enter a valid email address.'));

const schoolEmail = email.refine((value) => {
  const domain = value.split('@')[1];
  return env.allowedEmailDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
}, `Use your school email (${env.allowedEmailDomains.map((d) => `@${d}`).join(' or ')}).`);

// Letters, numbers and symbols, checked in BYTES at the top end (see PASSWORD_MAX_BYTES).
const newPassword = z.string().min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .refine(
    (v) => Buffer.byteLength(v, 'utf8') <= PASSWORD_MAX_BYTES,
    `Password is too long. Use ${PASSWORD_MAX_BYTES} characters or fewer.`,
  )
  .regex(/[A-Za-z]/, 'Include at least one letter.')
  .regex(/\d/, 'Include at least one number.')
  .regex(/[^A-Za-z0-9]/, 'Include at least one symbol.');

// Student ID or Employee ID.
const schoolId = z.string().trim().toUpperCase()
  .min(SCHOOL_ID_MIN_LENGTH, 'Enter your ID number.')
  .max(SCHOOL_ID_MAX_LENGTH)
  .regex(SCHOOL_ID_PATTERN, 'Use letters, numbers and hyphens only.');

export const registerSchema = z.object({
  role: z.enum(SIGNUP_ROLES, { error: 'Choose Student or Faculty.' }),
  firstName: personName,
  lastName: personName,
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
  password: z.string().min(1, 'Enter your password.').max(LOGIN_PASSWORD_MAX_LENGTH),
});
