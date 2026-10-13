import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { list, upload, summarize, quiz, getDocument, remove, flashcards } from '../controllers/documentController.js';
import { HttpError } from '../middleware/error-handler.js';
import { validate } from '../middleware/validate.js';
import { documentIdSchema } from '../schemas/documentSchemas.js';

const uploadDirectory = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDirectory)) {
  fs.mkdirSync(uploadDirectory, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    try {
      if (!fs.existsSync(uploadDirectory)) {
        fs.mkdirSync(uploadDirectory, { recursive: true });
      }
      callback(null, uploadDirectory);
    } catch (error) {
      callback(error as Error, uploadDirectory);
    }
  },
  filename: (_req, file, callback) => {
    const safeName = file.originalname ? file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_') : 'document.pdf';
    callback(null, `${crypto.randomUUID()}-${safeName}`);
  },
});

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/x-pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.txt',
  '.md',
  '.csv',
  '.xls',
  '.xlsx',
]);

const documentUpload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    const isAllowedMime = ALLOWED_MIME_TYPES.has(mime) || mime.startsWith('text/');
    const isAllowedExt = ALLOWED_EXTENSIONS.has(ext);

    if (!isAllowedMime && !isAllowedExt) {
      callback(new HttpError(400, 'UNSUPPORTED_FILE_TYPE', 'Only PDF, Word, Excel, CSV, and Plain Text files are supported.'));
      return;
    }
    callback(null, true);
  },
});

export const documentRouter = Router();
documentRouter.get('/', list);
documentRouter.get('/:id', validate(documentIdSchema), getDocument);
documentRouter.post('/upload', documentUpload.single('file'), upload);
documentRouter.post('/:id/summarize', validate(documentIdSchema), summarize);
documentRouter.post('/:id/quiz', validate(documentIdSchema), quiz);
documentRouter.post('/:id/flashcards', validate(documentIdSchema), flashcards);
documentRouter.get('/:id/flashcards', validate(documentIdSchema), flashcards);
documentRouter.delete('/:id', validate(documentIdSchema), remove);

