import { query } from '../config/database.js';
import { maintainStreak } from './xpService.js';

export type ActivityType = 'chat' | 'document' | 'quiz' | 'problem';

export type ActivityRecord = {
  id: string;
  userId: string;
  title: string;
  type: ActivityType;
  subtitle: string | null;
  metadata?: Record<string, any>;
  createdAt: string;
};

export const initActivityTable = async (): Promise<void> => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS activities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        subtitle TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS activities_user_created_idx ON activities(user_id, created_at DESC);
    `);
  } catch (err) {
    console.error('[activityService] Failed to ensure activities table:', err);
  }
};

export const cleanText = (str: string): string => {
  if (!str) return '';
  try {
    let res = str;
    // Decode URI encoding if present (e.g. %D9%82... or %20)
    if (res.includes('%')) {
      try { res = decodeURIComponent(res); } catch {}
      if (res.includes('%')) {
        try { res = decodeURIComponent(res); } catch {}
      }
    }
    return res.replace(/\+/g, ' ').replace(/\?.*$/, '').trim();
  } catch {
    return str.replace(/\+/g, ' ').trim();
  }
};

export const recordActivity = async (
  userId: string,
  type: ActivityType,
  title: string,
  subtitle?: string,
  metadata?: Record<string, any>
): Promise<void> => {
  try {
    const cleanTitle = cleanText(title).slice(0, 100);
    const cleanSubtitle = subtitle ? cleanText(subtitle).slice(0, 100) : null;
    await query(
      `INSERT INTO activities (user_id, type, title, subtitle, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, type, cleanTitle, cleanSubtitle, JSON.stringify(metadata ?? {})]
    );
    void maintainStreak(userId);
  } catch (error) {
    console.error('[activityService] Failed to record activity:', error);
  }
};

export const getRecentActivities = async (
  userId: string,
  limit = 10
): Promise<ActivityRecord[]> => {
  try {
    const result = await query<{
      id: string;
      user_id: string;
      title: string;
      type: ActivityType;
      subtitle: string | null;
      metadata: Record<string, any>;
      created_at: string;
    }>(
      `SELECT id, user_id, title, type, subtitle, metadata, created_at
       FROM activities
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      title: cleanText(row.title),
      type: row.type,
      subtitle: row.subtitle ? cleanText(row.subtitle) : null,
      metadata: row.metadata,
      createdAt: row.created_at,
    }));
  } catch (error) {
    console.error('[activityService] Failed to fetch activities:', error);
    return [];
  }
};
