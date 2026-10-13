import type { NextFunction, Request, Response } from 'express';
import { query } from '../config/database.js';
import { HttpError } from '../middleware/error-handler.js';
import { maintainStreak } from '../services/xpService.js';

export const getProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
    const userId = req.user.id;

    const streak = await maintainStreak(userId);

    const result = await query<{
      display_name: string;
      email: string;
      education_level: string;
      total_xp: number | string;
      current_streak_days: number;
      quizzes_completed: number | string;
      average_score: number | string | null;
    }>(
      `SELECT p.display_name, u.email, p.education_level, COALESCE(x.total_xp, 0) AS total_xp, COALESCE(x.current_streak_days, 0) AS current_streak_days,
        COUNT(qr.id) AS quizzes_completed, COALESCE(AVG(qr.score::numeric / NULLIF(qr.total_questions, 0) * 100), 0) AS average_score
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       LEFT JOIN user_xp x ON x.user_id = u.id
       LEFT JOIN quiz_results qr ON qr.user_id = u.id
       WHERE u.id = $1
       GROUP BY p.display_name, u.email, p.education_level, x.total_xp, x.current_streak_days`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Profile not found');

    const usageRes = await query<{
      period_start: string;
      messages_used: number;
      messages_limit: number;
      documents_used: number;
      documents_limit: number;
    }>(
      `SELECT period_start::text, messages_used, messages_limit, documents_used, documents_limit
       FROM usage_limits
       WHERE user_id = $1`,
      [userId],
    );

    const todayRes = await query<{ today: string }>('SELECT CURRENT_DATE::text AS today');
    const today = todayRes.rows[0]?.today ?? new Date().toISOString().split('T')[0];

    const usageRow = usageRes.rows[0];
    const isToday = usageRow && usageRow.period_start === today;

    const messagesUsed = isToday ? Number(usageRow.messages_used) : 0;
    const configuredLimit = usageRow && Number(usageRow.messages_limit) > 0 ? Number(usageRow.messages_limit) : 10;
    const remainingQueries = Math.max(0, configuredLimit - messagesUsed);

    const documentsUsed = isToday ? Number(usageRow.documents_used) : 0;
    const remainingUploads = Math.max(0, 3 - documentsUsed);

    res.json({
      name: row.display_name,
      email: row.email,
      educationLevel: row.education_level,
      totalXp: Number(row.total_xp),
      currentStreak: Math.max(streak, Number(row.current_streak_days)),
      quizzesCompleted: Number(row.quizzes_completed),
      averageScore: Number(row.average_score ?? 0),
      quota: {
        remainingQueries,
        totalQueries: configuredLimit,
        messagesUsed,
        remainingUploads,
        totalUploads: 3,
        documentsUsed,
      },
    });
  } catch (error) {
    next(error);
  }
};
