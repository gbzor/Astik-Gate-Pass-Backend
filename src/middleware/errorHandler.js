import { ZodError } from 'zod';
import { HttpError } from '../utils/httpError.js';

export function notFound(req, res) {
  res.status(404).json({ error: { message: 'Not found.' } });
}

// One place that turns every error into a JSON response. Users never see
// stack traces; unexpected errors are logged on the server instead.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        message: 'Please check the highlighted fields.',
        fields: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
    });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { message: err.message } });
  }

  // Bad or oversized JSON body sent by the client.
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: { message: 'The request body is invalid or too large.' } });
  }

  console.error('[error]', req.method, req.originalUrl, err);
  res.status(500).json({ error: { message: 'Something went wrong on our side. Please try again.' } });
}
