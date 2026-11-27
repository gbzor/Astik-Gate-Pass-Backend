// /api/parking: parking areas, vehicle entry/exit, parking records and history.
// Every route needs a signed-in user. Ownership of records, vehicles and history is
// checked in services/parking.service.js (other people's data answers 404).
import { Router } from 'express';
import * as parkingCtrl from '../controllers/parking.controller.js';
import { PARKING_RECORDER_ROLES, ROLE, ROLES } from '../config/constants.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import { idParams } from '../validators/common.schemas.js';
import {
  createAreaSchema,
  currentQuery,
  entrySchema,
  exitSchema,
  historyQuery,
  listAreasQuery,
  listRecordsQuery,
  updateAreaSchema,
} from '../validators/parking.schemas.js';

const router = Router();
const anyone = [requireAuth, requireRole(...ROLES)];
const admin = [requireAuth, requireRole(ROLE.ADMIN)];
const recorder = [requireAuth, requireRole(...PARKING_RECORDER_ROLES)];

// Areas: everyone can view (for the map and availability); only admins manage them.
router.get('/areas', ...anyone, validateQuery(listAreasQuery), parkingCtrl.listAreas);
router.get('/areas/:id', ...anyone, validateParams(idParams), parkingCtrl.getArea);
router.post('/areas', ...admin, validateBody(createAreaSchema), parkingCtrl.createArea);
router.patch('/areas/:id', ...admin, validateParams(idParams), validateBody(updateAreaSchema), parkingCtrl.updateArea);
router.patch('/areas/:id/deactivate', ...admin, validateParams(idParams), parkingCtrl.deactivateArea);
router.patch('/areas/:id/activate', ...admin, validateParams(idParams), parkingCtrl.activateArea);

// Entry and exit at the gate.
router.post('/entry', ...recorder, validateBody(entrySchema), parkingCtrl.entry);
router.post('/exit', ...recorder, validateBody(exitSchema), parkingCtrl.exit);

// Records and the vehicles on campus right now (admin).
router.get('/records', ...admin, validateQuery(listRecordsQuery), parkingCtrl.listRecords);
router.get('/records/:id', ...anyone, validateParams(idParams), parkingCtrl.getRecord);
router.get('/current', ...admin, validateQuery(currentQuery), parkingCtrl.current);

// History. "/me" is declared before the ":id" routes so it is never read as an ID.
router.get('/history/me', ...anyone, validateQuery(historyQuery), parkingCtrl.myHistory);
router.get('/history/user/:id', ...anyone, validateParams(idParams), validateQuery(historyQuery), parkingCtrl.userHistory);
router.get('/history/vehicle/:id', ...anyone, validateParams(idParams), validateQuery(historyQuery), parkingCtrl.vehicleHistory);

export default router;
