// All API routes, mounted under /api. See docs/API.md for request and response examples.
//
// Layers: routes -> controllers -> services -> db. Only services may import src/db.
//
// Adding a new feature (vehicles, applications, parking...):
//   1. Create routes/<feature>.routes.js, controllers/<feature>.controller.js
//      and services/<feature>.service.js
//   2. Protect it:   requireAuth, requireRole('admin')   (or 'student', 'faculty')
//   3. Validate it:  validateBody(<schema from validators/>)
//   4. Mount it below.
import { Router } from 'express';
import authRoutes from './auth.routes.js';
import usersRoutes from './users.routes.js';
import vehiclesRoutes from './vehicles.routes.js';
import { health } from '../controllers/health.controller.js';

const router = Router();

router.get('/health', health);
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/vehicles', vehiclesRoutes);

export default router;
