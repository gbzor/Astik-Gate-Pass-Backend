// /api/users: profile editing (any signed-in user) and user records (admin only).
import { Router } from 'express';
import * as usersCtrl from '../controllers/users.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import { idParams } from '../validators/common.schemas.js';
import { listUsersQuery, updateProfileSchema, updateStatusSchema } from '../validators/users.schemas.js';

const router = Router();
const admin = [requireAuth, requireRole('admin')];

// "/me" is declared before "/:id" so it is never read as an ID.
router.patch('/me', requireAuth, validateBody(updateProfileSchema), usersCtrl.updateMe);

router.get('/', ...admin, validateQuery(listUsersQuery), usersCtrl.list);
router.get('/:id', ...admin, validateParams(idParams), usersCtrl.getOne);
router.patch('/:id/status', ...admin, validateParams(idParams), validateBody(updateStatusSchema), usersCtrl.setStatus);

export default router;
