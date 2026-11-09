// User management request handlers. HTTP only: read the request, call the service, send the response.
// All rules and database access live in services/users.service.js.
import * as usersService from '../services/users.service.js';
import { pageInfo, publicUser, publicVehicle } from '../utils/present.js';

// PATCH /api/users/me: edit your own name.
export async function updateMe(req, res) {
  const user = await usersService.updateProfile(req.user.id, req.body);
  res.json({ user: publicUser(user) });
}

// GET /api/users (admin)
export async function list(req, res) {
  const { users, total } = await usersService.listUsers(req.validQuery);
  res.json({ users, pagination: pageInfo(req.validQuery, total) });
}

// GET /api/users/:id (admin)
export async function getOne(req, res) {
  const { user, vehicles } = await usersService.getUserDetails(req.params.id);
  res.json({ user: publicUser(user), vehicles: vehicles.map(publicVehicle) });
}

// PATCH /api/users/:id/status (admin)
export async function setStatus(req, res) {
  const user = await usersService.setUserStatus(req.user, req.params.id, req.body.status);
  res.json({ user: publicUser(user) });
}
