// Sticker application request handlers. HTTP only: read the request, call the service, respond.
// All rules (ownership, statuses, duplicates) and database access live in services/stickers.service.js.
import * as stickersService from '../services/stickers.service.js';
import { pageInfo } from '../utils/present.js';

// POST /api/sticker-applications (student, faculty)
export async function submit(req, res) {
  const application = await stickersService.submitApplication(req.user, req.body);
  res.status(201).json({ application });
}

// GET /api/sticker-applications/mine (student, faculty)
export async function listMine(req, res) {
  const applications = await stickersService.listOwnApplications(req.user.id, req.validQuery);
  res.json({ applications });
}

// GET /api/sticker-applications (admin)
export async function list(req, res) {
  const { applications, total } = await stickersService.listApplications(req.validQuery);
  res.json({ applications, pagination: pageInfo(req.validQuery, total) });
}

// GET /api/sticker-applications/:id (applicant or admin)
export async function getOne(req, res) {
  const application = await stickersService.getApplication(req.user, req.params.id);
  res.json({ application });
}

// PATCH /api/sticker-applications/:id/approve (admin)
export async function approve(req, res) {
  const application = await stickersService.approveApplication(req.user, req.params.id, req.body);
  res.json({ application });
}

// PATCH /api/sticker-applications/:id/reject (admin)
export async function reject(req, res) {
  const application = await stickersService.rejectApplication(req.user, req.params.id, req.body);
  res.json({ application });
}
