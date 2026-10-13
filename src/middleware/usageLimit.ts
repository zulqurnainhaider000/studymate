import type { RequestHandler } from 'express';
import { withTransaction } from '../config/database.js';
import { HttpError } from './error-handler.js';

export type UsageMetric = 'ai_questions' | 'pdfs';

const limits = {
  ai_questions: { column: 'messages_used', limitColumn: 'messages_limit', free: 10 },
  pdfs: { column: 'documents_used', limitColumn: 'documents_limit', free: 2 },
} as const;

export const usageLimit = (metric: UsageMetric): RequestHandler => async (req, _res, next) => {
  try {
    if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
    const userId = req.user.id;
    const definition = limits[metric];
    await withTransaction(async (client) => {
      const subscription = await client.query<{ plan: string; status: string }>(
        `SELECT plan, status FROM subscriptions
         WHERE user_id = $1 AND status IN ('trialing', 'active')
         ORDER BY current_period_end DESC NULLS LAST LIMIT 1`,
        [userId],
      );
      const premium = subscription.rows.some((row) => row.plan !== 'free');
      const developmentAiLimit = Number(process.env.AI_DAILY_LIMIT ?? 1_000);
      const configuredLimit = premium ? 1_000_000 : metric === 'ai_questions' && Number.isFinite(developmentAiLimit) ? developmentAiLimit : definition.free;
      const result = await client.query<{ used: number; limit: number }>(
        `INSERT INTO usage_limits (user_id, period_start, ${definition.column}, ${definition.limitColumn})
         VALUES ($1, CURRENT_DATE, 1, $2)
         ON CONFLICT (user_id) DO UPDATE SET
           period_start = CASE WHEN usage_limits.period_start < CURRENT_DATE THEN CURRENT_DATE ELSE usage_limits.period_start END,
           ${definition.column} = CASE WHEN usage_limits.period_start < CURRENT_DATE THEN 1 ELSE usage_limits.${definition.column} + 1 END,
           ${definition.limitColumn} = $2,
           updated_at = now()
         RETURNING ${definition.column} AS used, ${definition.limitColumn} AS limit`,
        [userId, configuredLimit],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Usage limit update returned no row');
      if (!premium && row.used > row.limit) {
        throw new HttpError(429, 'DAILY_LIMIT_REACHED', `Daily ${metric === 'pdfs' ? 'PDF' : 'AI question'} limit reached`);
      }
    });
    next();
  } catch (error) {
    next(error);
  }
};
