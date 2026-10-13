import type { RequestHandler } from 'express';
import type { z } from 'zod';

export const validate = (schema: z.ZodType): RequestHandler => (req, _res, next) => {
  const result = schema.safeParse({
    body: req.body ?? {},
    params: req.params ?? {},
    query: req.query ?? {},
  });
  if (!result.success) {
    next(result.error);
    return;
  }
  const parsed = result.data as { body?: unknown; params?: unknown; query?: unknown };
  if (parsed.body !== undefined) req.body = parsed.body;
  if (parsed.params !== undefined) req.params = parsed.params as typeof req.params;
  next();
};
