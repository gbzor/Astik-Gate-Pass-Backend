// /api/admin: the admin dashboard's summary counts and recent activities. Admins only.
// The admin record lists themselves stay with their features: /api/users, /api/vehicles
// and /api/sticker-applications.
import { Router } from 'express';
import * as adminCtrl from '../controllers/admin.controller.js';
import { ROLE } from '../config/constants.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validate.js';
import { listActivitiesQuery } from '../validators/admin.schemas.js';

const router = Router();

// Every route below needs a signed-in admin.
router.use(requireAuth, requireRole(ROLE.ADMIN));

router.get('/dashboard', adminCtrl.dashboard);
router.get('/activities', validateQuery(listActivitiesQuery), adminCtrl.activities);

export default router;
