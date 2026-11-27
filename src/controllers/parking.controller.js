// Parking request handlers. HTTP only: read the request, call the service, send the response.
// All rules (stickers, capacity, ownership) and database access live in services/parking.service.js.
import * as parkingService from '../services/parking.service.js';
import { pageInfo } from '../utils/present.js';

// ─── Areas ──────────────────────────────────────────────────────────────────────

// GET /api/parking/areas (any signed-in user; students and faculty see active areas only)
export async function listAreas(req, res) {
  const { areas, total } = await parkingService.listAreas(req.user, req.validQuery);
  res.json({ areas, pagination: pageInfo(req.validQuery, total) });
}

// GET /api/parking/areas/:id (any signed-in user)
export async function getArea(req, res) {
  res.json({ area: await parkingService.getArea(req.user, req.params.id) });
}

// POST /api/parking/areas (admin)
export async function createArea(req, res) {
  res.status(201).json({ area: await parkingService.createArea(req.body) });
}

// PATCH /api/parking/areas/:id (admin)
export async function updateArea(req, res) {
  res.json({ area: await parkingService.updateArea(req.params.id, req.body) });
}

// PATCH /api/parking/areas/:id/deactivate (admin)
export async function deactivateArea(req, res) {
  res.json({ area: await parkingService.setAreaActive(req.params.id, false) });
}

// PATCH /api/parking/areas/:id/activate (admin)
export async function activateArea(req, res) {
  res.json({ area: await parkingService.setAreaActive(req.params.id, true) });
}

// ─── Entry and exit ─────────────────────────────────────────────────────────────

// POST /api/parking/entry (PARKING_RECORDER_ROLES)
export async function entry(req, res) {
  res.status(201).json({ record: await parkingService.recordEntry(req.body) });
}

// POST /api/parking/exit (PARKING_RECORDER_ROLES)
export async function exit(req, res) {
  res.json({ record: await parkingService.recordExit(req.body) });
}

// ─── Records and history ────────────────────────────────────────────────────────

function sendRecords(req, res, { records, total }) {
  res.json({ records, pagination: pageInfo(req.validQuery, total) });
}

// GET /api/parking/records (admin)
export async function listRecords(req, res) {
  sendRecords(req, res, await parkingService.listRecords(req.validQuery));
}

// GET /api/parking/current (admin)
export async function current(req, res) {
  sendRecords(req, res, await parkingService.listCurrentlyParked(req.validQuery));
}

// GET /api/parking/records/:id (admin, or the record's owner)
export async function getRecord(req, res) {
  res.json({ record: await parkingService.getRecord(req.user, req.params.id) });
}

// GET /api/parking/history/me (any signed-in user)
export async function myHistory(req, res) {
  sendRecords(req, res, await parkingService.myHistory(req.user, req.validQuery));
}

// GET /api/parking/history/user/:id (admin, or that user)
export async function userHistory(req, res) {
  sendRecords(req, res, await parkingService.userHistory(req.user, req.params.id, req.validQuery));
}

// GET /api/parking/history/vehicle/:id (admin, or the vehicle's owner)
export async function vehicleHistory(req, res) {
  sendRecords(req, res, await parkingService.vehicleHistory(req.user, req.params.id, req.validQuery));
}
