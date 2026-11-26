// /api/notifications: centralized notification management routes for administrators.
// Allows admins to view notification history, review pending/sent/failed statuses,
// monitor delivery statistics, and retry failed deliveries.
import { Router } from 'express';
import * as notificationsCtrl from '../controllers/notifications.controller.js';
import { ROLE } from '../config/constants.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateParams, validateQuery } from '../middleware/validate.js';
import { idParams } from '../validators/common.schemas.js';
import { listNotificationsQuery } from '../validators/notifications.schemas.js';

const router = Router();
const admin = [requireAuth, requireRole(ROLE.ADMIN)];

// "/stats" is declared before "/:id" so it is never matched as a UUID parameter.
router.get('/stats', ...admin, notificationsCtrl.stats);
router.get('/', ...admin, validateQuery(listNotificationsQuery), notificationsCtrl.list);
router.get('/:id', ...admin, validateParams(idParams), notificationsCtrl.getOne);
router.post('/:id/retry', ...admin, validateParams(idParams), notificationsCtrl.retry);

export default router;
