import type { NextFunction, Request, Response } from 'express';
import { query, withTransaction } from '../config/database.js';
import { HttpError } from '../middleware/error-handler.js';
import { generateJson } from '../services/aiService.js';
import { rewardXp } from '../services/xpService.js';
import { recordActivity } from '../services/activityService.js';

type GenerateBody = { subject: string; topic: string; difficulty: 'easy' | 'medium' | 'hard'; questionCount: number; documentId?: string };
type ResultBody = { quizId?: string; answers: Record<string, string>; timeTakenSeconds: number };
type GeneratedQuestion = { prompt: string; options: string[]; correctAnswer: string; explanation: string };

export const getQuiz = async (req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
    const quiz = await query<{ id: string; title: string }>('SELECT id, title FROM quizzes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!quiz.rows[0]) throw new HttpError(404, 'QUIZ_NOT_FOUND', 'Quiz not found');
    const questions = await query<{ id: string; prompt: string; options: unknown; correct_answer: string; explanation: string | null }>('SELECT id, prompt, options, correct_answer, explanation FROM quiz_questions WHERE quiz_id = $1 ORDER BY position', [req.params.id]);
    res.json({ ...quiz.rows[0], questions: questions.rows.map((question) => ({ id: question.id, prompt: question.prompt, options: question.options, correctAnswer: question.correct_answer, explanation: question.explanation ?? '' })) });
  } catch (error) { next(error); }
};

export const generateQuiz = async (req: Request<unknown, unknown, GenerateBody>, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
    const { subject, topic, difficulty, questionCount, documentId } = req.body;
    let context = `${subject}: ${topic}`;
    if (documentId) {
      const document = await query<{ extracted_text: string | null }>('SELECT extracted_text FROM documents WHERE id = $1 AND user_id = $2', [documentId, req.user.id]);
      if (!document.rows[0]) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');
      context = document.rows[0].extracted_text ?? context;
    }
    let generated: { questions?: GeneratedQuestion[] } | GeneratedQuestion[] | undefined;
    try {
      const prompt = `You are a professional academic quiz designer. Create exactly ${questionCount} ${difficulty} multiple-choice questions based on the following study context.

You MUST respond with pure JSON only adhering to this schema:
{
  "questions": [
    {
      "prompt": "Question prompt here?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": "Option A",
      "explanation": "Explanation of why this answer is correct."
    }
  ]
}

Rules:
1. Return exactly ${questionCount} questions in the "questions" array.
2. Each question MUST contain exactly 4 distinct options.
3. "correctAnswer" MUST be an exact string match to one of the 4 options.
4. Do not include markdown code fences or conversational text. Return valid JSON only.

Context:
${context}`;
      generated = await generateJson<{ questions: GeneratedQuestion[] } | GeneratedQuestion[]>(prompt, undefined, 'pro');
    } catch (aiError) {
      console.error('[quizController] AI generation failed:', aiError);
      res.status(503).json({ success: false, error: "AI is currently unavailable. Please try again." });
      return;
    }

    let rawList: any[] = [];
    if (Array.isArray(generated)) {
      rawList = generated;
    } else if (generated && typeof generated === 'object') {
      const g = generated as Record<string, any>;
      if (Array.isArray(g.questions)) rawList = g.questions;
      else if (Array.isArray(g.quiz)) rawList = g.quiz;
      else if (Array.isArray(g.mcqs)) rawList = g.mcqs;
      else if (Array.isArray(g.data)) rawList = g.data;
      else {
        const arr = Object.values(g).find((val) => Array.isArray(val));
        if (Array.isArray(arr)) rawList = arr as any[];
      }
    }

    let questionsList: GeneratedQuestion[] = rawList
      .map((item: any) => {
        if (!item || typeof item !== 'object') return null;
        const prompt = String(item.prompt || item.question || item.title || '').trim();
        const optionsRaw = Array.isArray(item.options)
          ? item.options
          : Array.isArray(item.choices)
          ? item.choices
          : [];
        const options = optionsRaw.map((opt: unknown) => String(opt).trim()).filter(Boolean);
        const correctAnswer = String(
          item.correctAnswer || item.correct_answer || item.answer || item.correct || options[0] || ''
        ).trim();
        const explanation = String(item.explanation || item.reason || item.description || '').trim();
        if (!prompt || options.length < 2) return null;
        return { prompt, options, correctAnswer, explanation };
      })
      .filter((q): q is GeneratedQuestion => Boolean(q));

    if (!Array.isArray(questionsList) || questionsList.length === 0) {
      throw new HttpError(502, 'AI_INVALID_QUIZ', 'The AI returned an invalid quiz structure');
    }

    if (questionsList.length > questionCount) {
      questionsList = questionsList.slice(0, questionCount);
    }

    const quiz = await withTransaction(async (client) => {
      const quizResult = await client.query<{ id: string; title: string }>('INSERT INTO quizzes (user_id, document_id, title, description, difficulty, question_count) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, title', [req.user!.id, documentId ?? null, `${subject} Quiz`, `Practice quiz for ${topic}`, difficulty, questionsList.length]);
      const created = quizResult.rows[0];
      if (!created) throw new Error('Quiz creation returned no row');
      for (const [position, question] of questionsList.entries()) {
        const options = Array.isArray(question.options) ? [...question.options] : [];
        if (!options.includes(question.correctAnswer)) {
          if (options.length < 4) options.push(question.correctAnswer);
          else options[0] = question.correctAnswer;
        }
        await client.query('INSERT INTO quiz_questions (quiz_id, position, prompt, options, correct_answer, explanation) VALUES ($1, $2, $3, $4::jsonb, $5, $6)', [created.id, position, question.prompt, JSON.stringify(options), question.correctAnswer, question.explanation]);
      }
      return created;
    });
    let cleanTopic = topic;
    try { cleanTopic = decodeURIComponent(cleanTopic).replace(/\+/g, ' '); } catch {}
    void recordActivity(req.user!.id, 'quiz', `${cleanTopic} Quiz`.slice(0, 60), `${questionsList.length} Questions`, { quizId: quiz.id, difficulty });
    res.status(201).json({ ...quiz, questions: questionsList });
  } catch (error) { next(error); }
};

export const submitQuizResult = async (req: Request<{ id: string }, unknown, ResultBody>, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
    const quizId = req.params.id || req.body.quizId;
    if (!quizId) throw new HttpError(400, 'QUIZ_ID_REQUIRED', 'Quiz ID is required');
    const quiz = await query<{ id: string; total_questions: number; title?: string }>('SELECT id, question_count AS total_questions, title FROM quizzes WHERE id = $1 AND user_id = $2', [quizId, req.user.id]);
    if (!quiz.rows[0]) throw new HttpError(404, 'QUIZ_NOT_FOUND', 'Quiz not found');
    const questions = await query<{ id: string; correct_answer: string }>('SELECT id, correct_answer FROM quiz_questions WHERE quiz_id = $1 ORDER BY position', [quizId]);
    const score = questions.rows.reduce((total, question) => total + (req.body.answers[question.id] === question.correct_answer ? 1 : 0), 0);
    const xp = await rewardXp(req.user.id, 'quiz');
    await query('INSERT INTO quiz_results (quiz_id, user_id, score, total_questions, answers) VALUES ($1, $2, $3, $4, $5::jsonb)', [quizId, req.user.id, score, questions.rows.length, JSON.stringify(req.body.answers)]);
    let cleanQuizTitle = quiz.rows[0]?.title || 'Practice Quiz';
    try { cleanQuizTitle = decodeURIComponent(cleanQuizTitle).replace(/\+/g, ' '); } catch {}
    void recordActivity(req.user.id, 'quiz', `${cleanQuizTitle}`.slice(0, 60), `Score: ${score}/${questions.rows.length} (${Math.round((score / Math.max(questions.rows.length, 1)) * 100)}%)`, { quizId, score });
    res.status(201).json({ score, totalQuestions: questions.rows.length, percentage: Math.round((score / Math.max(questions.rows.length, 1)) * 100), correct: score, wrong: questions.rows.length - score, timeTakenSeconds: req.body.timeTakenSeconds, xpEarned: 20, totalXp: xp });
  } catch (error) { next(error); }
};
