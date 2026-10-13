import { Router } from 'express';
import { generateQuiz, getQuiz, submitQuizResult } from '../controllers/quizController.js';
import { validate } from '../middleware/validate.js';
import { usageLimit } from '../middleware/usageLimit.js';
import { z } from 'zod';

const generateSchema = z.object({
  body: z.object({
    subject: z.string().trim().min(1).max(100),
    topic: z.string().trim().min(1).max(200),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    questionCount: z.number().int().min(1).max(20),
    documentId: z.uuid().optional(),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

const resultSchema = z.object({
  body: z.object({
    quizId: z.uuid(),
    answers: z.record(z.string(), z.string()),
    timeTakenSeconds: z.number().int().min(0).max(86_400),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

export const quizRouter = Router();
quizRouter.post('/generate', usageLimit('ai_questions'), validate(generateSchema), generateQuiz);
quizRouter.get('/:id', validate(z.object({ body: z.unknown().optional(), params: z.object({ id: z.uuid() }), query: z.unknown().optional() })), getQuiz);
quizRouter.post('/result', validate(resultSchema), submitQuizResult);
