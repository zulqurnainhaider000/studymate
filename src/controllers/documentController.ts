import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { query, withTransaction } from '../config/database.js';
import { HttpError } from '../middleware/error-handler.js';
import { generateFlashcardsAI, generateJson, generateText, type Flashcard } from '../services/aiService.js';
import { extractDocumentText } from '../services/documentParserService.js';
import { extractPdfText } from '../services/pdfService.js';
import { recordActivity } from '../services/activityService.js';
import type { DocumentIdInput } from '../schemas/documentSchemas.js';

const ownedDocument = async (id: string, userId: string) => {
  const result = await query<{ id: string; title: string; extracted_text: string | null }>('SELECT id, title, extracted_text FROM documents WHERE id = $1 AND user_id = $2', [id, userId]);
  const document = result.rows[0];
  if (!document) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');
  if (!document.extracted_text) throw new HttpError(409, 'DOCUMENT_NOT_READY', 'Document text is not available');
  return document;
};

export const list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
    const result = await query<{ id: string; title: string; status: string; created_at: string; extracted_text: string | null; file_size_bytes: string | number | null }>(
      'SELECT id, title, status, created_at, extracted_text, file_size_bytes FROM documents WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id],
    );
    const usageResult = await query<{ documents_used: number }>(
      'SELECT documents_used FROM usage_limits WHERE user_id = $1 AND period_start = CURRENT_DATE',
      [req.user.id],
    );
    const dailyUploadsCount = usageResult.rows[0]?.documents_used ?? 0;

    res.json({
      documents: result.rows.map((document) => ({
        id: document.id,
        title: document.title,
        status: document.status,
        createdAt: document.created_at,
        textLength: document.extracted_text?.length ?? 0,
        fileSizeBytes: document.file_size_bytes ? Number(document.file_size_bytes) : undefined,
      })),
      dailyUploadsCount,
    });
  } catch (error) {
    next(error);
  }
};

export const upload = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
    if (!req.file) throw new HttpError(400, 'FILE_REQUIRED', 'A document file is required');

    const relativePath = `uploads/${req.file.filename}`;
    const originalName = req.file.originalname || 'document';
    const mimeType = req.file.mimetype || 'application/octet-stream';
    const fileSize = req.file.size;

    const inserted = await query<{ id: string; title: string; status: string }>(
      `INSERT INTO documents (user_id, title, storage_path, mime_type, file_size_bytes, status, extracted_text, metadata)
       VALUES ($1, $2, $3, $4, $5, 'processing', NULL, $6) RETURNING id, title, status`,
      [
        req.user.id,
        originalName,
        relativePath,
        mimeType,
        fileSize,
        JSON.stringify({
          originalName,
          size: fileSize,
          mimeType,
        }),
      ],
    );
    const document = inserted.rows[0];
    if (!document) throw new Error('Document insert returned no row');

    try {
      const text = await extractDocumentText(req.file.path, mimeType, originalName);
      const summaryPreview = text.slice(0, 300).trim();

      await query(
        `UPDATE documents
         SET extracted_text = $1,
             status = 'ready',
             metadata = metadata || $2::jsonb,
             updated_at = now()
         WHERE id = $3`,
        [
          text,
          JSON.stringify({
            summary: summaryPreview,
            textLength: text.length,
          }),
          document.id,
        ],
      );

      // Non-blocking daily usage tracking
      let dailyUploadsCount = 1;
      try {
        const usageRes = await query<{ documents_used: number }>(
          `INSERT INTO usage_limits (user_id, period_start, documents_used, documents_limit)
           VALUES ($1, CURRENT_DATE, 1, 1000)
           ON CONFLICT (user_id) DO UPDATE SET
             period_start = CASE WHEN usage_limits.period_start < CURRENT_DATE THEN CURRENT_DATE ELSE usage_limits.period_start END,
             documents_used = CASE WHEN usage_limits.period_start < CURRENT_DATE THEN 1 ELSE usage_limits.documents_used + 1 END,
             updated_at = now()
           RETURNING documents_used`,
          [req.user.id],
        );
        if (usageRes.rows[0]) {
          dailyUploadsCount = usageRes.rows[0].documents_used;
        }
      } catch (trackError) {
        console.warn('[documentController] Non-blocking usage tracking update failed:', trackError);
      }

      res.status(201).json({
        success: true,
        document: {
          id: document.id,
          title: document.title,
          type: mimeType,
          size: fileSize,
          summary: summaryPreview,
          status: 'ready',
          textLength: text.length,
          fileSizeBytes: fileSize,
        },
        id: document.id,
        title: document.title,
        status: 'ready',
        textLength: text.length,
        fileSizeBytes: fileSize,
        dailyUploadsCount,
      });

      let cleanDocName = originalName;
      try { cleanDocName = decodeURIComponent(cleanDocName).replace(/\+/g, ' '); } catch {}
      void recordActivity(req.user.id, 'document', cleanDocName.slice(0, 60), 'Uploaded Document', { documentId: document.id });
    } catch (parseError: unknown) {
      await query("UPDATE documents SET status = 'failed', updated_at = now() WHERE id = $1", [document.id]);
      const errorMessage = parseError instanceof Error ? parseError.message : 'Could not parse document content. Please verify file format.';
      res.status(422).json({
        success: false,
        message: 'Could not parse document content. Please verify file format.',
        error: {
          code: 'DOCUMENT_PARSE_ERROR',
          message: errorMessage,
        },
      });
      return;
    }
  } catch (error) {
    next(error);
  }
};

export const summarize = async (req: Request<DocumentIdInput>, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
    const document = await ownedDocument(req.params.id, req.user.id);
    let result;
    try {
      result = await generateJson<{ summary: string; keyPoints: string[]; examConcepts: string[] }>(`Summarize this study document. Return JSON with exactly summary (short string), keyPoints (array of concise strings), and examConcepts (array of concepts likely to be tested).\n\n${document.extracted_text}`, undefined, 'pro');
    } catch (aiError) {
      console.error('[documentController] AI generation failed:', aiError);
      res.status(503).json({
        error: {
          code: 'AI_SERVICE_UNAVAILABLE',
          message: 'AI summary generation is currently unavailable. Please try again.',
        },
      });
      return;
    }
    void recordActivity(req.user.id, 'document', `Summary: ${document.title}`.slice(0, 40), 'Document Summary', { documentId: document.id });
    res.json({ documentId: document.id, ...result });
  } catch (error) {
    next(error);
  }
};

export const quiz = async (req: Request<DocumentIdInput>, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
    const document = await ownedDocument(req.params.id, req.user.id);
    let generated: { questions?: Array<{ prompt: string; options: string[]; correctAnswer: string; explanation: string }> } | Array<{ prompt: string; options: string[]; correctAnswer: string; explanation: string }> | undefined;
    try {
      const prompt = `Create 5 multiple-choice questions from this document.
Respond with pure JSON only adhering to this structure:
{
  "questions": [
    {
      "prompt": "Question text here?",
      "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
      "correctAnswer": "Option 1",
      "explanation": "Explanation here."
    }
  ]
}
Requirements:
1. Return exactly 5 questions.
2. Each question MUST have exactly 4 options.
3. correctAnswer MUST match one of the 4 options.
4. Do not include markdown code fences or conversational text. Return valid JSON only.

Document text:
${document.extracted_text}`;
      generated = await generateJson(prompt, undefined, 'pro');
    } catch (aiError) {
      console.error('[documentController] AI generation failed:', aiError);
      res.status(503).json({
        error: {
          code: 'AI_SERVICE_UNAVAILABLE',
          message: 'AI quiz generation is currently unavailable. Please try again.',
        },
      });
      return;
    }

    let questionsList = Array.isArray(generated) ? generated : (generated?.questions ?? []);
    if (!Array.isArray(questionsList) || questionsList.length === 0) {
      throw new HttpError(502, 'AI_INVALID_QUIZ', 'The AI provider returned no quiz questions');
    }
    if (questionsList.length > 5) {
      questionsList = questionsList.slice(0, 5);
    }

    const created = await withTransaction(async (client) => {
      const quizResult = await client.query<{ id: string; title: string }>("INSERT INTO quizzes (user_id, document_id, title, question_count) VALUES ($1, $2, $3, $4) RETURNING id, title", [req.user!.id, document.id, `${document.title} Quiz`, questionsList.length]);
      const quizRecord = quizResult.rows[0];
      if (!quizRecord) throw new Error('Quiz insert returned no row');
      for (const [position, question] of questionsList.entries()) {
        const options = Array.isArray(question.options) ? [...question.options] : [];
        if (!options.includes(question.correctAnswer)) {
          if (options.length < 4) options.push(question.correctAnswer);
          else options[0] = question.correctAnswer;
        }
        await client.query('INSERT INTO quiz_questions (quiz_id, position, prompt, options, correct_answer, explanation) VALUES ($1, $2, $3, $4::jsonb, $5, $6)', [quizRecord.id, position, question.prompt, JSON.stringify(options), question.correctAnswer, question.explanation]);
      }
      return quizRecord;
    });
    void recordActivity(req.user.id, 'quiz', `${document.title} Quiz`.slice(0, 40), `${questionsList.length} Questions`, { quizId: created.id, documentId: document.id });
    res.status(201).json({ id: created.id, quizId: created.id, title: created.title, questions: questionsList });
  } catch (error) {
    next(error);
  }
};

export const flashcards = async (req: Request<DocumentIdInput>, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
    const document = await ownedDocument(req.params.id, req.user.id);
    let cards: Flashcard[] = [];
    try {
      cards = await generateFlashcardsAI(document.extracted_text!, 8);
    } catch (aiError) {
      console.error('[documentController] AI flashcard generation failed:', aiError);
      res.status(503).json({
        error: {
          code: 'AI_SERVICE_UNAVAILABLE',
          message: 'AI flashcards generation is currently unavailable. Please try again.',
        },
      });
      return;
    }

    if (!cards || cards.length === 0) {
      throw new HttpError(502, 'AI_INVALID_FLASHCARDS', 'The AI provider returned no flashcards');
    }

    void recordActivity(
      req.user.id,
      'document',
      `${document.title} Flashcards`.slice(0, 40),
      `${cards.length} Flashcards`,
      { documentId: document.id }
    );

    res.json({
      success: true,
      documentId: document.id,
      documentTitle: document.title,
      flashcards: cards,
    });
  } catch (error) {
    next(error);
  }
};


export const getDocument = async (req: Request<DocumentIdInput>, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
    const result = await query<{
      id: string;
      title: string;
      status: string;
      created_at: string;
      extracted_text: string | null;
      file_size_bytes: string | number | null;
      metadata: any;
    }>(
      'SELECT id, title, status, created_at, extracted_text, file_size_bytes, metadata FROM documents WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id],
    );
    const document = result.rows[0];
    if (!document) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');

    res.json({
      id: document.id,
      title: document.title,
      status: document.status,
      createdAt: document.created_at,
      textLength: document.extracted_text?.length ?? 0,
      fileSizeBytes: document.file_size_bytes ? Number(document.file_size_bytes) : undefined,
      extractedText: document.extracted_text,
      summary: document.metadata?.summary,
    });
  } catch (error) {
    next(error);
  }
};

export const remove = async (req: Request<DocumentIdInput>, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
    const result = await query<{ id: string; storage_path: string | null }>(
      'DELETE FROM documents WHERE id = $1 AND user_id = $2 RETURNING id, storage_path',
      [req.params.id, req.user.id],
    );
    const deleted = result.rows[0];
    if (!deleted) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');

    if (deleted.storage_path) {
      const fullPath = path.resolve(process.cwd(), deleted.storage_path);
      try {
        if (fs.existsSync(fullPath)) {
          await fs.promises.unlink(fullPath);
        }
      } catch (fsErr) {
        console.warn('[documentController] Failed to unlink file:', fsErr);
      }
    }

    res.json({ success: true, message: 'Document deleted successfully', id: deleted.id });
  } catch (error) {
    next(error);
  }
};
