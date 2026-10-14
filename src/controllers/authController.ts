import bcrypt from 'bcrypt';
import type { Request, Response, NextFunction } from 'express';
import { createAccessToken } from '../middleware/auth.js';
import { HttpError } from '../middleware/error-handler.js';
import { query, withTransaction } from '../config/database.js';
import { generateOtp, sendVerificationOtpEmail } from '../services/emailService.js';
import type {
  LoginInput,
  RegisterInput,
  ChangePasswordInput,
  VerifyOtpInput,
  ResendOtpInput,
} from '../schemas/authSchemas.js';

const publicUser = (row: {
  id: string;
  email: string;
  display_name: string;
  education_level: string;
  total_xp: number | string;
}) => ({
  id: row.id,
  email: row.email,
  profile: { displayName: row.display_name, educationLevel: row.education_level },
  xp: Number(row.total_xp),
});

export const register = async (
  req: Request<unknown, unknown, RegisterInput>,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password, displayName, educationLevel } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    // Check if a user with this email already exists
    const existing = await query<{ id: string; email: string; is_verified: boolean }>(
      'SELECT id, email, is_verified FROM users WHERE email = $1',
      [normalizedEmail]
    );

    const existingUser = existing.rows[0];
    if (existingUser && existingUser.is_verified) {
      throw new HttpError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with that email already exists.');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    if (existingUser && !existingUser.is_verified) {
      // Re-registering / updating details for an unverified account
      await withTransaction(async (client) => {
        await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
          passwordHash,
          existingUser.id,
        ]);
        await client.query(
          `UPDATE profiles SET display_name = $1, education_level = $2 WHERE user_id = $3`,
          [displayName.trim(), educationLevel, existingUser.id]
        );
        await client.query('DELETE FROM email_otps WHERE email = $1', [normalizedEmail]);
        await client.query(
          'INSERT INTO email_otps (email, otp, expires_at) VALUES ($1, $2, $3)',
          [normalizedEmail, otp, expiresAt]
        );
      });
    } else {
      // Create new user with is_verified = false
      await withTransaction(async (client) => {
        const userResult = await client.query<{ id: string; email: string }>(
          'INSERT INTO users (email, password_hash, is_verified) VALUES ($1, $2, false) RETURNING id, email',
          [normalizedEmail, passwordHash]
        );
        const user = userResult.rows[0];
        if (!user) throw new Error('User insert returned no row');

        await client.query(
          'INSERT INTO profiles (user_id, display_name, education_level) VALUES ($1, $2, $3)',
          [user.id, displayName.trim(), educationLevel]
        );
        await client.query('INSERT INTO user_xp (user_id) VALUES ($1)', [user.id]);
        await client.query('DELETE FROM email_otps WHERE email = $1', [normalizedEmail]);
        await client.query(
          'INSERT INTO email_otps (email, otp, expires_at) VALUES ($1, $2, $3)',
          [normalizedEmail, otp, expiresAt]
        );
      });
    }

    // Send OTP to user's email via Nodemailer
    await sendVerificationOtpEmail({
      toEmail: normalizedEmail,
      otp,
      displayName: displayName.trim(),
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful! A 6-digit verification code has been sent to your email.',
      email: normalizedEmail,
      requiresVerification: true,
    });
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
      next(new HttpError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with that email already exists.'));
      return;
    }
    next(error);
  }
};

export const verifyOtp = async (
  req: Request<unknown, unknown, VerifyOtpInput>,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, otp } = req.body;
    const normalizedEmail = email.toLowerCase().trim();
    const cleanOtp = otp.trim();

    // Verify user exists
    const userRes = await query<{ id: string; email: string; is_verified: boolean }>(
      'SELECT id, email, is_verified FROM users WHERE email = $1',
      [normalizedEmail]
    );
    const userRow = userRes.rows[0];
    if (!userRow) {
      throw new HttpError(404, 'USER_NOT_FOUND', 'No account found with this email.');
    }

    // Check latest OTP for this email
    const otpRes = await query<{ id: string; otp: string; expires_at: Date }>(
      'SELECT id, otp, expires_at FROM email_otps WHERE email = $1 ORDER BY created_at DESC LIMIT 1',
      [normalizedEmail]
    );
    const otpRecord = otpRes.rows[0];

    if (!otpRecord || otpRecord.otp !== cleanOtp) {
      throw new HttpError(400, 'INVALID_OTP', 'The verification code you entered is invalid.');
    }

    if (new Date(otpRecord.expires_at).getTime() < Date.now()) {
      throw new HttpError(400, 'OTP_EXPIRED', 'This verification code has expired. Please request a new one.');
    }

    // OTP is valid! Activate user and delete OTP records
    await withTransaction(async (client) => {
      await client.query(
        'UPDATE users SET is_verified = true, email_verified_at = now() WHERE email = $1',
        [normalizedEmail]
      );
      await client.query('DELETE FROM email_otps WHERE email = $1', [normalizedEmail]);
    });

    // Fetch user details for profile payload and JWT token
    const fullUserRes = await query<{
      id: string;
      email: string;
      display_name: string;
      education_level: string;
      total_xp: number;
    }>(
      `SELECT u.id, u.email, p.display_name, p.education_level, COALESCE(x.total_xp, 0) AS total_xp
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       LEFT JOIN user_xp x ON x.user_id = u.id
       WHERE u.email = $1`,
      [normalizedEmail]
    );

    const activeUser = fullUserRes.rows[0];
    if (!activeUser) {
      throw new Error('User record could not be retrieved after verification');
    }

    const token = createAccessToken({ id: activeUser.id, email: activeUser.email });

    res.json({
      success: true,
      token,
      user: publicUser(activeUser),
      message: 'Email verified successfully. Welcome to StudyMate AI!',
    });
  } catch (error) {
    next(error);
  }
};

export const resendOtp = async (
  req: Request<unknown, unknown, ResendOtpInput>,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    // Check user exists
    const userRes = await query<{ id: string; email: string; is_verified: boolean; display_name: string }>(
      `SELECT u.id, u.email, u.is_verified, p.display_name
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       WHERE u.email = $1`,
      [normalizedEmail]
    );
    const user = userRes.rows[0];
    if (!user) {
      throw new HttpError(404, 'USER_NOT_FOUND', 'No account found with this email.');
    }

    if (user.is_verified) {
      throw new HttpError(400, 'ALREADY_VERIFIED', 'This email is already verified. Please sign in.');
    }

    // Cooldown check (60 seconds)
    const latestOtpRes = await query<{ created_at: Date }>(
      'SELECT created_at FROM email_otps WHERE email = $1 ORDER BY created_at DESC LIMIT 1',
      [normalizedEmail]
    );
    const latestOtp = latestOtpRes.rows[0];

    if (latestOtp) {
      const timeElapsedMs = Date.now() - new Date(latestOtp.created_at).getTime();
      const cooldownMs = 60 * 1000;
      if (timeElapsedMs < cooldownMs) {
        const remainingSeconds = Math.ceil((cooldownMs - timeElapsedMs) / 1000);
        throw new HttpError(
          429,
          'COOLDOWN_ACTIVE',
          `Please wait ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'} before requesting another code.`,
          { remainingSeconds }
        );
      }
    }

    // Generate new OTP with 10 min expiration
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await withTransaction(async (client) => {
      await client.query('DELETE FROM email_otps WHERE email = $1', [normalizedEmail]);
      await client.query(
        'INSERT INTO email_otps (email, otp, expires_at) VALUES ($1, $2, $3)',
        [normalizedEmail, otp, expiresAt]
      );
    });

    // Send email
    await sendVerificationOtpEmail({
      toEmail: normalizedEmail,
      otp,
      displayName: user.display_name,
    });

    res.json({
      success: true,
      message: 'A new 6-digit verification code has been sent to your email.',
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (
  req: Request<unknown, unknown, LoginInput>,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    const result = await query<{
      id: string;
      email: string;
      password_hash: string;
      is_verified: boolean;
      display_name: string;
      education_level: string;
      total_xp: number;
    }>(
      `SELECT u.id, u.email, u.password_hash, u.is_verified, p.display_name, p.education_level, COALESCE(x.total_xp, 0) AS total_xp
       FROM users u JOIN profiles p ON p.user_id = u.id LEFT JOIN user_xp x ON x.user_id = u.id
       WHERE u.email = $1`,
      [normalizedEmail]
    );

    const row = result.rows[0];
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }

    // Block unverified accounts from logging in
    if (!row.is_verified) {
      throw new HttpError(
        403,
        'EMAIL_NOT_VERIFIED',
        'Please verify your email address with the 6-digit code sent to your inbox before signing in.',
        { email: row.email, requiresVerification: true }
      );
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
