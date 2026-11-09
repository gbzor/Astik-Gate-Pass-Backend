// GET /api/health: public. Also checks the database, so "is the backend working?" has one answer.
// Returns 503 (not the real error) if the database can't be reached.
import { isDatabaseReachable } from '../services/database.service.js';

export async function health(req, res) {
  const ok = await isDatabaseReachable();
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    database: ok ? 'ok' : 'unreachable',
    time: new Date().toISOString(),
  });
}
