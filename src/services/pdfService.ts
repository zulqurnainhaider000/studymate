import { extractDocumentText } from './documentParserService.js';

export const extractPdfText = async (filePath: string): Promise<string> => {
  return extractDocumentText(filePath, 'application/pdf');
};

