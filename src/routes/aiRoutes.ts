import { Router } from 'express';
import { chat, generateFlashcards, solve } from '../controllers/aiController.js';
import { usageLimit } from '../middleware/usageLimit.js';
import { validate } from '../middleware/validate.js';
import { chatSchema, solveSchema } from '../schemas/aiSchemas.js';

export const aiRouter = Router();
aiRouter.post('/chat', usageLimit('ai_questions'), validate(chatSchema), chat);
aiRouter.post('/solve', usageLimit('ai_questions'), validate(solveSchema), solve);
aiRouter.post('/generate-flashcards', generateFlashcards);

