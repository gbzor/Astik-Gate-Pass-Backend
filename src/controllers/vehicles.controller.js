// Vehicle request handlers. HTTP only: read the request, call the service, send the response.
// All rules (ownership, duplicates, limits) and database access live in services/vehicles.service.js.
import * as vehiclesService from '../services/vehicles.service.js';
import { pageInfo, publicVehicle } from '../utils/present.js';

// POST /api/vehicles (student, faculty)
export async function create(req, res) {
  const vehicle = await vehiclesService.registerVehicle(req.user, req.body);
  res.status(201).json({ vehicle: publicVehicle(vehicle) });
}

// GET /api/vehicles/mine (student, faculty)
export async function listMine(req, res) {
  const vehicles = await vehiclesService.listOwnVehicles(req.user.id);
  res.json({ vehicles: vehicles.map(publicVehicle) });
}

// GET /api/vehicles (admin)
export async function list(req, res) {
  const { vehicles, total } = await vehiclesService.listVehicles(req.validQuery);
  res.json({ vehicles: vehicles.map(publicVehicle), pagination: pageInfo(req.validQuery, total) });
}

// GET /api/vehicles/:id (owner or admin)
export async function getOne(req, res) {
  const vehicle = await vehiclesService.getVehicle(req.user, req.params.id);
  res.json({ vehicle: publicVehicle(vehicle) });
}

// PATCH /api/vehicles/:id (owner or admin)
export async function update(req, res) {
  const vehicle = await vehiclesService.updateVehicle(req.user, req.params.id, req.body);
  res.json({ vehicle: publicVehicle(vehicle) });
}

// DELETE /api/vehicles/:id (owner or admin)
export async function remove(req, res) {
  await vehiclesService.deleteVehicle(req.user, req.params.id);
  res.status(204).end();
}
