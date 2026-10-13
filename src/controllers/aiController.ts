import type { NextFunction, Request, Response } from 'express';
import { query } from '../config/database.js';
import { HttpError } from '../middleware/error-handler.js';
import { generateFlashcardsAI, generateJson, generateText } from '../services/aiService.js';
import { recordActivity } from '../services/activityService.js';
import type { ChatInput, SolveInput } from '../schemas/aiSchemas.js';


export const chat = async (req: Request<unknown, unknown, ChatInput>, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
    const { conversationId, message, explainSimply } = req.body;
    const conversation = await query<{ id: string }>('SELECT id FROM conversations WHERE id = $1 AND user_id = $2', [conversationId, req.user.id]);
    if (!conversation.rows[0]) {
      await query('INSERT INTO conversations (id, user_id, title) VALUES ($1, $2, $3)', [conversationId, req.user.id, message.slice(0, 80)]);
    }
    await query("INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', $2)", [conversationId, message]);
    let answer = '';
    try {
      answer = await generateText(`${explainSimply ? 'Explain this simply for a beginner. ' : ''}Answer accurately and show useful reasoning without claiming to be a human tutor:\n\n${message}`, undefined, 'fast');
    } catch (aiError) {
      console.error('[aiController] AI generation failed:', aiError);
      res.status(503).json({ success: false, error: "AI is currently unavailable. Please try again." });
      return;
    }
    await query("INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)", [conversationId, answer]);
    await query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId]);
    void recordActivity(req.user.id, 'chat', message.slice(0, 40), 'AI Chat Query', { conversationId });
    res.json({ conversationId, message: answer, explainSimply });
  } catch (error) {
    next(error);
  }
};

export const solve = async (req: Request<unknown, unknown, SolveInput>, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { question, imageUrl, imageBase64 } = req.body;
    let result;
    try {
      result = await generateJson<{ question: string; formula: string; stepByStepCalculation: string[]; finalAnswer: string; simpleExplanation: string }>(
        `Solve the supplied academic problem. Return JSON with exactly these keys: question (string), formula (string), stepByStepCalculation (array of strings), finalAnswer (string), simpleExplanation (string). Do not use markdown code fences.\n\n${question ?? 'Read the problem from the supplied image.'}`,
        { imageUrl, imageBase64 },
        'pro'
      );
    } catch (aiError) {
      console.error('[aiController] AI generation failed:', aiError);
      res.status(503).json({ success: false, error: "AI is currently unavailable. Please try again." });
      return;
    }
    if (req.user) {
      void recordActivity(req.user.id, 'problem', (question || 'Math / Science Problem').slice(0, 40), 'Problem Solver Query');
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const generateFlashcards = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { topic, text, count } = req.body;
    const content = text || topic;
    if (!content || typeof content !== 'string' || !content.trim()) {
      throw new HttpError(400, 'INVALID_INPUT', 'Topic or text content is required');
    }
    const cards = await generateFlashcardsAI(content.trim(), count ? Number(count) : 8);
    if (req.user) {
      void recordActivity(
        req.user.id,
        'chat',
        `Flashcards: ${topic || content.slice(0, 30)}`.slice(0, 40),
        `${cards.length} Flashcards`
      );
    }
    res.json({ success: true, flashcards: cards });
  } catch (error) {
    next(error);
  }
};

