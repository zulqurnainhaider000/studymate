import { z } from 'zod';

const emptyObject = z.object({});
const imageInput = z.string().min(1).max(15_000_000);

export const chatSchema = z.object({
  body: z.object({
    conversationId: z.uuid(),
    message: z.string().trim().min(1).max(20_000),
    explainSimply: z.boolean().default(false),
  }),
  params: emptyObject,
  query: emptyObject,
});

export const solveSchema = z.object({
  body: z.object({
    question: z.string().trim().min(1).max(20_000).optional(),
    imageUrl: imageInput.optional(),
    imageBase64: imageInput.optional(),
  }).refine((body) => Boolean(body.question || body.imageUrl || body.imageBase64), { message: 'question, imageUrl, or imageBase64 is required' }),
  params: emptyObject,
  query: emptyObject,
});

export type ChatInput = z.infer<typeof chatSchema>['body'];
export type SolveInput = z.infer<typeof solveSchema>['body'];
