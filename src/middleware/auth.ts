import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

export interface JwtUser {
  id: string;
  email: string;
}

export const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  return secret;
};

export const createAccessToken = (user: JwtUser): string => jwt.sign({ email: user.email }, getJwtSecret(), { subject: user.id, expiresIn: '7d' });

export const authGuard = (req: Request, res: Response, next: NextFunction): void => {
  const header = req.header('authorization');
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (!token) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  try {
    const payload = jwt.verify(token, getJwtSecret());
    if (typeof payload !== 'object' || typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid authentication token' } });
      return;
    }
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired authentication token' } });
  }
};

export const authenticateToken = authGuard;
