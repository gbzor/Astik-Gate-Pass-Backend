import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { apiLimiter } from './middleware/rateLimits.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  // Needed behind a host like Render or Railway so rate limits see the real visitor IP.
  if (env.trustProxy) app.set('trust proxy', 1);

  // Security headers (CSP, HSTS, X-Content-Type-Options, and more).
  app.use(helmet());

  // Only the listed frontend origins may call the API with cookies (never "*").
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin.toLowerCase())),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  }));

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', apiLimiter, routes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
