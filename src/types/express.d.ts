import type { JwtUser } from '../middleware/auth.js';

declare global {
  namespace Express {
    interface Request {
      user?: JwtUser;
    }
  }
}

export {};
