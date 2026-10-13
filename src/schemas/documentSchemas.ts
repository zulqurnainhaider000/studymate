import { z } from 'zod';

export const documentIdSchema = z.object({
  body: z.unknown().optional(),
  params: z.object({ id: z.uuid() }),
  query: z.unknown().optional(),
});

export type DocumentIdInput = z.infer<typeof documentIdSchema>['params'];
