// Admin dashboard request handlers. HTTP only: read the request, call the service, send the response.
// All queries live in services/admin.service.js.
import * as adminService from '../services/admin.service.js';
import { pageInfo } from '../utils/present.js';

// GET /api/admin/dashboard (admin)
export async function dashboard(req, res) {
  res.json({ stats: await adminService.getDashboardStats() });
}

// GET /api/admin/activities (admin)
export async function activities(req, res) {
  const { activities: list, total } = await adminService.listActivities(req.validQuery);
  res.json({ activities: list, pagination: pageInfo(req.validQuery, total) });
}
