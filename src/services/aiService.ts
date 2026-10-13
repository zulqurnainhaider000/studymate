import OpenAI from 'openai';
import { HttpError } from '../middleware/error-handler.js';

type ImageInput = { imageUrl?: string; imageBase64?: string };

const isConfiguredKey = (value: string | undefined): value is string =>
  Boolean(value && !/^(your_|sk-your|replace-with|change-me)/i.test(value));

const getApiKey = (): string | undefined => {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (isConfiguredKey(openRouterKey)) return openRouterKey;
  const openAiKey = process.env.OPENAI_API_KEY;
  if (isConfiguredKey(openAiKey)) return openAiKey;
  return undefined;
};

export const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || 'not-configured',
  defaultHeaders: {
    'HTTP-Referer': 'http://localhost:5000',
    'X-Title': 'StudyMate AI',
  },
});

const getClient = (): OpenAI => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new HttpError(
      503,
      'AI_NOT_CONFIGURED',
      'OpenRouter API key is not configured. Please set a valid OPENROUTER_API_KEY in backend/.env.'
    );
  }

  return new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
    defaultHeaders: {
      'HTTP-Referer': 'http://localhost:5000',
      'X-Title': 'StudyMate AI',
    },
  });
};

const getModel = (): string => {
  return process.env.AI_MODEL || 'openai/gpt-4o-mini';
};

const mockChatResponse = (prompt: string): string =>
  `Local mock response: I received your question about "${prompt.slice(0, 160)}". Please configure a valid OPENROUTER_API_KEY in backend/.env for AI-generated answers.`;

const buildUserContent = (prompt: string, input?: ImageInput) => {
  if (!input || (!input.imageUrl && !input.imageBase64)) {
    return prompt;
  }
  const source =
    input.imageUrl ??
    (input.imageBase64?.startsWith('data:')
      ? input.imageBase64
      : `data:image/jpeg;base64,${input.imageBase64}`);
  return [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: source } },
  ];
};

export const cleanAndParseJson = <T>(raw: string): T => {
  let cleaned = raw.trim();

  // Strip markdown code fences if present
  const jsonBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch && jsonBlockMatch[1]) {
    cleaned = jsonBlockMatch[1].trim();
  } else {
    const firstBrace = cleaned.indexOf('{');
    const firstBracket = cleaned.indexOf('[');
    let startIdx = -1;
    if (firstBrace !== -1 && firstBracket !== -1) {
      startIdx = Math.min(firstBrace, firstBracket);
    } else if (firstBrace !== -1) {
      startIdx = firstBrace;
    } else if (firstBracket !== -1) {
      startIdx = firstBracket;
    }

    if (startIdx !== -1) {
      const lastBrace = cleaned.lastIndexOf('}');
      const lastBracket = cleaned.lastIndexOf(']');
      const endIdx = Math.max(lastBrace, lastBracket);
      if (endIdx > startIdx) {
        cleaned = cleaned.slice(startIdx, endIdx + 1);
      }
    }
  }

  return JSON.parse(cleaned) as T;
};

const executeWithModelFallback = async <R>(
  fn: (targetModel: string) => Promise<R>
): Promise<R> => {
  let targetModel = getModel();
  try {
    return await fn(targetModel);
  } catch (err: any) {
    const msg = String(err?.message || err?.error?.message || '');
    const slugMatch = msg.match(/use this slug instead:\s*([^\s]+)/i);
    let fallbackSlug = slugMatch ? slugMatch[1] : (targetModel.endsWith(':free') ? targetModel.replace(/:free$/, '') : null);

    if (!fallbackSlug && targetModel !== 'meta-llama/llama-3.1-8b-instruct') {
      fallbackSlug = 'meta-llama/llama-3.1-8b-instruct';
    }

    if (fallbackSlug && fallbackSlug !== targetModel) {
      console.warn(`[aiService] Model '${targetModel}' unavailable or failed. Retrying with fallback slug: '${fallbackSlug}'`);
      return await fn(fallbackSlug);
    }
    throw err;
  }
};

export const generateText = async (
  prompt: string,
  input?: ImageInput,
  _modelTier: 'fast' | 'pro' = 'fast'
): Promise<string> => {
  if (!getApiKey()) {
    return mockChatResponse(prompt);
  }

  const client = getClient();
  const content = buildUserContent(prompt, input);

  try {
    const response = await executeWithModelFallback((model) =>
      client.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are StudyMate AI, an expert, encouraging, and accurate academic study companion. Provide clear, well-structured educational explanations without claiming to be a human tutor.',
          },
          {
            role: 'user',
            content: content as any,
          },
        ],
        temperature: 0.3,
      })
    );

    const text = response.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new HttpError(502, 'AI_EMPTY_RESPONSE', 'The AI provider returned an empty response');
    }
    return text;
  } catch (error: any) {
    console.error('[aiService] OpenRouter text completion failed:', error);
    if (error instanceof HttpError) throw error;
    const message = error?.message || 'The AI provider could not complete the request';
    const status = error?.status && error.status >= 400 && error.status < 600 ? error.status : 502;
    throw new HttpError(status, 'AI_PROVIDER_ERROR', message);
  }
};

export const generateJson = async <T>(
  prompt: string,
  input?: ImageInput,
  _modelTier: 'fast' | 'pro' = 'fast'
): Promise<T> => {
  if (!getApiKey()) {
    throw new HttpError(
      503,
      'AI_NOT_CONFIGURED',
      'OpenRouter API key is not configured. Please set a valid OPENROUTER_API_KEY in backend/.env.'
    );
  }

  const client = getClient();
  const content = buildUserContent(prompt, input);

  try {
    const response = await executeWithModelFallback((model) =>
      client.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are an academic JSON generator. You MUST respond with ONLY valid, parseable JSON conforming strictly to the requested schema. Do not include markdown code fences (like ```json), commentary, greetings, or conversational text.',
          },
          {
            role: 'user',
            content: content as any,
          },
        ],
        temperature: 0.1,
      })
    );

    const raw = response.choices?.[0]?.message?.content;
    if (!raw) {
      throw new HttpError(502, 'AI_EMPTY_RESPONSE', 'The AI provider returned an empty response');
    }

    try {
      return cleanAndParseJson<T>(raw);
    } catch (parseError) {
      console.error('[aiService] Failed to parse JSON from AI response:', raw);
      throw new HttpError(502, 'AI_INVALID_JSON', 'The AI provider returned invalid structured data');
    }
  } catch (error: any) {
    console.error('[aiService] OpenRouter JSON completion failed:', error);
    if (error instanceof HttpError) throw error;
    const message = error?.message || 'The AI provider could not complete the request';
    const status = error?.status && error.status >= 400 && error.status < 600 ? error.status : 502;
    throw new HttpError(status, 'AI_PROVIDER_ERROR', message);
  }
};

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  category: string;
}

export const generateFlashcardsAI = async (
  content: string,
  count = 8
): Promise<Flashcard[]> => {
  const prompt = `Analyze the provided educational text and return ONLY a valid JSON array of ${count} study flashcards.
Format:
[
  {
    "id": "1",
    "front": "Clear question, key term, or concept prompt",
    "back": "Detailed definition, formula, or explanation",
    "category": "Key Concept"
  }
]
Requirements:
1. Provide between 5 and 10 high-yield flashcards (target: ${count}).
2. "front" must be a concise question or concept.
3. "back" must be an accurate, helpful explanation or answer.
4. "category" should be a 1-2 word tag (e.g. Concept, Formula, Definition, Example).
5. Return valid JSON only, without markdown code fences or conversational text.

Source Text:
${content.slice(0, 12000)}`;

  const raw = await generateJson<Flashcard[] | { flashcards: Flashcard[] }>(prompt, undefined, 'pro');
  let list: Flashcard[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && Array.isArray((raw as any).flashcards)) {
    list = (raw as any).flashcards;
  }

  return list
    .map((c, i) => ({
      id: String(c.id || i + 1),
      front: String(c.front || '').trim(),
      back: String(c.back || '').trim(),
      category: String(c.category || 'General').trim(),
    }))
    .filter((c) => c.front.length > 0 && c.back.length > 0);
};

