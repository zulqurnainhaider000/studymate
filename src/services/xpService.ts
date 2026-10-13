import { query } from '../config/database.js';

export type XpEvent = 'question' | 'quiz' | 'streak';
const xpValues: Record<XpEvent, number> = { question: 5, quiz: 20, streak: 5 };

export const rewardXp = async (userId: string, event: XpEvent): Promise<number> => {
  const amount = xpValues[event];
  const result = await query<{ total_xp: number | string }>(
    `INSERT INTO user_xp (user_id, total_xp)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET total_xp = user_xp.total_xp + $2, updated_at = now()
     RETURNING total_xp`,
    [userId, amount],
  );
  return Number(result.rows[0]?.total_xp ?? amount);
};

const addDays = (dateStr: string, days: number): string => {
  const parts = dateStr.split('-').map(Number);
  const y = parts[0] ?? 2026;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().split('T')[0] ?? dateStr;
};

export const maintainStreak = async (userId: string): Promise<number> => {
  try {
    const datesRes = await query<{ today: string; yesterday: string; dates: string[] | null }>(
      `SELECT
        CURRENT_DATE::text AS today,
        (CURRENT_DATE - INTERVAL '1 day')::date::text AS yesterday,
        array_agg(DISTINCT (created_at::date)::text ORDER BY (created_at::date)::text DESC) AS dates
       FROM activities
       WHERE user_id = $1`,
      [userId],
    );

    const row = datesRes.rows[0];
    const datesList = row?.dates ?? [];
    const dateSet = new Set(datesList);

    let streak = 0;
    if (row && dateSet.size > 0) {
      let current = '';
      if (dateSet.has(row.today)) {
        streak = 1;
        current = row.today;
      } else if (dateSet.has(row.yesterday)) {
        streak = 1;
        current = row.yesterday;
      }

      if (current) {
        while (true) {
          const prev = addDays(current, -1);
          if (dateSet.has(prev)) {
            streak++;
            current = prev;
          } else {
            break;
          }
        }
      }
    }

    const xpRes = await query<{ current_streak_days: number; longest_streak_days: number }>(
      `SELECT current_streak_days, longest_streak_days FROM user_xp WHERE user_id = $1`,
      [userId],
    );
    const existingStreak = Number(xpRes.rows[0]?.current_streak_days ?? 0);
    const finalStreak = Math.max(streak, dateSet.size === 0 && existingStreak > 0 ? existingStreak : streak);

    await query(
      `INSERT INTO user_xp (user_id, current_streak_days, longest_streak_days)
       VALUES ($1, $2, $2)
       ON CONFLICT (user_id) DO UPDATE SET
         current_streak_days = $2,
         longest_streak_days = GREATEST(user_xp.longest_streak_days, $2),
         updated_at = now()`,
      [userId, finalStreak],
    );

    return finalStreak;
  } catch (err) {
    console.error('[xpService] maintainStreak error:', err);
    return 0;
  }
};
