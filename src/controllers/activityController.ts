import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../middleware/error-handler.js';
import { getRecentActivities } from '../services/activityService.js';

export const getRecent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
    const activities = await getRecentActivities(req.user.id, 10);
    res.json({ activities, data: activities, success: true });
  } catch (error) {
    next(error);
  }
};
