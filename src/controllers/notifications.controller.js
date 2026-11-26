// Notification management request handlers (admin).
// HTTP only: parses request, delegates to services/notifications.service.js, sends response.
import * as notificationsService from '../services/notifications.service.js';
import { pageInfo } from '../utils/present.js';

// GET /api/notifications (admin): list notification history with status, channel, recipient filters.
export async function list(req, res) {
  const { notifications, total, page, limit } = await notificationsService.listNotifications(req.validQuery);
  res.json({ notifications, pagination: pageInfo({ page, limit }, total) });
}

// GET /api/notifications/stats (admin): overall delivery counts and pending/sent/failed breakdowns.
export async function stats(req, res) {
  const summary = await notificationsService.getNotificationStats();
  res.json({ stats: summary });
}

// GET /api/notifications/:id (admin): view full details of a single notification.
export async function getOne(req, res) {
  const notification = await notificationsService.getNotificationById(req.params.id);
  res.json({ notification });
}

// POST /api/notifications/:id/retry (admin): retry a failed notification.
export async function retry(req, res) {
  const notification = await notificationsService.retryNotification(req.params.id);
  res.json({ notification });
}
