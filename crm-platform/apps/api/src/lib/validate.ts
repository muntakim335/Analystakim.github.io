import type { z } from 'zod';
import { AppError } from './errors.js';

/** Parse with zod, converting failures to 422 VALIDATION errors with details. */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(
      'VALIDATION',
      'Invalid request',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    );
  }
  return result.data;
}
