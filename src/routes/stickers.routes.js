// /api/sticker-applications: students and faculty apply for campus stickers for their own
// vehicles; admins review (approve or reject) every application.
// Ownership of a single application is checked in services/stickers.service.js.
import { Router } from 'express';
import * as stickersCtrl from '../controllers/stickers.controller.js';
import { MEMBER_ROLES, ROLE, ROLES } from '../config/constants.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import { idParams } from '../validators/common.schemas.js';
import {
  approveApplicationSchema,
  listApplicationsQuery,
  listMyApplicationsQuery,
  rejectApplicationSchema,
  submitApplicationSchema,
  triggerRemindersSchema,
} from '../validators/stickers.schemas.js';

const router = Router();
const applicants = [requireAuth, requireRole(...MEMBER_ROLES)];
const admin = [requireAuth, requireRole(ROLE.ADMIN)];

router.post('/', ...applicants, validateBody(submitApplicationSchema), stickersCtrl.submit);
// "/mine" and "/reminders" are declared before "/:id" so they are never read as an ID.
router.get('/mine', ...applicants, validateQuery(listMyApplicationsQuery), stickersCtrl.listMine);
router.post('/reminders', ...admin, validateBody(triggerRemindersSchema), stickersCtrl.triggerReminders);

router.get('/', ...admin, validateQuery(listApplicationsQuery), stickersCtrl.list);
router.get('/:id', requireAuth, requireRole(...ROLES), validateParams(idParams), stickersCtrl.getOne);
router.patch('/:id/approve', ...admin, validateParams(idParams), validateBody(approveApplicationSchema), stickersCtrl.approve);
router.patch('/:id/reject', ...admin, validateParams(idParams), validateBody(rejectApplicationSchema), stickersCtrl.reject);

export default router;
