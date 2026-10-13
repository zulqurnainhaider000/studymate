import bcrypt from 'bcrypt';
import type { Request, Response, NextFunction } from 'express';
import { createAccessToken } from '../middleware/auth.js';
import { HttpError } from '../middleware/error-handler.js';
import { query, withTransaction } from '../config/database.js';
import type { LoginInput, RegisterInput, ChangePasswordInput } from '../schemas/authSchemas.js';

const publicUser = (row: { id: string; email: string; display_name: string; education_level: string; total_xp: number | string }) => ({
  id: row.id,
  email: row.email,
  profile: { displayName: row.display_name, educationLevel: row.education_level },
  xp: Number(row.total_xp),
});

export const register = async (req: Request<unknown, unknown, RegisterInput>, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password, displayName, educationLevel } = req.body;
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await withTransaction(async (client) => {
      const userResult = await client.query<{ id: string; email: string }>(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
        [email, passwordHash],
      );
      const user = userResult.rows[0];
      if (!user) throw new Error('User insert returned no row');
      await client.query(
        'INSERT INTO profiles (user_id, display_name, education_level) VALUES ($1, $2, $3)',
        [user.id, displayName, educationLevel],
      );
      await client.query('INSERT INTO user_xp (user_id) VALUES ($1)', [user.id]);
      return client.query<{ id: string; email: string; display_name: string; education_level: string; total_xp: number }>(
        `SELECT u.id, u.email, p.display_name, p.education_level, x.total_xp
         FROM users u JOIN profiles p ON p.user_id = u.id JOIN user_xp x ON x.user_id = u.id
         WHERE u.id = $1`,
        [user.id],
      );
    });
    const row = result.rows[0];
    if (!row) throw new Error('User creation returned no row');
    res.status(201).json({ token: createAccessToken({ id: row.id, email: row.email }), user: publicUser(row) });
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
      next(new HttpError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with that email already exists'));
      return;
    }
    next(error);
  }
};

export const login = async (req: Request<unknown, unknown, LoginInput>, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = req.body;
    const result = await query<{ id: string; email: string; password_hash: string; display_name: string; education_level: string; total_xp: number }>(
      `SELECT u.id, u.email, u.password_hash, p.display_name, p.education_level, COALESCE(x.total_xp, 0) AS total_xp
       FROM users u JOIN profiles p ON p.user_id = u.id LEFT JOIN user_xp x ON x.user_id = u.id
       WHERE u.email = $1`,
      [email],
    );
    const row = result.rows[0];
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [row.id]);
    res.json({ token: createAccessToken({ id: row.id, email: row.email }), user: publicUser(row) });
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (
  req: Request<unknown, unknown, ChangePasswordInput>,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
    const { currentPassword, newPassword } = req.body;

    const result = await query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user.id]
    );
    const userRow = result.rows[0];
    if (!userRow) {
      throw new HttpError(404, 'USER_NOT_FOUND', 'User account not found');
    }

    const isMatch = await bcrypt.compare(currentPassword, userRow.password_hash);
    if (!isMatch) {
      throw new HttpError(400, 'INVALID_PASSWORD', 'Current password is incorrect');
    }

    if (currentPassword === newPassword) {
      throw new HttpError(400, 'SAME_PASSWORD', 'New password must be different from current password');
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    next(error);
  }
};

