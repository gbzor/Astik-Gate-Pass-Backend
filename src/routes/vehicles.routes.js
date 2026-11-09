// /api/vehicles: students and faculty manage their own vehicles; admins manage all of them.
// Ownership of a single vehicle is checked in services/vehicles.service.js.
import { Router } from 'express';
import * as vehiclesCtrl from '../controllers/vehicles.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import { idParams } from '../validators/common.schemas.js';
import { createVehicleSchema, listVehiclesQuery, updateVehicleSchema } from '../validators/vehicles.schemas.js';

const router = Router();
const owners = [requireAuth, requireRole('student', 'faculty')];
const ownerOrAdmin = [requireAuth, requireRole('student', 'faculty', 'admin')];

router.post('/', ...owners, validateBody(createVehicleSchema), vehiclesCtrl.create);
// "/mine" is declared before "/:id" so it is never read as an ID.
router.get('/mine', ...owners, vehiclesCtrl.listMine);

router.get('/', requireAuth, requireRole('admin'), validateQuery(listVehiclesQuery), vehiclesCtrl.list);
router.get('/:id', ...ownerOrAdmin, validateParams(idParams), vehiclesCtrl.getOne);
router.patch('/:id', ...ownerOrAdmin, validateParams(idParams), validateBody(updateVehicleSchema), vehiclesCtrl.update);
router.delete('/:id', ...ownerOrAdmin, validateParams(idParams), vehiclesCtrl.remove);

export default router;
