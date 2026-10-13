import fs from 'node:fs/promises';
import path from 'node:path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import XLSX from 'xlsx';

export const extractDocumentText = async (
  filePath: string,
  mimeType?: string,
  originalName?: string,
): Promise<string> => {
  const ext = path.extname(originalName || filePath).toLowerCase();
  const mime = (mimeType || '').toLowerCase();

  try {
    // 1. PDF Documents
    if (ext === '.pdf' || mime.includes('pdf')) {
      const buffer = await fs.readFile(filePath);
      const parsed = await pdfParse(buffer);
      const text = (parsed?.text ?? '').trim();
      if (!text) {
        throw new Error('No readable text found in PDF. The document may be scanned, image-only, or empty.');
      }
      return text;
    }

    // 2. Microsoft Word Documents (.docx, .doc)
    if (
      ext === '.docx' ||
      ext === '.doc' ||
      mime.includes('wordprocessingml') ||
      mime.includes('msword')
    ) {
      const result = await mammoth.extractRawText({ path: filePath });
      const text = (result?.value ?? '').trim();
      if (!text) {
        throw new Error('No readable text found in Word document.');
      }
      return text;
    }

    // 3. Excel Spreadsheets (.xlsx, .xls)
    if (
      ext === '.xlsx' ||
      ext === '.xls' ||
      mime.includes('spreadsheetml') ||
      mime.includes('ms-excel')
    ) {
      const workbook = XLSX.readFile(filePath);
      const sheetTexts: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (sheet) {
          const csv = XLSX.utils.sheet_to_csv(sheet).trim();
          if (csv) {
            sheetTexts.push(`--- Sheet: ${sheetName} ---\n${csv}`);
          }
        }
      }
      const combined = sheetTexts.join('\n\n').trim();
      if (!combined) {
        throw new Error('No readable table data found in Excel workbook.');
      }
      return combined;
    }

    // 4. Plain Text, CSV, Markdown (.txt, .csv, .md)
    if (
      ext === '.txt' ||
      ext === '.csv' ||
      ext === '.md' ||
      mime.startsWith('text/') ||
      mime.includes('csv')
    ) {
      const raw = await fs.readFile(filePath, 'utf8');
      const text = raw.trim();
      if (!text) {
        throw new Error('The uploaded text file is empty.');
      }
      return text;
    }

    // Fallback: Attempt UTF-8 text extraction
    const fallbackRaw = await fs.readFile(filePath, 'utf8');
    const fallbackText = fallbackRaw.trim();
    if (fallbackText) {
      return fallbackText;
    }

    throw new Error(`Unsupported document format: ${ext || mime || 'unknown'}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown parsing error';
    throw new Error(`Failed to extract text from document: ${message}`);
  }
};
