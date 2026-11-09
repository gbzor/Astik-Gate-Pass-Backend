import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimits.js';
import { validateBody } from '../middleware/validate.js';
import { loginSchema, registerSchema } from '../validators/auth.schemas.js';

const router = Router();

router.post('/register', authLimiter, validateBody(registerSchema), auth.register);
router.post('/login', authLimiter, validateBody(loginSchema), auth.login);
router.post('/admin/login', authLimiter, validateBody(loginSchema), auth.adminLogin);
router.post('/logout', auth.logout);
router.get('/me', requireAuth, auth.me);

export default router;
